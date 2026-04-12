//! Node scheduler — manages concurrent inference jobs on a single GPU.
//!
//! The GPU can only do N things at once (`max_concurrent`). Extra requests
//! go into a bounded queue (`max_queue`). If both are full, we reject.
//!
//! Each job gets a `JobHandle` — a stream of `InferenceStreamChunk`s that
//! the daemon pipes back to the requesting peer.

use std::{
    collections::{HashMap, VecDeque},
    pin::Pin,
    sync::Arc,
};

use futures::Stream;
use tokio::sync::{Mutex, oneshot, Semaphore};
use tracing::{debug, info};
use common::types::{InferenceStreamChunk, RequestId};

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

/// Everything needed to run one inference job.
pub struct InferenceJob {
    pub request_id: RequestId,
    pub model_id:   String,
    /// The actual async closure that produces the token stream.
    /// We box it so it's type-erased and can go in the queue.
    pub work: Pin<Box<dyn futures::Future<
        Output = anyhow::Result<
            Pin<Box<dyn Stream<Item = anyhow::Result<InferenceStreamChunk>> + Send>>
        >
    > + Send>>,
}

/// Returned when a job is successfully queued/started.
pub struct JobReceipt {
    pub request_id: RequestId,
    /// The caller awaits this to get the token stream.
    pub stream_rx:  oneshot::Receiver<
        anyhow::Result<Pin<Box<dyn Stream<Item = anyhow::Result<InferenceStreamChunk>> + Send>>>
    >,
}

// Internal handle stored while a job is active.
struct ActiveJob {
    #[allow(dead_code)]
    request_id: RequestId,
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

pub struct NodeScheduler {
    max_concurrent: usize,
    max_queue:      usize,
    semaphore:      Arc<Semaphore>,
    active_jobs:    Arc<Mutex<HashMap<RequestId, ActiveJob>>>,
    queue:          Arc<Mutex<VecDeque<RequestId>>>,
}

impl NodeScheduler {
    pub fn new(max_concurrent: usize, max_queue: usize) -> Self {
        let max_concurrent = max_concurrent.max(1);
        Self {
            max_concurrent,
            max_queue,
            semaphore:   Arc::new(Semaphore::new(max_concurrent)),
            active_jobs: Arc::new(Mutex::new(HashMap::new())),
            queue:       Arc::new(Mutex::new(VecDeque::new())),
        }
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------

    /// Submit an inference job.
    ///
    /// If a GPU slot is free it starts immediately.
    /// If all slots are busy but the queue has room it waits.
    /// If the queue is also full returns `Err(SchedulerFull)`.
    pub async fn submit(&self, job: InferenceJob) -> anyhow::Result<JobReceipt> {
        let queue_depth = self.queue_depth().await;
        if queue_depth >= self.max_queue {
            return Err(anyhow::anyhow!(
                "scheduler queue full ({}/{})",
                queue_depth, self.max_queue
            ));
        }

        let request_id  = job.request_id;
        let (tx, rx)    = oneshot::channel();
        let semaphore   = self.semaphore.clone();
        let active_jobs = self.active_jobs.clone();
        let queue       = self.queue.clone();

        // Track in the queue immediately so queue_depth() is accurate
        queue.lock().await.push_back(request_id);
        debug!(%request_id, "job queued");

        // Spawn the job — it waits for a semaphore permit then runs
        tokio::spawn(async move {
            // Acquire a GPU slot — blocks until one is free
            let _permit = semaphore.acquire().await.expect("semaphore closed");

            // Remove from the queue now that we're running
            queue.lock().await.retain(|id| *id != request_id);

            // Mark as active
            active_jobs.lock().await.insert(request_id, ActiveJob { request_id });
            info!(%request_id, "inference job started");

            // Run the work (creates the Ollama stream)
            let result = job.work.await;

            // Send the stream (or error) to the caller
            let _ = tx.send(result);

            // Remove from active when the caller drops the stream
            // (caller is responsible for consuming it fully)
            active_jobs.lock().await.remove(&request_id);
            info!(%request_id, "inference job completed");
        });

        Ok(JobReceipt { request_id, stream_rx: rx })
    }

    /// Number of jobs currently running on the GPU.
    pub async fn active_count(&self) -> usize {
        self.active_jobs.lock().await.len()
    }

    /// Number of jobs waiting for a GPU slot.
    pub async fn queue_depth(&self) -> usize {
        self.queue.lock().await.len()
    }

    /// Total jobs in flight (active + queued).
    pub async fn total_in_flight(&self) -> usize {
        self.active_count().await + self.queue_depth().await
    }

    pub fn max_concurrent(&self) -> usize { self.max_concurrent }
    pub fn max_queue(&self)      -> usize { self.max_queue }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use futures::StreamExt as _;

    fn make_job(delay_ms: u64) -> InferenceJob {
        let request_id = Uuid::new_v4();
        InferenceJob {
            request_id,
            model_id: "test".into(),
            work: Box::pin(async move {
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                // Return a single-chunk stream
                let chunk = InferenceStreamChunk {
                    request_id,
                    chunk_index:      0,
                    token:            "hello".into(),
                    is_final:         true,
                    tokens_generated: 1,
                    finish_reason:    Some("stop".into()),
                };
                let stream = futures::stream::once(async move { Ok(chunk) });
                Ok(Box::pin(stream)
                    as Pin<Box<dyn Stream<Item = anyhow::Result<InferenceStreamChunk>> + Send>>)
            }),
        }
    }

    #[tokio::test]
    async fn test_job_runs_and_streams() {
        let sched  = NodeScheduler::new(1, 4);
        let job    = make_job(0);
        let req_id = job.request_id;

        let receipt = sched.submit(job).await.expect("submit");
        assert_eq!(receipt.request_id, req_id);

        let mut stream = receipt.stream_rx.await.expect("stream").expect("no err");
        let chunk = stream.next().await.expect("one chunk").expect("no err");
        assert_eq!(chunk.token, "hello");
        assert!(chunk.is_final);
    }

    #[tokio::test]
    async fn test_queue_limit_enforced() {
        // 1 concurrent slot, queue of 1 → max in flight = 2
        let sched = NodeScheduler::new(1, 1);

        // Slow job fills the GPU slot
        sched.submit(make_job(500)).await.expect("job 1");

        // Small sleep so job 1 has time to acquire the semaphore
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        // Second job goes into the queue
        sched.submit(make_job(0)).await.expect("job 2 queued");

        // Third job should be rejected (queue full)
        let err = sched.submit(make_job(0)).await;
        assert!(err.is_err(), "third job should be rejected");
    }

    #[tokio::test]
    async fn test_active_and_queue_counts() {
        let sched = NodeScheduler::new(1, 4);

        // Submit a slow job so it holds the GPU slot
        sched.submit(make_job(200)).await.expect("job 1");
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        // Queue two more
        sched.submit(make_job(0)).await.expect("job 2");
        sched.submit(make_job(0)).await.expect("job 3");

        tokio::time::sleep(std::time::Duration::from_millis(10)).await;

        assert_eq!(sched.active_count().await, 1);
        assert_eq!(sched.queue_depth().await, 2);
    }
}

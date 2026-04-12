//! Ollama HTTP client.
//!
//! Ollama runs locally on the GPU node at http://127.0.0.1:11434.
//! It exposes a REST API. We use:
//!
//! - POST /api/chat   → streaming chat completion (newline-delimited JSON)
//! - GET  /api/tags   → list locally available models
//! - POST /api/pull   → download a model from the Ollama registry

use std::pin::Pin;

use anyhow::Context as _;
use futures::Stream;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncBufReadExt as _;
use tokio_util::io::StreamReader;
use tracing::{debug, info, warn};

// ---------------------------------------------------------------------------
// Wire types — Ollama JSON schema
// ---------------------------------------------------------------------------

/// One message in the Ollama chat format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaMessage {
    pub role:    String, // "system" | "user" | "assistant"
    pub content: String,
}

impl OllamaMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self { role: "system".into(), content: content.into() }
    }
    pub fn user(content: impl Into<String>) -> Self {
        Self { role: "user".into(), content: content.into() }
    }
    pub fn assistant(content: impl Into<String>) -> Self {
        Self { role: "assistant".into(), content: content.into() }
    }
}

#[derive(Debug, Serialize)]
struct ChatRequest<'a> {
    model:    &'a str,
    messages: &'a [OllamaMessage],
    stream:   bool,
    options:  ChatOptions,
}

#[derive(Debug, Serialize)]
struct ChatOptions {
    num_predict: u32,
    temperature: f32,
}

/// One JSON line from the streaming chat response.
#[derive(Debug, Deserialize)]
pub struct ChatResponseChunk {
    pub message:           Option<ChunkMessage>,
    pub done:              bool,
    pub done_reason:       Option<String>,
    /// Token count of the generated output (final chunk only).
    pub eval_count:        Option<u32>,
    /// Token count of the prompt (final chunk only).
    pub prompt_eval_count: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkMessage {
    pub content: String,
}

/// GET /api/tags response.
#[derive(Debug, Deserialize)]
struct TagsResponse {
    models: Vec<TagEntry>,
}

#[derive(Debug, Deserialize)]
struct TagEntry {
    name:    String,
    size:    u64,
    details: ModelDetails,
}

#[derive(Debug, Deserialize, Default)]
struct ModelDetails {
    parameter_size:     Option<String>,
    quantization_level: Option<String>,
}

/// Simplified model info exposed to the rest of the codebase.
#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub name:           String,
    pub size_bytes:     u64,
    pub parameter_size: Option<String>,
    pub quantization:   Option<String>,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct OllamaClient {
    base_url: String,
    client:   reqwest::Client,
}

impl OllamaClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into(),
            client:   reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn default_local() -> Self {
        Self::new("http://127.0.0.1:11434")
    }

    // -----------------------------------------------------------------------
    // Model management
    // -----------------------------------------------------------------------

    /// List all models currently available on this Ollama instance.
    pub async fn list_models(&self) -> anyhow::Result<Vec<ModelInfo>> {
        let url  = format!("{}/api/tags", self.base_url);
        let resp: TagsResponse = self.client
            .get(&url)
            .send().await.context("GET /api/tags")?
            .error_for_status().context("Ollama tags error")?
            .json().await.context("parse tags response")?;

        Ok(resp.models.into_iter().map(|e| ModelInfo {
            name:           e.name,
            size_bytes:     e.size,
            parameter_size: e.details.parameter_size,
            quantization:   e.details.quantization_level,
        }).collect())
    }

    /// Pull (download) a model. Streams progress lines until "success".
    /// Call this from a background task — it can take minutes.
    pub async fn pull_model(&self, model_id: &str) -> anyhow::Result<()> {
        info!(%model_id, "pulling model from Ollama registry");
        let url = format!("{}/api/pull", self.base_url);

        #[derive(Serialize)]
        struct PullReq<'a> { name: &'a str, stream: bool }
        #[derive(Deserialize)]
        struct PullStatus { status: String }

        let resp = self.client
            .post(&url)
            .json(&PullReq { name: model_id, stream: true })
            .timeout(std::time::Duration::from_secs(3600))
            .send().await.context("POST /api/pull")?
            .error_for_status().context("Ollama pull error")?;

        let byte_stream = resp.bytes_stream().map(|r| {
            r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        });
        let mut lines = tokio::io::BufReader::new(StreamReader::new(byte_stream)).lines();

        while let Some(line) = lines.next_line().await? {
            if line.is_empty() { continue; }
            if let Ok(s) = serde_json::from_str::<PullStatus>(&line) {
                debug!(%model_id, status = %s.status, "pull progress");
                if s.status == "success" {
                    info!(%model_id, "model pull complete");
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    /// Check if a model is present locally without downloading.
    pub async fn is_model_available(&self, model_id: &str) -> anyhow::Result<bool> {
        let models = self.list_models().await?;
        Ok(models.iter().any(|m| {
            m.name == model_id || m.name.starts_with(&format!("{model_id}:"))
        }))
    }

    /// Rough VRAM estimate: model file size × 1.2 (overhead for activations).
    pub async fn estimated_vram_mb(&self, model_id: &str) -> anyhow::Result<u32> {
        let models = self.list_models().await?;
        let model  = models.iter()
            .find(|m| m.name == model_id || m.name.starts_with(&format!("{model_id}:")))
            .ok_or_else(|| anyhow::anyhow!("model not found locally: {model_id}"))?;
        Ok((model.size_bytes as f64 * 1.2 / 1_048_576.0) as u32)
    }

    // -----------------------------------------------------------------------
    // Inference — streaming chat completion
    // -----------------------------------------------------------------------

    /// Start a streaming chat completion.
    ///
    /// Returns an async stream of `ChatResponseChunk`. Each chunk carries one
    /// token in `message.content`. The final chunk has `done = true` and
    /// contains token-count stats.
    ///
    /// # How the streaming works
    ///
    /// Ollama sends newline-delimited JSON over a plain HTTP response body:
    /// ```json
    /// {"message":{"role":"assistant","content":"Hello"},"done":false}
    /// {"message":{"role":"assistant","content":" world"},"done":false}
    /// {"done":true,"eval_count":12,"prompt_eval_count":5}
    /// ```
    /// We read the response body line-by-line in a background task and forward
    /// each parsed chunk through a tokio mpsc channel which becomes the stream.
    pub async fn generate_stream(
        &self,
        model_id:    &str,
        messages:    &[OllamaMessage],
        max_tokens:  u32,
        temperature: f32,
    ) -> anyhow::Result<Pin<Box<dyn Stream<Item = anyhow::Result<ChatResponseChunk>> + Send>>> {
        let url  = format!("{}/api/chat", self.base_url);
        let body = ChatRequest {
            model:    model_id,
            messages,
            stream:   true,
            options:  ChatOptions { num_predict: max_tokens, temperature },
        };

        let resp = self.client
            .post(&url)
            .json(&body)
            // Generation can take a long time for large contexts
            .timeout(std::time::Duration::from_secs(600))
            .send().await.context("POST /api/chat")?
            .error_for_status().context("Ollama chat error")?;

        // Convert the HTTP response body into an async line reader
        let byte_stream = resp.bytes_stream().map(|r| {
            r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        });
        let mut lines = tokio::io::BufReader::new(StreamReader::new(byte_stream)).lines();

        // Channel: background task reads lines, consumer polls the stream
        let (tx, rx) = tokio::sync::mpsc::channel::<anyhow::Result<ChatResponseChunk>>(64);

        tokio::spawn(async move {
            let mut line = String::new();
            loop {
                match lines.next_line().await {
                    Ok(Some(l)) => {
                        line.clear();
                        line.push_str(&l);
                        let trimmed = line.trim();
                        if trimmed.is_empty() { continue; }

                        match serde_json::from_str::<ChatResponseChunk>(trimmed) {
                            Ok(chunk) => {
                                let done = chunk.done;
                                if tx.send(Ok(chunk)).await.is_err() { break; }
                                if done { break; }
                            }
                            Err(e) => {
                                warn!("malformed Ollama chunk (skipped): {e}");
                            }
                        }
                    }
                    Ok(None) => break, // EOF — generation complete
                    Err(e)   => {
                        let _ = tx.send(Err(anyhow::anyhow!("stream read: {e}"))).await;
                        break;
                    }
                }
            }
        });

        Ok(Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx)))
    }
}

// bring futures::StreamExt in scope for .map() on byte streams
use futures::StreamExt as _;

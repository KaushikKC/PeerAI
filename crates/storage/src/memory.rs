//! In-memory storage — used in unit tests and integration test harnesses.
//!
//! Blobs are stored in a `HashMap` protected by a `Mutex`. Blob IDs are
//! monotonically incrementing integers (`blob_1`, `blob_2`, …).
//! There is no TTL enforcement; blobs live until the process exits.

use std::{collections::HashMap, sync::Arc};

use async_trait::async_trait;
use tokio::sync::Mutex;

use common::types::BlobId;

use crate::StorageClient;

// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct MemoryStorageClient {
    blobs:   Arc<Mutex<HashMap<BlobId, Vec<u8>>>>,
    counter: Arc<Mutex<u64>>,
}

impl MemoryStorageClient {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
}

#[async_trait]
impl StorageClient for MemoryStorageClient {
    async fn put(&self, data: Vec<u8>, _ttl_epochs: u64) -> anyhow::Result<BlobId> {
        let mut c = self.counter.lock().await;
        *c       += 1;
        let id    = format!("mem_blob_{c}");
        self.blobs.lock().await.insert(id.clone(), data);
        Ok(id)
    }

    async fn get(&self, blob_id: &BlobId) -> anyhow::Result<Vec<u8>> {
        self.blobs
            .lock().await
            .get(blob_id)
            .cloned()
            .ok_or_else(|| anyhow::anyhow!("blob not found: {blob_id}"))
    }

    async fn delete(&self, blob_id: &BlobId) -> anyhow::Result<()> {
        self.blobs.lock().await.remove(blob_id);
        Ok(())
    }

    fn name(&self) -> &'static str { "memory" }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_put_get_roundtrip() {
        let store = MemoryStorageClient::new();
        let data  = b"hello world".to_vec();

        let id  = store.put(data.clone(), 0).await.unwrap();
        let got = store.get(&id).await.unwrap();

        assert_eq!(got, data);
    }

    #[tokio::test]
    async fn test_delete_removes_blob() {
        let store = MemoryStorageClient::new();
        let id    = store.put(b"to delete".to_vec(), 0).await.unwrap();

        store.delete(&id).await.unwrap();

        assert!(store.get(&id).await.is_err());
    }

    #[tokio::test]
    async fn test_ids_are_unique() {
        let store = MemoryStorageClient::new();
        let id1   = store.put(vec![1], 0).await.unwrap();
        let id2   = store.put(vec![2], 0).await.unwrap();
        assert_ne!(id1, id2);
    }

    #[tokio::test]
    async fn test_missing_blob_returns_error() {
        let store = MemoryStorageClient::new();
        assert!(store.get(&"does_not_exist".to_string()).await.is_err());
    }
}

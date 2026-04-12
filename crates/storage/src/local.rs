//! Local filesystem storage — used in standalone mode.
//!
//! Each blob is written as a file under `base_dir/`.
//! The file name is the SHA-256 hex of the blob content, making storage
//! content-addressed and naturally deduplicated.
//!
//! ## Directory layout
//!
//! ```text
//! ~/.deai/sessions/
//! ├── 3d7f2a...  (blob)
//! ├── a1b2c3...  (blob)
//! └── …
//! ```
//!
//! No index file is needed — the blob ID *is* the file name.

use std::{
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::Arc,
};

use async_trait::async_trait;
use sha2::{Digest, Sha256};
use tracing::{debug, warn};

use common::types::BlobId;

use crate::StorageClient;

// ---------------------------------------------------------------------------

pub struct LocalStorageClient {
    base_dir: PathBuf,
}

impl LocalStorageClient {
    /// Create a `LocalStorageClient` rooted at `base_dir`.
    ///
    /// The directory is created if it does not exist.
    pub fn new(base_dir: impl AsRef<Path>) -> anyhow::Result<Arc<Self>> {
        let base_dir = base_dir.as_ref().to_path_buf();
        std::fs::create_dir_all(&base_dir)?;
        debug!(path = %base_dir.display(), "local storage initialised");
        Ok(Arc::new(Self { base_dir }))
    }

    fn blob_path(&self, blob_id: &str) -> PathBuf {
        self.base_dir.join(blob_id)
    }
}

#[async_trait]
impl StorageClient for LocalStorageClient {
    /// Write `data` to disk. Returns the SHA-256 hex digest as the blob ID.
    async fn put(&self, data: Vec<u8>, _ttl_epochs: u64) -> anyhow::Result<BlobId> {
        // Content-addressed: sha256(data) → file name
        let hash = Sha256::digest(&data);
        let id   = hex::encode(hash);
        let path = self.blob_path(&id);

        // Skip write if already on disk (dedup)
        if !path.exists() {
            tokio::fs::write(&path, &data).await?;
            debug!(blob_id = %id, bytes = data.len(), "blob written to disk");
        } else {
            debug!(blob_id = %id, "blob already on disk — skipped write");
        }

        Ok(id)
    }

    async fn get(&self, blob_id: &BlobId) -> anyhow::Result<Vec<u8>> {
        let path = self.blob_path(blob_id);
        match tokio::fs::read(&path).await {
            Ok(data) => {
                debug!(blob_id = %blob_id, bytes = data.len(), "blob read from disk");
                Ok(data)
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {
                Err(anyhow::anyhow!("blob not found: {blob_id}"))
            }
            Err(e) => Err(e.into()),
        }
    }

    async fn delete(&self, blob_id: &BlobId) -> anyhow::Result<()> {
        let path = self.blob_path(blob_id);
        match tokio::fs::remove_file(&path).await {
            Ok(())                                 => Ok(()),
            Err(e) if e.kind() == ErrorKind::NotFound => {
                warn!(blob_id = %blob_id, "delete: blob not found (already gone?)");
                Ok(())
            }
            Err(e) => Err(e.into()),
        }
    }

    fn name(&self) -> &'static str { "local" }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_store() -> Arc<LocalStorageClient> {
        let dir = tempfile::tempdir().unwrap();
        LocalStorageClient::new(dir.into_path()).unwrap()
    }

    #[tokio::test]
    async fn test_put_get_roundtrip() {
        let store = make_store();
        let data  = b"session data here".to_vec();

        let id  = store.put(data.clone(), 365).await.unwrap();
        let got = store.get(&id).await.unwrap();

        assert_eq!(got, data);
    }

    #[tokio::test]
    async fn test_blob_id_is_sha256() {
        let store = make_store();
        let data  = b"deterministic content".to_vec();

        let id1 = store.put(data.clone(), 1).await.unwrap();
        let id2 = store.put(data.clone(), 1).await.unwrap(); // same content

        assert_eq!(id1, id2); // content-addressed → same ID
    }

    #[tokio::test]
    async fn test_delete_removes_file() {
        let store = make_store();
        let id    = store.put(b"deletable".to_vec(), 1).await.unwrap();

        store.delete(&id).await.unwrap();
        assert!(store.get(&id).await.is_err());
    }

    #[tokio::test]
    async fn test_delete_missing_blob_is_noop() {
        let store = make_store();
        // Should not return an error
        store.delete(&"nonexistent_id".to_string()).await.unwrap();
    }

    #[tokio::test]
    async fn test_missing_blob_returns_error() {
        let store = make_store();
        assert!(store.get(&"deadbeef".to_string()).await.is_err());
    }
}

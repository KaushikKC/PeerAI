//! Walrus decentralised blob storage client.
//!
//! Walrus stores blobs on a decentralised network of storage nodes.
//! This client speaks the Walrus HTTP REST API:
//!
//! ```text
//! Store:   PUT {publisher}/v1/store?epochs=N   body = raw bytes
//!          → JSON { "newlyCreated": { "blobObject": { "blobId": "..." } } }
//!          | JSON { "alreadyCertified": { "blobId": "..." } }
//!
//! Fetch:   GET {aggregator}/v1/{blob_id}
//!          → raw bytes
//! ```
//!
//! Walrus blobs are content-addressed and immutable. The `delete` method is a
//! no-op — Walrus blobs expire automatically after their TTL in epochs.
//!
//! ## Configuration (from config.toml)
//!
//! ```toml
//! [storage]
//! walrus_aggregator = "https://aggregator.walrus.site"
//! walrus_publisher  = "https://publisher.walrus.site"
//! ```
//!
//! ## Offline / unreachable Walrus
//!
//! If Walrus is unreachable (dev mode, no internet) use `LocalStorageClient`
//! or `MemoryStorageClient` instead.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::{Client, StatusCode};
use serde::Deserialize;
use tracing::{debug, warn};

use common::types::BlobId;

use crate::StorageClient;

// ---------------------------------------------------------------------------
// Walrus response shapes
// ---------------------------------------------------------------------------

/// The Walrus publisher returns one of these two variants on a successful PUT.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum StoreResponse {
    NewlyCreated(NewlyCreated),
    AlreadyCertified(AlreadyCertified),
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewlyCreated {
    blob_object: BlobObject,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AlreadyCertified {
    blob_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlobObject {
    blob_id: String,
}

// ---------------------------------------------------------------------------
// WalrusClient
// ---------------------------------------------------------------------------

pub struct WalrusClient {
    http:         Client,
    aggregator:   String, // e.g. "https://aggregator.walrus.site"
    publisher:    String, // e.g. "https://publisher.walrus.site"
}

impl WalrusClient {
    /// Create a new `WalrusClient`.
    ///
    /// `aggregator` — URL of the Walrus aggregator (for reads).
    /// `publisher`  — URL of the Walrus publisher (for writes).
    pub fn new(aggregator: impl Into<String>, publisher: impl Into<String>) -> anyhow::Result<Self> {
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .build()?;

        Ok(Self {
            http,
            aggregator: aggregator.into().trim_end_matches('/').to_string(),
            publisher:  publisher.into().trim_end_matches('/').to_string(),
        })
    }
}

#[async_trait]
impl StorageClient for WalrusClient {
    /// Upload `data` to Walrus with the given TTL in epochs.
    ///
    /// Returns the Walrus blob ID (a base64-URL string like `"FCvLxr..."`).
    async fn put(&self, data: Vec<u8>, ttl_epochs: u64) -> anyhow::Result<BlobId> {
        let url  = format!("{}/v1/store?epochs={ttl_epochs}", self.publisher);
        let size = data.len();

        debug!(url = %url, bytes = size, "walrus: uploading blob");

        let resp = self.http
            .put(&url)
            .header("Content-Type", "application/octet-stream")
            .body(data)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(anyhow::anyhow!(
                "walrus store failed: HTTP {status} — {body}"
            ));
        }

        let store: StoreResponse = resp.json().await
            .map_err(|e| anyhow::anyhow!("walrus: failed to parse store response: {e}"))?;

        let blob_id = match store {
            StoreResponse::NewlyCreated(n)    => n.blob_object.blob_id,
            StoreResponse::AlreadyCertified(c) => c.blob_id,
        };

        debug!(blob_id = %blob_id, bytes = size, "walrus: blob stored");
        Ok(blob_id)
    }

    /// Download a blob by its Walrus blob ID.
    async fn get(&self, blob_id: &BlobId) -> anyhow::Result<Vec<u8>> {
        let url = format!("{}/v1/{blob_id}", self.aggregator);
        debug!(url = %url, "walrus: fetching blob");

        let resp = self.http.get(&url).send().await?;

        match resp.status() {
            StatusCode::OK => {
                let bytes = resp.bytes().await?;
                debug!(blob_id = %blob_id, bytes = bytes.len(), "walrus: blob fetched");
                Ok(bytes.to_vec())
            }
            StatusCode::NOT_FOUND => {
                Err(anyhow::anyhow!("walrus: blob not found: {blob_id}"))
            }
            status => {
                let body = resp.text().await.unwrap_or_default();
                Err(anyhow::anyhow!("walrus fetch failed: HTTP {status} — {body}"))
            }
        }
    }

    /// No-op — Walrus blobs expire automatically after their TTL in epochs.
    async fn delete(&self, blob_id: &BlobId) -> anyhow::Result<()> {
        warn!(
            blob_id = %blob_id,
            "walrus: delete is a no-op — blobs expire after their TTL in epochs"
        );
        Ok(())
    }

    fn name(&self) -> &'static str { "walrus" }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Unit test for response parsing — does not hit the real Walrus network.
    #[test]
    fn test_parse_newly_created_response() {
        let json = r#"{"newlyCreated":{"blobObject":{"blobId":"FakeId123","storedEpoch":0,"certifiedEpoch":null},"encodingType":"RS2","cost":1000}}"#;
        let resp: StoreResponse = serde_json::from_str(json).unwrap();
        match resp {
            StoreResponse::NewlyCreated(n) => assert_eq!(n.blob_object.blob_id, "FakeId123"),
            _ => panic!("expected NewlyCreated"),
        }
    }

    #[test]
    fn test_parse_already_certified_response() {
        let json = r#"{"alreadyCertified":{"blobId":"ExistingId456","event":{"txDigest":"abc","eventSeq":"1"}}}"#;
        let resp: StoreResponse = serde_json::from_str(json).unwrap();
        match resp {
            StoreResponse::AlreadyCertified(c) => assert_eq!(c.blob_id, "ExistingId456"),
            _ => panic!("expected AlreadyCertified"),
        }
    }

    /// Verify the client can be constructed with trailing slashes in URLs.
    #[test]
    fn test_url_trailing_slash_trimmed() {
        let client = WalrusClient::new(
            "https://aggregator.walrus.site/",
            "https://publisher.walrus.site/",
        ).unwrap();
        assert_eq!(client.aggregator, "https://aggregator.walrus.site");
        assert_eq!(client.publisher,  "https://publisher.walrus.site");
    }
}

//! `GossipReputationStore` — wraps `LocalReputationStore` and gossips Merkle roots.
//!
//! After every `record_proof` the new Merkle root is sent on an `mpsc` channel.
//! A background task in `daemon.rs` picks up roots and forwards them to the
//! `P2PService::publish_reputation_root` method, which broadcasts the root on
//! the `reputation/update` gossipsub topic so all network peers can see it.
//!
//! ## Wiring
//!
//! ```text
//! record_proof()
//!   → inner.record_proof()
//!   → compute new Merkle root
//!   → mpsc::Sender<[u8;32]>.send(root)         ← GossipReputationStore
//!        ↓ background task (daemon.rs)
//!   → p2p_service.publish_reputation_root(root) ← gossipsub broadcast
//!        ↓ receiving peers
//!   → P2PEvent::ReputationRootReceived          ← handled in daemon event loop
//! ```

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tracing::{debug, warn};

use common::types::{NodePeerId, ProofOfInference, ReputationScore};

use crate::{
    local::LocalReputationStore,
    merkle::MerklePathStep,
    store::ReputationStore,
};

pub struct GossipReputationStore {
    inner:        Arc<LocalReputationStore>,
    /// When `Some`, the new Merkle root is sent here after every proof.
    /// The receiver lives in a background task that calls
    /// `P2PService::publish_reputation_root`.
    broadcast_tx: Option<mpsc::Sender<[u8; 32]>>,
}

impl GossipReputationStore {
    /// Wraps `inner` without any broadcast channel (logging-only mode).
    pub fn new(inner: Arc<LocalReputationStore>) -> Self {
        Self { inner, broadcast_tx: None }
    }

    /// Wraps `inner` and sends every new Merkle root on `broadcast_tx`.
    pub fn new_with_broadcast(
        inner:        Arc<LocalReputationStore>,
        broadcast_tx: mpsc::Sender<[u8; 32]>,
    ) -> Self {
        Self { inner, broadcast_tx: Some(broadcast_tx) }
    }
}

#[async_trait]
impl ReputationStore for GossipReputationStore {
    async fn record_proof(&self, proof: &ProofOfInference) -> anyhow::Result<()> {
        self.inner.record_proof(proof).await?;

        let root = self.inner.merkle_root().await?;

        if let Some(ref tx) = self.broadcast_tx {
            if let Err(e) = tx.try_send(root) {
                warn!(
                    root = %hex::encode(root),
                    %e,
                    "gossip: failed to send Merkle root to broadcast task"
                );
            } else {
                debug!(
                    root = %hex::encode(root),
                    "gossip: Merkle root queued for P2P broadcast"
                );
            }
        } else {
            debug!(
                root = %hex::encode(root),
                "gossip: Merkle root computed (no P2P channel configured)"
            );
        }

        Ok(())
    }

    async fn get_score(&self, node_id: &NodePeerId) -> anyhow::Result<ReputationScore> {
        self.inner.get_score(node_id).await
    }

    async fn merkle_root(&self) -> anyhow::Result<[u8; 32]> {
        self.inner.merkle_root().await
    }

    async fn merkle_proof(
        &self,
        proof_id: &[u8; 32],
    ) -> anyhow::Result<Option<Vec<MerklePathStep>>> {
        self.inner.merkle_proof(proof_id).await
    }

    async fn all_proofs(&self) -> anyhow::Result<Vec<ProofOfInference>> {
        self.inner.all_proofs().await
    }

    fn name(&self) -> &'static str { "gossip" }
}

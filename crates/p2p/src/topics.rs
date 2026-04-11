use libp2p::gossipsub::{IdentTopic, TopicHash};

// ---------------------------------------------------------------------------
// Static topics
// ---------------------------------------------------------------------------

/// Node presence and capability announcements.
pub const TOPIC_NODE_ANNOUNCE: &str = "node/announce";

/// Periodic heartbeat / health broadcasts.
pub const TOPIC_NODE_HEALTH: &str = "node/health";

/// Reputation score updates from the on-chain reputation system.
pub const TOPIC_REPUTATION: &str = "reputation/update";

/// Broadcast all inference requests regardless of model.
pub const TOPIC_INFERENCE_ANY: &str = "inference/any";

// ---------------------------------------------------------------------------
// Dynamic topic helpers
// ---------------------------------------------------------------------------

/// Model-specific inference topic — nodes subscribe only to the models they
/// have loaded. Format: `inference/<model_id>` (e.g. `inference/llama3.1:8b`).
pub fn inference_topic(model_id: &str) -> IdentTopic {
    IdentTopic::new(format!("inference/{model_id}"))
}

pub fn node_announce_topic()  -> IdentTopic { IdentTopic::new(TOPIC_NODE_ANNOUNCE) }
pub fn node_health_topic()    -> IdentTopic { IdentTopic::new(TOPIC_NODE_HEALTH) }
pub fn reputation_topic()     -> IdentTopic { IdentTopic::new(TOPIC_REPUTATION) }
pub fn inference_any_topic()  -> IdentTopic { IdentTopic::new(TOPIC_INFERENCE_ANY) }

// ---------------------------------------------------------------------------
// Topic identification helper
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KnownTopic {
    NodeAnnounce,
    NodeHealth,
    Reputation,
    InferenceAny,
    InferenceModel(String),
    Unknown(TopicHash),
}

impl KnownTopic {
    pub fn from_hash(hash: &TopicHash) -> Self {
        let candidates: &[(&str, KnownTopic)] = &[
            (TOPIC_NODE_ANNOUNCE, KnownTopic::NodeAnnounce),
            (TOPIC_NODE_HEALTH,   KnownTopic::NodeHealth),
            (TOPIC_REPUTATION,    KnownTopic::Reputation),
            (TOPIC_INFERENCE_ANY, KnownTopic::InferenceAny),
        ];
        for (name, variant) in candidates {
            if IdentTopic::new(*name).hash() == *hash {
                return variant.clone();
            }
        }
        // Try to match inference/<model>
        // We can't reverse a hash, so callers that need model-specific routing
        // should keep a local map of hash → model_id (built when subscribing).
        KnownTopic::Unknown(hash.clone())
    }
}

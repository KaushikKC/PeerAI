use libp2p::gossipsub::{IdentTopic, TopicHash};

// ---------------------------------------------------------------------------
// Static topics
// ---------------------------------------------------------------------------

pub const TOPIC_NODE_ANNOUNCE:    &str = "node/announce";
pub const TOPIC_NODE_HEALTH:      &str = "node/health";
pub const TOPIC_REPUTATION:       &str = "reputation/update";
pub const TOPIC_INFERENCE_ANY:    &str = "inference/any";

/// Prefix for per-request response topics. Full topic: `infer/resp/<response_id>`.
pub const TOPIC_INFER_RESP_PREFIX: &str = "infer/resp/";

// ---------------------------------------------------------------------------
// Dynamic topic helpers
// ---------------------------------------------------------------------------

pub fn inference_topic(model_id: &str) -> IdentTopic {
    IdentTopic::new(format!("inference/{model_id}"))
}

/// Per-request response topic — client subscribes, worker publishes chunks here.
pub fn infer_response_topic(response_id: &str) -> IdentTopic {
    IdentTopic::new(format!("{TOPIC_INFER_RESP_PREFIX}{response_id}"))
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
    InferenceResponse(String), // response_id
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
        KnownTopic::Unknown(hash.clone())
    }
}

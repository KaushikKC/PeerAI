pub mod bid;
pub mod ollama;
pub mod scheduler;

use std::{pin::Pin, sync::Arc};

use anyhow::Context as _;
use async_trait::async_trait;
use futures::Stream;
use tracing::debug;

use common::types::{ContextWindow, InferenceStreamChunk, RequestId, Role};

use crate::ollama::{OllamaClient, OllamaMessage};

// ---------------------------------------------------------------------------
// Parameters passed per-request
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct InferenceParams {
    pub max_tokens:  u32,
    pub temperature: f32,
    pub request_id:  RequestId,
}

impl Default for InferenceParams {
    fn default() -> Self {
        Self { max_tokens: 2048, temperature: 0.7, request_id: uuid::Uuid::new_v4() }
    }
}

// ---------------------------------------------------------------------------
// The trait
// ---------------------------------------------------------------------------

/// Everything the node needs from an inference backend.
///
/// Currently implemented by `OllamaEngine`.
/// A `vLLMEngine` can be added later by implementing the same trait.
#[async_trait]
pub trait InferenceEngine: Send + Sync {
    /// Run inference and return a stream of token chunks.
    ///
    /// `context_window` contains the full conversation history (after
    /// summarisation). `prompt` is the new user turn.
    async fn run_inference(
        &self,
        model_id:       &str,
        context_window: &ContextWindow,
        prompt:         &str,
        params:         InferenceParams,
    ) -> anyhow::Result<Pin<Box<dyn Stream<Item = anyhow::Result<InferenceStreamChunk>> + Send>>>;

    /// List all models available on this backend.
    async fn list_available_models(&self) -> anyhow::Result<Vec<String>>;

    /// True if the model is loaded into VRAM (fast first-token).
    async fn model_loaded_in_vram(&self, model_id: &str) -> bool;

    /// Rough VRAM requirement in MB for this model.
    async fn estimated_vram_usage_mb(&self, model_id: &str) -> anyhow::Result<u32>;
}

// ---------------------------------------------------------------------------
// Ollama implementation
// ---------------------------------------------------------------------------

pub struct OllamaEngine {
    client: Arc<OllamaClient>,
}

impl OllamaEngine {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self { client: Arc::new(OllamaClient::new(base_url)) }
    }

    pub fn default_local() -> Self {
        Self { client: Arc::new(OllamaClient::default_local()) }
    }

    /// Convert our `ContextWindow` into the Ollama message list format.
    ///
    /// Order:
    /// 1. System prompt (if any)
    /// 2. Summary of older messages as a synthetic assistant turn (if any)
    /// 3. Recent messages verbatim
    /// 4. New user prompt
    fn build_messages(
        context_window: &ContextWindow,
        prompt:         &str,
    ) -> Vec<OllamaMessage> {
        let mut msgs: Vec<OllamaMessage> = Vec::new();

        if let Some(sys) = &context_window.system_prompt {
            msgs.push(OllamaMessage::system(sys));
        }

        if let Some(summary) = &context_window.summary {
            // Inject the summary as a synthetic assistant message so the model
            // treats it as known context rather than new information.
            msgs.push(OllamaMessage::system(format!(
                "[Earlier conversation summary]: {summary}"
            )));
        }

        for msg in &context_window.recent_messages {
            let role = match msg.role {
                Role::User      => "user",
                Role::Assistant => "assistant",
                Role::System    => "system",
            };
            msgs.push(OllamaMessage { role: role.to_string(), content: msg.content.clone() });
        }

        msgs.push(OllamaMessage::user(prompt));
        msgs
    }
}

#[async_trait]
impl InferenceEngine for OllamaEngine {
    async fn run_inference(
        &self,
        model_id:       &str,
        context_window: &ContextWindow,
        prompt:         &str,
        params:         InferenceParams,
    ) -> anyhow::Result<Pin<Box<dyn Stream<Item = anyhow::Result<InferenceStreamChunk>> + Send>>> {
        let messages = Self::build_messages(context_window, prompt);
        debug!(
            %model_id,
            msg_count = messages.len(),
            max_tokens = params.max_tokens,
            "starting Ollama inference"
        );

        let request_id  = params.request_id;
        let ollama_stream = self.client
            .generate_stream(model_id, &messages, params.max_tokens, params.temperature)
            .await
            .context("ollama generate_stream")?;

        // Map Ollama chunks → our InferenceStreamChunk type
        use futures::StreamExt as _;
        let mut chunk_index: u32 = 0;
        let mapped = ollama_stream.map(move |result| {
            let ollama_chunk = result?;
            let token = ollama_chunk
                .message
                .map(|m| m.content)
                .unwrap_or_default();

            let tokens_generated = chunk_index + 1;
            let finish_reason = if ollama_chunk.done {
                ollama_chunk.done_reason
                    .or_else(|| Some("stop".to_string()))
            } else {
                None
            };

            let out = InferenceStreamChunk {
                request_id,
                chunk_index,
                token,
                is_final:        ollama_chunk.done,
                tokens_generated: ollama_chunk.eval_count.unwrap_or(tokens_generated),
                finish_reason,
            };
            chunk_index += 1;
            Ok(out)
        });

        Ok(Box::pin(mapped))
    }

    async fn list_available_models(&self) -> anyhow::Result<Vec<String>> {
        let models = self.client.list_models().await?;
        Ok(models.into_iter().map(|m| m.name).collect())
    }

    async fn model_loaded_in_vram(&self, model_id: &str) -> bool {
        // Ollama doesn't expose a direct "is loaded in VRAM" endpoint.
        // We approximate: if the model is available, assume Ollama will load it
        // on demand. For now always return false (cold).
        // TODO: use Ollama's /api/ps endpoint (added in Ollama 0.1.33+)
        self.client.is_model_available(model_id).await.unwrap_or(false)
    }

    async fn estimated_vram_usage_mb(&self, model_id: &str) -> anyhow::Result<u32> {
        self.client.estimated_vram_mb(model_id).await
    }
}

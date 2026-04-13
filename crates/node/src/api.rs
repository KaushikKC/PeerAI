//! HTTP API server for the DeAI node daemon.
//!
//! Endpoints:
//!   POST /v1/infer   — streaming inference (NDJSON: `{"token":"...","is_final":false}`)
//!   GET  /v1/models  — list available models (`[{"name":"llama3.1:8b"}]`)
//!   GET  /health     — same JSON as the metrics health endpoint (for CORS convenience)
//!
//! CORS: allows all origins so the Next.js web UI (localhost:3000) can call in.

use std::sync::Arc;

use axum::{
    extract::State,
    http::{HeaderMap, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, options, post},
    Json, Router,
};
use futures::StreamExt as _;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tracing::{error, info};

use common::types::{ContextWindow, RequestId};
use inference::{InferenceEngine, InferenceParams};

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct ApiState {
    pub engine:  Arc<dyn InferenceEngine>,
    pub version: String,
    pub mode:    String,
}

// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------

fn cors_headers() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("Access-Control-Allow-Origin",  "*".parse().unwrap());
    h.insert("Access-Control-Allow-Methods", "GET, POST, OPTIONS".parse().unwrap());
    h.insert("Access-Control-Allow-Headers", "Content-Type".parse().unwrap());
    h
}

async fn preflight() -> impl IntoResponse {
    (StatusCode::NO_CONTENT, cors_headers())
}

// ---------------------------------------------------------------------------
// POST /v1/infer
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct InferRequest {
    pub model_id:    String,
    pub prompt:      String,
    pub session_id:  Option<String>,
    pub max_tokens:  Option<u32>,
    pub temperature: Option<f32>,
}

#[derive(Serialize)]
struct TokenChunk {
    token:    String,
    is_final: bool,
}

async fn infer_handler(
    State(state): State<ApiState>,
    Json(body):   Json<InferRequest>,
) -> Response {
    let request_id: RequestId = uuid::Uuid::new_v4();

    // Empty context window — standalone mode has no history server-side
    // (the TS SDK maintains the session client-side and includes the full
    //  context in the encrypted blob; for the simple HTTP path we just run
    //  the current prompt directly against Ollama).
    let context_window = ContextWindow {
        system_prompt:   None,
        summary:         None,
        recent_messages: vec![],
        total_tokens:    0,
    };

    let params = InferenceParams {
        max_tokens:  body.max_tokens.unwrap_or(2048),
        temperature: body.temperature.unwrap_or(0.7),
        request_id,
    };

    let stream_result = state.engine
        .run_inference(&body.model_id, &context_window, &body.prompt, params)
        .await;

    let inference_stream = match stream_result {
        Ok(s)  => s,
        Err(e) => {
            error!(%e, "inference failed");
            let body = format!("{{\"error\":\"{e}\"}}\n");
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                cors_headers(),
                body,
            ).into_response();
        }
    };

    // Map InferenceStreamChunk → NDJSON bytes
    let ndjson_stream = inference_stream.map(|result| {
        let (token, is_final) = match result {
            Ok(chunk) => (chunk.token, chunk.is_final),
            Err(e)    => {
                error!(%e, "stream chunk error");
                (String::new(), true)
            }
        };
        let line = serde_json::to_string(&TokenChunk { token, is_final })
            .unwrap_or_else(|_| "{}".into()) + "\n";
        Ok::<_, std::convert::Infallible>(line)
    });

    let body = axum::body::Body::from_stream(ndjson_stream);

    let mut headers = cors_headers();
    headers.insert("Content-Type", "application/x-ndjson".parse().unwrap());
    headers.insert("X-Accel-Buffering", "no".parse().unwrap());
    headers.insert("Cache-Control", "no-cache".parse().unwrap());

    (StatusCode::OK, headers, body).into_response()
}

// ---------------------------------------------------------------------------
// GET /v1/models
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct ModelInfo {
    name: String,
}

async fn models_handler(State(state): State<ApiState>) -> impl IntoResponse {
    match state.engine.list_available_models().await {
        Ok(names) => {
            let models: Vec<ModelInfo> = names.into_iter().map(|n| ModelInfo { name: n }).collect();
            (StatusCode::OK, cors_headers(), Json(models)).into_response()
        }
        Err(e) => {
            error!(%e, "list models failed");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                cors_headers(),
                format!("{{\"error\":\"{e}\"}}"),
            ).into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// GET /health
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct HealthResp {
    status:  &'static str,
    version: String,
    mode:    String,
}

async fn health_handler(State(state): State<ApiState>) -> impl IntoResponse {
    let resp = HealthResp {
        status:  "ok",
        version: state.version.clone(),
        mode:    state.mode.clone(),
    };
    (StatusCode::OK, cors_headers(), Json(resp))
}

// ---------------------------------------------------------------------------
// Server startup
// ---------------------------------------------------------------------------

/// Start the inference API server in a background task.
pub async fn start(port: u16, state: ApiState) -> anyhow::Result<()> {
    let app = Router::new()
        .route("/v1/infer",  post(infer_handler))
        .route("/v1/infer",  options(preflight))
        .route("/v1/models", get(models_handler))
        .route("/v1/models", options(preflight))
        .route("/health",    get(health_handler))
        .route("/health",    options(preflight))
        .with_state(state);

    let listener = TcpListener::bind(format!("0.0.0.0:{port}")).await?;
    info!(port, "inference API server listening");

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            error!(%e, "api server error");
        }
    });

    Ok(())
}

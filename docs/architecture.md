# DeAI — Complete System Architecture

## What is DeAI?

DeAI is a decentralised AI inference network. Instead of sending your prompts to a centralised API (OpenAI, Anthropic, etc.), you broadcast them over a peer-to-peer network. GPU nodes on that network see your request, compete for it, run a local language model, and stream tokens back to you.

**The key design principle: decentralisation comes from the P2P layer, not the blockchain.**

The blockchain is an optional payment plugin. You can run the entire system — multiple nodes, conversation history, real AI responses — with zero blockchain, zero wallet, zero tokens. The system works in three modes:

```
standalone     → one machine, no P2P, no payment. Personal assistant or dev testing.
network        → full P2P between nodes, no payment. Private cluster or friend group.
network_paid   → full P2P + optional on-chain escrow. Public trustless marketplace.
```

---

## Repository Layout

```
deai/
├── Cargo.toml             Rust workspace root (7 crates)
├── crates/
│   ├── common/            Shared types, config, errors, PaymentBackend trait
│   ├── blockchain-iface/  BlockchainClient trait + MockBlockchainClient
│   ├── p2p/               libp2p networking
│   ├── inference/         Ollama client, InferenceEngine, bid logic, scheduler
│   ├── context/           Encryption, session management, summariser
│   ├── storage/           Blob storage backends (local file, Walrus, memory)
│   └── node/              Main binary: daemon, CLI, health server
├── sdk/                   TypeScript SDK (@deai/sdk)
├── web/                   Next.js Web UI (Phase 8)
├── contracts/             Interface spec for the blockchain team
└── docs/
    ├── architecture.md    This file
    └── config.example.toml
```

---

## Crate Dependency Graph

```
node  ───► p2p
node  ───► inference
node  ───► context  ───► inference
node  ───► storage
node  ───► blockchain-iface   (trait only — impl is the blockchain team's job)
node  ───► common

All crates depend on: common
No circular dependencies.
```

---

## Operation Modes — Choosing Your Stack

When `deai-node start` runs, it reads `~/.deai/config.toml` and builds a different service stack depending on `[node] mode`:

| What | `standalone` | `network` | `network_paid` |
|---|---|---|---|
| P2P networking | Off | On | On |
| Storage backend | Local file | Local file | Walrus |
| Session index | Local map | Local map | Local map (chain optional) |
| Payment | Free (no-op) | Free (no-op) | LocalLedger |
| Blockchain needed? | **No** | **No** | **No** (optional swap-in) |

The blockchain is a drop-in: replace `Arc<dyn PaymentBackend>` with `BlockchainPayment` and the chain index with `ChainIndexStore`. The rest of the system doesn't change.

---

## The Full Data Flow — What Happens When You Send a Message

This covers the complete path from user input to streamed response, across all components.

### Step 1 — Client creates or loads a session

```
User
 │
 ▼
DeAIClient.createSession('llama3.1:8b')
 │  generates:
 │    SessionId   = random UUID
 │    SessionKey  = random 32 bytes (AES-256-GCM key)
 │                  lives ONLY on the client device — never sent anywhere
 │
 ▼
SessionContext { session_id, model_id, messages: [], metadata: { ... } }
 │
 │  encrypted with SessionKey → EncryptedBlob
 │  EncryptedBlob stored to LocalFile or Walrus
 │  blob_id saved in session index
 ▼
Session object returned to user
```

On subsequent runs the session is loaded by blob ID + session key:
```
storage.get(blob_id)
  → EncryptedBlob
  → SessionKey.decrypt(blob)
  → SessionContext  (full message history, turn count, etc.)
```

### Step 2 — User sends a message

```
session.send('explain quantum entanglement')
  │
  │  encrypt the prompt:
  │    nonce = random 12 bytes
  │    ciphertext = AES-256-GCM(session_key, nonce, prompt_bytes)
  │
  ▼
InferenceRequest {
  request_id:       UUID,
  session_id:       UUID,
  model_preference: 'llama3.1:8b',
  context_blob_id:  'abc123...',    ← Walrus blob ID of the session (null = new)
  prompt_encrypted: [...bytes],
  prompt_nonce:     [...12 bytes],
  max_tokens:       2048,
  budget_nanox:     0,              ← zero in free modes
  privacy_level:    'standard',
}
```

### Step 3 — P2P broadcast (network / network_paid modes)

```
P2PClient.broadcastRequest(req)
  │
  ├─► publish to 'inference/llama3.1:8b'   (model-specific topic — best effort)
  └─► publish to 'inference/any'            (catch-all — all GPU nodes see this)
```

In standalone mode this step is skipped — the request goes directly to the local daemon via HTTP.

### Step 4 — GPU node receives and evaluates the request

```
GPU node running deai-node
  │
  │  gossipsub delivers InferenceRequest
  │
  ▼
BidDecisionEngine.should_bid(req)
  │
  ├─ [1] Model check    — do I have 'llama3.1:8b' in Ollama?
  ├─ [2] Capacity check — is VRAM available for this model?
  ├─ [3] Queue depth    — is my job queue too deep?
  ├─ [4] Economic check — is budget ≥ my price_per_1k × 100 / 1000?
  ├─ [5] Privacy check  — request needs TEE and I don't have it?
  └─ [6] Throttle       — have I won too many recent jobs? (fairness limiter)
  │
  │  All 6 pass → build bid
  ▼
InferenceBid {
  request_id:           same UUID as the request,
  node_peer_id:         my libp2p PeerId,
  price_per_1k:         10 NanoX (from config or auto-priced at 80% of budget),
  estimated_latency_ms: 200 + active_jobs × 100,
  current_load_pct:     (active + queued) / (capacity × 3) × 100,
  reputation_score:     1.0,
  model_id:             'llama3.1:8b',
  has_tee:              false,
}
  │
  └─► published back to 'inference/any'
```

### Step 5 — Client collects bids and picks a winner

```
P2PClient.collectBids(req, windowMs=500)
  │  waits 500ms, collects all InferenceBid messages matching request_id
  │
  ▼
selectBestBid(bids)
  │  score = reputation / ((price_per_1k + 1) × (latency_ms + 1))
  │  highest score wins
  ▼
winner: InferenceBid  (one GPU node)
```

### Step 6 — DH key handshake (session key transfer)

The client needs to give the GPU node the ability to decrypt the session context blob — but only for this one request.

```
Client                                  GPU Node
──────                                  ────────
                                        NodeStaticKeyPair
                                          n_priv (stays on node)
                                          n_pub  (broadcast in NodeCapabilities)

EphemeralKeyPair.generate()
  c_priv  (discarded after this request — forward secrecy)
  c_pub

DH(c_priv, n_pub) = shared_secret
wrap_key = SHA-256("deai-wrap-key-v1" ‖ shared_secret)
wrapped_session_key = AES-256-GCM(wrap_key, session_key)

send to GPU node:
  { c_pub, wrapped_session_key }
                                        DH(n_priv, c_pub) = same shared_secret
                                        wrap_key = SHA-256("deai-wrap-key-v1" ‖ shared_secret)
                                        session_key = AES-256-GCM.decrypt(wrap_key, wrapped_key)
```

**Forward secrecy:** `c_priv` is ephemeral and thrown away after the handshake. Even if the GPU node's static key `n_priv` is stolen years later, past sessions cannot be decrypted — the ephemeral key is gone.

### Step 7 — GPU node executes the inference job

```
GPU node (after receiving session key)
  │
  ├─► storage.get(context_blob_id)
  │     → EncryptedBlob from Walrus (or local file)
  │     → session_key.decrypt(blob)
  │     → SessionContext { messages: [...all history...] }
  │
  ├─► SessionManager.build_context_window(session, model_max_tokens)
  │     reserve 25% of context for output
  │     walk messages newest-first, keep what fits in remaining 75%
  │     if messages were trimmed: Summariser generated a summary of the old ones
  │     → ContextWindow { system_prompt, summary, recent_messages }
  │
  ├─► NodeScheduler.submit(job)
  │     semaphore — max N concurrent jobs
  │     if queue full: reject (already reported in bid)
  │
  ├─► OllamaEngine.run_inference(model_id, context_window, prompt, params)
  │     POST http://localhost:11434/api/chat
  │     body: { model, messages: [system, summary, recent..., new_user_prompt], stream: true }
  │     reads newline-delimited JSON response chunks
  │     → stream of InferenceStreamChunk { token, is_final, tokens_generated }
  │
  └─► stream tokens back to client (P2P direct stream — Phase 9)
      after completion: zeroize session_key + plaintext from RAM
      PaymentBackend.record_completed_job(proof)
```

### Step 8 — Client receives tokens and saves the session

```
for await (const token of session.send('explain quantum entanglement')) {
  process.stdout.write(token)   // each token arrives as it's generated
}
// after the loop: full reply is assembled

session.messages now contains:
  [...previous turns..., { role: 'user', content: 'explain...' }, { role: 'assistant', content: '...' }]

session.save()
  → encrypt(SessionContext) with session_key
  → storage.put(ciphertext)  → new blob_id
  → update session index (blob_id pointer stored locally or on-chain)
```

---

## Component Details

### common — Shared Types and Abstractions

**`crates/common/src/types.rs`** — All wire types:
- `Message` — one chat turn (role, content, timestamp, token_count)
- `SessionContext` — full conversation (messages, metadata, context window)
- `SessionMetadata` — turn count, token usage, blob IDs for the current and previous blobs
- `SessionSummary` — lightweight listing entry (no full message history)
- `NodeCapabilities` — what a GPU node broadcasts: models, VRAM, region, TEE, reputation
- `InferenceRequest` — what the client broadcasts to start a job
- `InferenceBid` — what a GPU node sends back when it wants the job
- `InferenceStreamChunk` — one token from the model
- `ProofOfInference` — signed record of a completed job (used by payment backend)
- `PrivacyLevel` — Standard / Private (TEE) / Fragmented / Maximum

**`crates/common/src/config.rs`** — Full node config with defaults:
- `NodeSection` — mode (`standalone | network | network_paid`), data_dir, log_level
- `StorageSection` — backend (`local | walrus | walrus_chain`), dirs, Walrus URLs
- `GpuSection` — device, VRAM budget, concurrent_jobs
- `InferenceSection` — engine (`ollama | vllm`), default model, context length
- `NetworkSection` — listen port, bootstrap nodes, max_peers
- `PricingSection` — price_per_1k, min_escrow, auto_pricing
- `PrivacySection` — memory_wipe, tee_enabled
- `HealthSection` — metrics_port, heartbeat_interval

**`crates/common/src/payment.rs`** — Payment abstraction:
```
PaymentBackend (trait)
  record_completed_job(proof)  → called after every job
  check_budget(user, budget)   → called before accepting a job
  get_usage(user)              → returns cumulative stats

Implementations:
  FreePayment   → pure no-op. No wallet, no tokens. Standalone + network modes.
  LocalLedger   → in-memory HashMap + optional JSON file (~/.deai/ledger.json).
                  Tracks per-user job count, tokens, cost. No blockchain needed.
  BlockchainPayment → (blockchain team's crate) releases Sui escrow on-chain.
```

---

### blockchain-iface — The Blockchain Firewall

**`crates/blockchain-iface/src/lib.rs`**

This crate exists solely to define the interface the blockchain team must implement. No Sui code lives here or anywhere in the core crates.

```rust
trait BlockchainClient {
  deposit_escrow(amount, request_id)        → tx_id
  release_escrow(proof)                     → ()
  refund_escrow(request_id)                 → ()
  get_balance(address)                      → NanoX
  get_session_index_blob(address)           → Option<BlobId>
  set_session_index_blob(address, blob_id)  → ()
  submit_proof(proof)                       → ()
}
```

`MockBlockchainClient` is a stateful in-memory implementation (stores `set_session_index_blob` → returns it on `get`). Used for all unit tests and dev. No Sui node needed.

The rest of the system holds `Arc<dyn BlockchainClient>`. The daemon injects the mock in standalone/network modes, and the blockchain team's `SuiBlockchainClient` in network_paid mode.

---

### p2p — Networking

**`crates/p2p/src/behaviour.rs`** — Single `NetworkBehaviour` struct combining six libp2p protocols:

| Protocol | Role |
|---|---|
| `gossipsub` | Pub/sub messaging for requests, bids, node announcements |
| `kademlia` | DHT for peer discovery in large networks |
| `identify` | Exchanges protocol versions + listen addresses on connect |
| `ping` | Liveness check (30s interval) |
| `autonat` | Detects NAT type, helps with hole-punching |
| `mdns` | Automatic local-network discovery (no bootstrap needed on LAN) |

**Gossipsub configuration:** `MessageAuthenticity::Anonymous` + `ValidationMode::None` — authentication is handled by the libp2p transport layer (Noise protocol), not at the pub/sub layer. Mesh parameters: n=2, n_low=1, n_high=8, outbound_min=0 — allows mesh to form with as few as 2 nodes.

**Topics:**

| Topic | Published by | Subscribed by |
|---|---|---|
| `node/announce` | GPU nodes | Clients, other nodes |
| `node/health` | GPU nodes | Monitoring |
| `inference/any` | Clients | All GPU nodes |
| `inference/<model_id>` | Clients | GPU nodes with that model |
| `reputation/update` | Network | All nodes |

**`crates/p2p/src/service.rs`** — `P2PService` is a cheap-to-clone handle. The actual libp2p swarm runs in its own tokio task and communicates via `mpsc` channels:
- Inbound: `P2PEvent` enum (InferenceRequestReceived, BidReceived, NodeAnnounceReceived, PeerConnected, PeerDisconnected)
- Outbound commands: BroadcastInferenceRequest, SendBid, AnnounceCapabilities, SubscribeModel, Dial, LocalPeerId, ConnectedPeers

---

### inference — Running Models

**`crates/inference/src/ollama.rs`** — `OllamaClient` HTTP client:
- `list_models()` → `GET /api/tags` → `Vec<ModelInfo>`
- `pull_model(id)` → `POST /api/pull` with streaming progress
- `generate_stream(model, messages, max_tokens, temperature)` → `POST /api/chat` with `stream: true`, reads newline-delimited JSON chunks via `BufReader`, returns a `ReceiverStream<ChatResponseChunk>`

**`crates/inference/src/lib.rs`** — `InferenceEngine` trait + `OllamaEngine`:
- `run_inference(model_id, context_window, prompt, params)` → `Stream<InferenceStreamChunk>`
- Builds the Ollama message list: system_prompt → summary-as-system → recent_messages → new user prompt
- Maps Ollama's `ChatResponseChunk` → `InferenceStreamChunk` with chunk_index tracking

**`crates/inference/src/bid.rs`** — `BidDecisionEngine`:
- Takes `NodeConfig` (reads GPU, pricing, privacy sections)
- `should_bid(req)` → runs 6 checks in order (model, VRAM, queue, budget, TEE, throttle)
- `build_bid(req, peer_id)` → constructs `InferenceBid` with price, estimated latency, load_pct
- Throttle: tracks recent wins in a `VecDeque<Instant>`; rejects if more than `4 × concurrent_jobs` wins in last 60s

**`crates/inference/src/scheduler.rs`** — `NodeScheduler`:
- `Semaphore` for concurrency limiting (max N simultaneous jobs)
- Bounded queue (max N×4 waiting jobs)
- `submit(job)` → immediate reject if queue full, else push and spawn a task that acquires the semaphore and runs the work future
- `JobReceipt` returned to caller with a `oneshot::Receiver` for the result stream

---

### context — Encryption and Session Management

**`crates/context/src/crypto.rs`** — Cryptographic primitives:

`SessionKey` (32 bytes):
- `generate()` → random key via `OsRng`
- `encrypt(plaintext)` → fresh nonce + AES-256-GCM → `EncryptedBlob { ciphertext, nonce[12] }`
- `decrypt(blob)` → AES-256-GCM decrypt
- `Drop` impl calls `zeroize()` — key bytes are wiped from RAM when the struct is dropped

`EncryptedBlob` wire format: `nonce(12 bytes) ‖ ciphertext(N bytes)`. Same format in Rust and TypeScript SDK.

`EphemeralKeyPair` / `NodeStaticKeyPair` — X25519 Diffie-Hellman:
- `EphemeralKeyPair::generate()` → fresh X25519 keypair, discarded after use
- `encrypt_session_key(node_pub, session_key)` → `(c_pub_bytes, wrapped_key_bytes)`
- `NodeStaticKeyPair::decrypt_session_key(c_pub_bytes, wrapped_key)` → `SessionKey`
- Wrap key derivation: `SHA-256("deai-wrap-key-v1" ‖ DH_shared_secret)` — matches TypeScript SDK exactly

**`crates/context/src/session.rs`** — Session management without mandatory blockchain:

`SessionIndexStore` trait — two implementations:
```
LocalIndexStore  → HashMap<user_id, BlobId> in memory.
                   No blockchain, no external dependencies.
                   Used in standalone and network modes.

ChainIndexStore  → delegates to BlockchainClient.get/set_session_index_blob.
                   Session index pointer stored on Sui.
                   Used in network_paid mode (optional).
```

`SessionManager`:
- `new_standalone(storage)` — uses `LocalIndexStore`, zero blockchain dependency
- `new_with_blockchain(storage, blockchain)` — uses `ChainIndexStore`
- `create_session(user, model, system_prompt)` → fresh `SessionContext` + `SessionKey`
- `load_session(session_id, blob_id, key)` → decrypt from storage, cache in memory
- `save_session(session, key)` → encrypt → upload → update session index
- `append_turn(session, user_msg, assistant_reply, tokens, cost, node_id, key)` → adds messages, calls `save_session`
- `build_context_window(session, model_max_tokens)` → walks messages newest-first, keeps what fits in 75% of the budget
- `list_sessions(user, index_key)` → loads session index from storage, decrypts, returns `Vec<SessionSummary>`

**`crates/context/src/summariser.rs`** — Conversation summariser:
- `Summariser { engine: Arc<dyn InferenceEngine>, model_id }` — uses a small cheap model (e.g. `llama3.2:1b`)
- `summarise(messages, existing_summary)` → runs inference with max_tokens=512, temp=0.3, returns summary string
- `needs_summarisation(messages, threshold)` → checks total estimated token count
- `split_messages(messages, keep_tokens)` → walks backwards from newest, returns `(to_summarise, to_keep)`
- The daemon calls this when `build_context_window` trims messages (Phase 9)

---

### storage — Blob Storage

All three backends implement the same `StorageClient` trait:
```rust
trait StorageClient {
  put(data, ttl_epochs)  → BlobId
  get(blob_id)           → Vec<u8>
  delete(blob_id)        → ()
}
```

**`MemoryStorageClient`** — `HashMap<BlobId, Vec<u8>>` with monotonic counter IDs. Unit tests only.

**`LocalStorageClient`** — Writes each blob as a file under `~/.deai/sessions/`. The file name is `SHA-256(content)` in hex — content-addressed, so identical blobs are automatically deduplicated. `delete()` is a no-op if the file is already gone. Used in standalone and network modes.

**`WalrusClient`** — HTTP REST client for Walrus decentralised storage:
- `put(data, ttl_epochs)` → `PUT {publisher}/v1/store?epochs=N` → parses `newlyCreated.blobObject.blobId` or `alreadyCertified.blobId`
- `get(blob_id)` → `GET {aggregator}/v1/{blob_id}` → raw bytes
- `delete()` → no-op (Walrus blobs expire automatically after their TTL in epochs)

The `StorageAdapter` in `crates/node/src/daemon.rs` bridges `storage::StorageClient` ↔ `context::session::StorageClient` (the two are structurally identical but different Rust trait objects). The node binary is the only place that knows about both crates.

---

### node — The Binary

**`crates/node/src/cli.rs`** — Clap CLI:
```
deai-node init              create default ~/.deai/config.toml
deai-node start             start the daemon
deai-node start --mode network   override mode at startup
deai-node status            print mode / storage / ports and exit
deai-node models            list available Ollama models
```
`DEAI_MODE` and `DEAI_METRICS_PORT` environment variables override config.

**`crates/node/src/daemon.rs`** — `DeAIDaemon` — assembles and wires all services:

Service assembly by mode:
```
standalone:
  storage     = LocalStorageClient(~/.deai/sessions)
  payment     = FreePayment
  index_store = LocalIndexStore
  p2p         = None

network:
  storage     = LocalStorageClient  (or WalrusClient if config says walrus)
  payment     = FreePayment
  index_store = LocalIndexStore
  p2p         = P2PService  (gossipsub + kad + mDNS)

network_paid:
  storage     = WalrusClient
  payment     = LocalLedger(~/.deai/ledger.json)   ← blockchain team swaps this
  index_store = LocalIndexStore                    ← or ChainIndexStore
  p2p         = P2PService
```

On startup in network mode: subscribes to model-specific gossipsub topics for each available Ollama model, then announces capabilities to the network.

P2P event loop: receives `InferenceRequestReceived`, spawns a tokio task per request that runs `BidDecisionEngine.should_bid()` and if true, calls `BidDecisionEngine.build_bid()` and `P2PService.send_bid()`.

**`crates/node/src/health.rs`** — Axum HTTP server on `:9090`:
- `GET /health` → `{ status: "ok", version, mode, peers }`
- `GET /peers` → `{ count, peers: ["QmAbc...", ...] }`
- `GET /metrics` → Prometheus text format

---

## TypeScript SDK (@deai/sdk)

The SDK is the client-side counterpart to the Rust node. Users import it in their TypeScript apps to send messages to the network.

### Public API

```typescript
import { DeAIClient } from '@deai/sdk'

// Create client
const client = new DeAIClient({
  mode:           'network',          // or 'standalone' / 'network_paid'
  bootstrapNodes: ['/ip4/1.2.3.4/tcp/4001/p2p/QmPeerXxx'],
  storage:        'local',            // or 'memory' / 'walrus'
  bidWindowMs:    500,
})
await client.start()

// Create a new session
const session = await client.createSession('llama3.1:8b', 'You are helpful.')

// Stream tokens one at a time
for await (const token of session.send('explain quantum entanglement')) {
  process.stdout.write(token)
}

// Or get the full reply
const reply = await session.ask('what is 2+2?')

// Save for next run
const blobId = await session.save()
const keyHex = Buffer.from(session.exportKey()).toString('hex')

// Resume later
const session2 = await client.loadSession(blobId, keyHex)
```

### SDK Internal Structure

```
sdk/src/
├── types.ts       All TypeScript interfaces mirroring Rust structs (snake_case JSON)
├── crypto.ts      SessionKey (AES-256-GCM), EncryptedBlob, EphemeralKeyPair, NodeStaticKeyPair
├── session.ts     Session class + Transport interface + P2PTransport + StandaloneTransport
├── client.ts      DeAIClient — mode selection, storage/transport wiring, session factory
├── index.ts       Public exports
├── storage/
│   ├── memory.ts  MemoryStorage — in-memory Map (tests)
│   ├── local.ts   LocalStorage — SHA-256 content-addressed files
│   └── walrus.ts  WalrusStorage — HTTP REST client
└── p2p/
    ├── topics.ts  Gossipsub topic names (must match Rust exactly)
    └── index.ts   P2PClient wrapping libp2p
```

### Transport Layer

The `Transport` interface decouples `Session` from the network details:

**`StandaloneTransport`** — used when `mode = 'standalone'`:
- Decrypts the prompt locally (client has the session key)
- `POST /v1/infer` to the local `deai-node` daemon at `http://localhost:4002`
- Reads newline-delimited JSON chunks `{ token, is_final }` from the response stream
- No P2P, no bid collection — one machine talking to its own Ollama

**`P2PTransport`** — used when `mode = 'network'` or `'network_paid'`:
- Publishes `InferenceRequest` to gossipsub (`inference/<model>` + `inference/any`)
- Waits `bidWindowMs` (default 500ms) collecting `InferenceBid` responses
- Selects winner: `score = reputation / ((price + 1) × (latency + 1))`
- Sends DH key handshake to winning node (X25519 ephemeral keypair)
- Receives token stream from winner over direct libp2p stream (Phase 9)

### Crypto — Rust/TypeScript compatibility

The TypeScript crypto implementation is byte-compatible with Rust:

| Primitive | Rust | TypeScript |
|---|---|---|
| Symmetric cipher | `aes-gcm 0.10` (AES-256-GCM) | WebCrypto `AES-GCM` |
| Nonce size | 12 bytes | 12 bytes |
| Wire format | `nonce[12] ‖ ciphertext` | `nonce[12] ‖ ciphertext` |
| DH | `x25519-dalek 2` | `@noble/curves/ed25519` x25519 |
| Key derivation | `sha2::Sha256("deai-wrap-key-v1" ‖ secret)` | `@noble/hashes/sha256` same input |

A session encrypted by the TypeScript SDK can be decrypted by the Rust daemon and vice versa.

---

## Payment — How Blockchain Stays Optional

The entire payment design is built around one principle: the node binary holds `Arc<dyn PaymentBackend>` and never calls any blockchain code directly.

```
PaymentBackend (trait in crates/common)
│
├── FreePayment                     → all methods are no-ops
│   Used in: standalone, network
│   Requirements: none
│
├── LocalLedger                     → writes to ~/.deai/ledger.json
│   Used in: network_paid (default) → records who ran what jobs
│   Requirements: writable filesystem
│   Budget enforcement: soft (trusts client's stated budget)
│
└── BlockchainPayment               → blockchain team's implementation
    Used in: network_paid (opt-in)  → calls release_escrow on Sui
    Requirements: Sui wallet, SuiBlockchainClient crate
```

To add blockchain payment: implement `BlockchainClient` trait + `PaymentBackend` trait in a separate crate, inject into `DeAIDaemon::from_config()`. One code change in one place.

---

## Session Index — Where Does "Find My Sessions" Live?

Every user has a "session index" — a small encrypted JSON array of `SessionSummary` entries. It tells you: "here are all your sessions, and the blob ID where each one lives." The pointer to this index has to live somewhere.

```
SessionIndexStore (trait in crates/context)
│
├── LocalIndexStore   → HashMap in memory
│   The pointer lives in RAM.
│   In standalone mode this is fine — single device, same process.
│   Phase 9 daemon flushes it to ~/.deai/sessions/_index.json on shutdown.
│
└── ChainIndexStore   → delegates to BlockchainClient.get/set_session_index_blob
    The pointer lives on Sui.
    Fully portable: recover all your sessions from any device
    with just your wallet + session key.
    Used only when mode = network_paid AND you want cross-device portability.
```

---

## Encryption Model — Full Picture

```
Your device                      Network / Storage
───────────────                  ──────────────────────────────────────
SessionKey (32 bytes)
Only lives here. Never leaves.

Per-request, to share it:
  EphemeralKeyPair:
    c_priv ─┐
    c_pub ──┼──────────────────────────────────────► GPU node receives c_pub
            │
    DH(c_priv, n_pub) = shared_secret              DH(n_priv, c_pub) = same secret

    wrap_key = SHA-256("deai-wrap-key-v1" ‖ secret)

    AES-GCM(wrap_key, session_key) = wrapped_key
            │
    Send: { c_pub, wrapped_key } ─────────────────► AES-GCM-decrypt(wrap_key, wrapped_key)
                                                     = session_key (for this job only)

    c_priv discarded immediately                   session_key wiped after job ends

Session blob (stored on Walrus or local file):
  nonce(12) ‖ AES-256-GCM(session_key, SessionContext_JSON)
  Fully encrypted. Anyone can store it. Nobody else can read it.
```

**Privacy levels:**
- `Standard` — encrypted in transit + at rest. Node sees plaintext during inference (same as HTTPS).
- `Private` — Standard + node must run in a TEE. Operator cannot read prompt even at runtime.
- `Fragmented` — request split across N nodes; no single node sees full context. Phase 9.
- `Maximum` — TEE + Fragmented.

---

## What the Blockchain Team Must Deliver

Everything else works without them. They only need to deliver three things for `network_paid` mode:

**1. Rust crate — `SuiBlockchainClient`**
Implement the `BlockchainClient` trait from `crates/blockchain-iface/src/lib.rs`:
```rust
async fn deposit_escrow(amount: NanoX, request_id: RequestId)  → Result<String>
async fn release_escrow(proof: &ProofOfInference)               → Result<()>
async fn refund_escrow(request_id: RequestId)                   → Result<()>
async fn get_balance(address: &str)                             → Result<NanoX>
async fn get_session_index_blob(address: &str)                  → Result<Option<BlobId>>
async fn set_session_index_blob(address: &str, blob_id: BlobId) → Result<()>
async fn submit_proof(proof: &ProofOfInference)                 → Result<()>
```

**2. TypeScript package — `@deai/blockchain`**
Implement the same operations for the SDK side (wallet connect, escrow deposit, etc.). See `contracts/README.md`.

**3. Sui Move contracts**
- Escrow contract: `deposit_escrow`, `release_escrow`, `refund_escrow`
- Reputation contract: `submit_proof`
- Session index contract: `set_index_blob`, `get_index_blob` (optional — can use Walrus + LocalIndexStore instead)

---

## Running Without Blockchain

```bash
# 1. Install Ollama and pull a model
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1:8b

# 2. Create default config
deai-node init

# 3. Start in standalone mode (no network, no blockchain)
deai-node start

# OR start in network mode (P2P, still no blockchain)
deai-node start --mode network
```

```typescript
// TypeScript SDK — standalone
const client = new DeAIClient({ mode: 'standalone' })
await client.start()

const session = await client.createSession('llama3.1:8b')
const reply   = await session.ask('hello')
console.log(reply)
```

```typescript
// TypeScript SDK — free P2P network
const client = new DeAIClient({
  mode:           'network',
  bootstrapNodes: ['/ip4/YOUR_NODE_IP/tcp/4001/p2p/QmPeerId...'],
})
await client.start()
const session = await client.createSession('llama3.1:8b')
for await (const token of session.send('tell me a joke')) {
  process.stdout.write(token)
}
```

---

## What Is Still Missing

**Phase 8 — Web UI (`web/`)**
Next.js chat interface. Calls the TypeScript SDK. Visual session list, streaming chat, model selector, mode switcher.

**Phase 9 — Integration + full job completion**
The current P2P flow is: client broadcasts → GPU node bids → client picks winner. The second half — the GPU node actually executing the job and streaming tokens back over a direct P2P stream — needs the direct libp2p request/response protocol to be wired in. Also:
- The `deai-node` HTTP inference endpoint (`POST /v1/infer`) for standalone mode
- `Summariser` integration in the daemon (auto-summarise when context window overflows)
- Session index flush to disk on daemon shutdown
- Full Prometheus metrics
- End-to-end integration test: two Rust nodes + TypeScript SDK client

---

## Test Coverage Summary

| Crate / Package | Tests | What's covered |
|---|---|---|
| `common` | 5 | PaymentBackend: FreePayment no-op, LocalLedger record/query, file persistence |
| `blockchain-iface` | 0 | (interface only — tested via context integration tests) |
| `p2p` | 1 unit + 1 integration | Gossipsub message routing, two-node discovery and broadcast |
| `inference` | 9 | OllamaClient HTTP, BidDecisionEngine 6 checks + throttle, NodeScheduler concurrency |
| `context` | 16 | AES-256-GCM roundtrip, nonce uniqueness, DH key exchange, SessionManager create/save/load/list, Summariser split/summarise |
| `storage` | 12 | MemoryStorage put/get/delete, LocalStorage SHA-256 dedup, WalrusClient response parsing |
| `node` | 0 | (binary — tested end-to-end in Phase 9) |
| `@deai/sdk` | 19 | SessionKey encrypt/decrypt, EncryptedBlob wire format, DH key exchange, MemoryStorage, Session streaming/history/save-load |
| **Total** | **63** | |

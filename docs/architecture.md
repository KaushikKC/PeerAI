# DeAI — System Architecture

## What is DeAI?

A decentralised AI inference network. Users send prompts to the network and receive
streamed AI responses. GPU nodes compete for jobs, run local models, and optionally
get paid. Conversation history is encrypted and stored on decentralised storage.

**The decentralisation is provided by the P2P layer — not the blockchain.**
The blockchain is an optional payment plugin. The system works fully without it.

---

## Operation Modes

The node supports three modes, selected at startup via config:

```
┌─────────────────────────────────────────────────────────────────┐
│  MODE 1: Standalone                                             │
│  ─────────────────                                              │
│  • Runs entirely on one machine                                 │
│  • No P2P network                                               │
│  • No payment                                                   │
│  • Sessions stored locally                                      │
│  • Use case: personal AI assistant, dev/testing                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MODE 2: Network (free / trusted)                               │
│  ────────────────────────────────                               │
│  • Full P2P — nodes discover each other, broadcast jobs         │
│  • No blockchain, no payment                                    │
│  • Sessions stored on Walrus (or local)                         │
│  • Use case: private company deployment, friend group,          │
│              university cluster                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  MODE 3: Network + Payment (public network)                     │
│  ─────────────────────────────────────────                      │
│  • Full P2P                                                     │
│  • Optional blockchain payment (Sui by default)                 │
│  • Sessions stored on Walrus                                    │
│  • Use case: public trustless marketplace                       │
└─────────────────────────────────────────────────────────────────┘
```

Set in `~/.deai/config.toml`:

```toml
[node]
mode = "standalone"        # standalone | network | network_paid
```

---

## Component Map

```
┌──────────────────────────────────────────────────────────────────────┐
│                         deai-node (binary)                           │
│                                                                      │
│  ┌──────────┐  ┌───────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │  P2P     │  │ Inference │  │  Context  │  │    Storage       │  │
│  │  Layer   │  │  Engine   │  │   Layer   │  │    Layer         │  │
│  │          │  │           │  │           │  │                  │  │
│  │ libp2p   │  │ Ollama /  │  │ Session   │  │ Walrus (cloud)   │  │
│  │ gossipsub│  │ vLLM      │  │ Manager   │  │ LocalFile (dev)  │  │
│  │ kademlia │  │           │  │ Encryptor │  │ Memory (test)    │  │
│  │ identify │  │ Bid Engine│  │ Summariser│  │                  │  │
│  │ mdns     │  │ Scheduler │  │           │  └──────────────────┘  │
│  └──────────┘  └───────────┘  └───────────┘                        │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  Payment Backend  (OPTIONAL — pluggable)                     │   │
│  │                                                              │   │
│  │  FreePayment       LocalLedger        BlockchainPayment      │   │
│  │  (no-op, mode 1+2) (local accounting) (Sui — mode 3 only)   │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Crate Structure

```
crates/
├── common/           Shared types, config, errors, PaymentBackend trait
├── blockchain-iface/ BlockchainClient trait + MockBlockchainClient
│                     (used only when mode = network_paid)
├── p2p/              libp2p networking — gossipsub, kademlia, mdns
├── inference/        Ollama client, InferenceEngine trait, bid engine, scheduler
├── context/          AES-256-GCM encryption, session manager, summariser
├── storage/          StorageClient trait, WalrusClient, LocalStorageClient
└── node/             Main binary — daemon, CLI, health/metrics
```

---

## Data Flow — Full Inference Request

### Client side

```
1. User types a message in the Web UI or SDK

2. SDK loads session from storage (Walrus blob or local file)
   └─ Decrypt with SessionKey (lives only on client device)

3. SDK broadcasts InferenceRequest over P2P (gossipsub)
   InferenceRequest {
     model_preference: "llama3.1:8b"
     prompt_encrypted: AES-GCM(session_key, prompt)
     context_blob_id:  Option<"walrus_blob_abc">   ← where history lives
     budget_nanox:     Option<1000>                ← None if free mode
     escrow_tx_id:     Option<"tx_xyz">            ← None if free mode
     privacy_level:    Standard
   }

4. SDK collects bids from GPU nodes (500ms window)
   └─ Picks best bid (price × speed × reputation score)

5. SDK sends job handshake to winning node:
   └─ client_ephemeral_pub + AES-GCM(DH_shared_secret, session_key)
      (GPU node can now decrypt the context blob — but only for this request)

6. SDK streams tokens back to the user as they arrive

7. SDK appends the turn to session and re-encrypts to storage
```

### GPU Node side

```
1. Gossipsub delivers InferenceRequest

2. BidDecisionEngine runs 6 checks:
   model available? → capacity free? → queue ok? →
   budget ok? → TEE needed? → throttle ok?
   └─ If all pass: send InferenceBid back

3. If selected by client:
   └─ Receive job handshake → decrypt session key via DH
   └─ Fetch context blob from Walrus (or skip if new session)
   └─ Decrypt context with session key
   └─ Build context window (recent messages + optional summary)

4. NodeScheduler queues the job (semaphore — max N concurrent)

5. OllamaEngine.run_inference()
   └─ POST /api/chat → http://localhost:11434
   └─ Stream tokens back to client over P2P

6. After completion:
   └─ Wipe session key + plaintext from RAM (zeroize)
   └─ Sign ProofOfInference
   └─ PaymentBackend.record_completed_job(proof)
      ├─ FreePayment   → no-op
      ├─ LocalLedger   → write to local accounting file
      └─ Blockchain    → release_escrow(proof) on Sui
```

---

## Payment Layer — How Blockchain Is Optional

The `PaymentBackend` trait has three implementations:

```
PaymentBackend (trait)
├── FreePayment
│   All methods are no-ops. Used in standalone and network-free modes.
│   No wallet needed. No tokens needed.
│
├── LocalLedger
│   Tracks usage in a local JSON file (~/.deai/ledger.json).
│   Useful for internal deployments where you want usage stats
│   but don't need trustless payment.
│   Budget enforced locally — node trusts client's claimed budget.
│
└── BlockchainPayment (wraps BlockchainClient)
    Full on-chain escrow via Sui (or any chain implementing the trait).
    Trustless — payment is locked before inference starts.
    Used only when mode = network_paid.
```

The daemon holds `Arc<dyn PaymentBackend>` — it never calls Sui directly.
Switching payment mode is one config line change.

---

## Session Storage — How It Works Without Blockchain

Sessions can be stored in three backends (configured independently of payment):

```
StorageBackend
├── LocalFile  (~/.deai/sessions/)
│   Sessions stored as encrypted files on disk.
│   Session index stored as a local JSON file.
│   No external dependencies. Works offline.
│   Suitable for standalone mode.
│
├── WalrusStorage
│   Sessions stored as encrypted blobs on Walrus.
│   Session index stored as a Walrus blob.
│   Blob ID tracked in a local file (no chain needed).
│   Suitable for network-free mode (sessions accessible from any node).
│
└── WalrusStorage + ChainIndex  (full mode)
    Sessions stored on Walrus.
    Session index blob ID stored on-chain.
    Fully portable across devices — recover from any device
    with just your wallet + session key.
    Suitable for network_paid mode.
```

In config:

```toml
[storage]
backend       = "local"       # local | walrus | walrus_chain
sessions_dir  = "~/.deai/sessions"
walrus_aggregator = "https://aggregator.walrus.site"
walrus_publisher  = "https://publisher.walrus.site"
```

---

## Encryption Model

```
Client device                 Network / Storage
─────────────                 ─────────────────

SessionKey (32 bytes)         Walrus blob: nonce‖ciphertext
Lives ONLY on client.         Anyone can fetch — nobody can read.
Never transmitted.

Per-request DH handshake:
  EphemeralKeyPair (fresh     NodeStaticKeypair (GPU node)
  per request, discarded      n_priv stays on the node.
  immediately after)          n_pub broadcast in NodeCapabilities.

  DH(c_priv, n_pub) = DH(n_priv, c_pub) = shared_secret
  → AES-GCM(shared_secret, session_key) = wrapped_key

  Client sends: c_pub + wrapped_key
  Node recovers: session_key
  Node uses: session_key to decrypt context blob

  After job: node WIPES session_key + all plaintext from RAM
```

**Forward secrecy:** `c_priv` is ephemeral — even if the node's `n_priv` is stolen
years later, past sessions cannot be decrypted.

---

## P2P Gossipsub Topics

```
Topic                    Who publishes          Who subscribes
─────────────────────    ─────────────────      ──────────────────
node/announce            GPU nodes              Clients, other nodes
node/health              GPU nodes              Monitoring
inference/any            Clients                All GPU nodes
inference/<model_id>     Clients                GPU nodes with that model
reputation/update        Network                All nodes
```

---

## Privacy Levels

```
Standard    Prompt encrypted in transit + at rest. Node sees plaintext
            during inference (standard HTTPS-style privacy).

Private     Standard + node must run in a TEE (trusted execution environment).
            Node operator cannot read the prompt even at runtime.

Fragmented  Request split across N nodes (no single node sees full context).
            Higher latency, maximum privacy. (Phase 9)

Maximum     TEE + Fragmented.
```

---

## What The Blockchain Team Must Deliver

Only needed for `mode = network_paid`. The rest of the system is fully independent.

- Rust crate: implement `BlockchainClient` trait from `crates/blockchain-iface`
- TypeScript: implement `@deai/blockchain` package matching `contracts/README.md`
- Sui Move contracts: escrow, reputation, session index (optional — can use Walrus+local instead)

If the blockchain is not ready: set `mode = network` and the system runs fully without it.

---

## Running Without Blockchain (Quick Start)

```bash
# 1. Install Ollama and pull a model
curl -fsSL https://ollama.ai/install.sh | sh
ollama pull llama3.1:8b

# 2. Initialise node config
deai-node init

# 3. Start in network-free mode (no blockchain, no wallet needed)
DEAI_MODE=network deai-node start

# 4. Use the SDK
npm install @deai/sdk
```

```typescript
import { DeAIClient } from '@deai/sdk'

const client = new DeAIClient({
  mode: 'network',          // no wallet, no payment
  bootstrapNodes: ['/ip4/...']
})

const session = await client.createSession('llama3.1:8b')
for await (const token of session.send('explain quantum computing')) {
  process.stdout.write(token)
}
```

---

## Dependency Graph (simplified)

```
node  ──depends on──►  p2p
node  ──depends on──►  inference
node  ──depends on──►  context  ──► inference
node  ──depends on──►  storage
node  ──depends on──►  blockchain-iface  (trait only — impl is optional)
node  ──depends on──►  common

All crates depend on: common
```

No circular dependencies. Each crate can be tested in isolation.

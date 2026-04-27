//! Solana settlement adapter — wraps the `pinaivu` Anchor program behind the
//! [`SettlementAdapter`] trait.
//!
//! ## Configuration (`config.toml`)
//!
//! ```toml
//! [[settlement.adapters]]
//! id               = "solana"
//! rpc_url          = "https://api.devnet.solana.com"
//! contract_address = "PiNaivuXXX..."    # deployed program ID (base58)
//! price_per_1k     = 10
//! token_id         = "sol"
//! # 64-byte keypair bytes (seed || pubkey), hex-encoded.
//! # Obtain from ~/.config/solana/id.json via `solana-keygen`.
//! signer_key_hex   = "aabb...ccdd..."
//! # Node's Ed25519 P2P pubkey (32 bytes, hex).  Matches the seed used for
//! # NodeScore PDA.  Derive from the node identity: `pinaivu status`.
//! node_pubkey_hex  = "1122...3344..."
//! ```
//!
//! ## On-chain program (programs/pinaivu)
//!
//! The adapter calls three modules of the deployed Anchor program:
//!
//! | Module   | Instructions called                                |
//! |----------|----------------------------------------------------|
//! | escrow   | `lock_escrow`, `release_escrow`, `refund_escrow`  |
//! | score    | `submit_proof`, `anchor_merkle_root`               |
//!
//! PDAs used:
//! - `["state"]`                → `ProgramState` (global stats)
//! - `["escrow", request_id]`   → `EscrowAccount` (per-job)
//! - `["score", node_pubkey]`   → `NodeScore` (leaderboard entry)

#![cfg(feature = "solana")]

use anyhow::{anyhow, Context};
use async_trait::async_trait;
use common::types::{NanoX, ProofOfInference};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::{
    commitment_config::CommitmentConfig,
    instruction::{AccountMeta, Instruction},
    message::Message,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};
use std::str::FromStr;
use tracing::{debug, info};

use crate::adapter::{EscrowHandle, EscrowParams, SettlementAdapter, SettlementCapabilities};

// ---------------------------------------------------------------------------
// PDA seeds — must match programs/pinaivu/src/state.rs exactly.
// ---------------------------------------------------------------------------

const SEED_STATE:  &[u8] = b"state";
const SEED_ESCROW: &[u8] = b"escrow";
const SEED_SCORE:  &[u8] = b"score";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct SolanaConfig {
    /// Solana JSON-RPC endpoint.
    /// Devnet: "https://api.devnet.solana.com"
    /// Mainnet: "https://api.mainnet-beta.solana.com"
    pub rpc_url: String,
    /// Base58 program ID of the deployed `pinaivu` Anchor program.
    pub program_id_str: String,
    /// 64-byte Solana keypair (seed || pubkey), hex-encoded.
    /// Obtain with `solana-keygen` or export from Phantom.
    /// `None` → read-only; escrow/score calls return Err.
    pub keypair_hex: Option<String>,
    /// Node's Ed25519 P2P pubkey (32 bytes), hex-encoded.
    /// Used to derive the `NodeScore` PDA for `anchor_hash` and `submit_proof`.
    /// Matches the `node_pubkey` stored in `NodeRegistration` / `NodeScore`.
    pub node_p2p_pubkey_hex: Option<String>,
    pub price_per_1k: NanoX,
}

// ---------------------------------------------------------------------------
// Anchor instruction discriminants
//
// Anchor uses the first 8 bytes of SHA-256("global:<instruction_name>") as a
// prefix on every instruction payload.  These are pre-computed here so we
// don't need the Anchor codegen at runtime.
// ---------------------------------------------------------------------------

fn discriminant(name: &str) -> [u8; 8] {
    let hash = Sha256::digest(format!("global:{name}").as_bytes());
    hash[..8].try_into().expect("sha256 is always ≥ 8 bytes")
}

// Cached discriminants — computed once per process start.
fn disc_lock_escrow()       -> [u8; 8] { discriminant("lock_escrow") }
fn disc_release_escrow()    -> [u8; 8] { discriminant("release_escrow") }
fn disc_refund_escrow()     -> [u8; 8] { discriminant("refund_escrow") }
fn disc_submit_proof()      -> [u8; 8] { discriminant("submit_proof") }
fn disc_anchor_merkle_root() -> [u8; 8] { discriminant("anchor_merkle_root") }

// ---------------------------------------------------------------------------
// Borsh-style argument encoding
//
// Anchor uses Borsh for instruction arguments.  For primitive types:
//   [u8; N] → N bytes directly
//   u64     → 8 bytes, little-endian
//   i64     → 8 bytes, little-endian
//   u32     → 4 bytes, little-endian
// ---------------------------------------------------------------------------

fn encode_lock_escrow(request_id: [u8; 16], amount_lamports: u64, timeout_secs: i64) -> Vec<u8> {
    let mut d = disc_lock_escrow().to_vec();
    d.extend_from_slice(&request_id);
    d.extend_from_slice(&amount_lamports.to_le_bytes());
    d.extend_from_slice(&timeout_secs.to_le_bytes());
    d
}

fn encode_release_escrow(proof_hash: [u8; 32]) -> Vec<u8> {
    let mut d = disc_release_escrow().to_vec();
    d.extend_from_slice(&proof_hash);
    d
}

fn encode_refund_escrow() -> Vec<u8> {
    disc_refund_escrow().to_vec()
}

fn encode_submit_proof(
    proof_hash: [u8; 32],
    output_tokens: u32,
    latency_ms: u32,
    lamports_earned: u64,
) -> Vec<u8> {
    let mut d = disc_submit_proof().to_vec();
    d.extend_from_slice(&proof_hash);
    d.extend_from_slice(&output_tokens.to_le_bytes());
    d.extend_from_slice(&latency_ms.to_le_bytes());
    d.extend_from_slice(&lamports_earned.to_le_bytes());
    d
}

fn encode_anchor_merkle_root(merkle_root: [u8; 32], label: [u8; 32]) -> Vec<u8> {
    let mut d = disc_anchor_merkle_root().to_vec();
    d.extend_from_slice(&merkle_root);
    d.extend_from_slice(&label);
    d
}

// ---------------------------------------------------------------------------
// SolanaSettlement
// ---------------------------------------------------------------------------

pub struct SolanaSettlement {
    config:     SolanaConfig,
    client:     RpcClient,
    program_id: Pubkey,
    /// Pre-computed global state PDA — used in lock/release instructions.
    state_pda:  Pubkey,
}

impl SolanaSettlement {
    pub fn new(config: SolanaConfig) -> anyhow::Result<Self> {
        let program_id = Pubkey::from_str(&config.program_id_str)
            .with_context(|| format!("SolanaSettlement: invalid program_id '{}'", config.program_id_str))?;

        let (state_pda, _) = Pubkey::find_program_address(&[SEED_STATE], &program_id);

        let client = RpcClient::new_with_commitment(
            config.rpc_url.clone(),
            CommitmentConfig::confirmed(),
        );

        Ok(Self { config, client, program_id, state_pda })
    }

    // ── Keypair helpers ───────────────────────────────────────────────────────

    fn keypair(&self) -> anyhow::Result<Keypair> {
        let hex_str = self.config.keypair_hex.as_deref()
            .ok_or_else(|| anyhow!("SolanaSettlement: signer_key_hex not configured — read-only mode"))?;
        let bytes = hex::decode(hex_str)
            .context("SolanaSettlement: signer_key_hex is not valid hex")?;
        Keypair::from_bytes(&bytes)
            .map_err(|e| anyhow!("SolanaSettlement: invalid keypair bytes: {e}"))
    }

    fn node_p2p_pubkey(&self) -> anyhow::Result<[u8; 32]> {
        let hex_str = self.config.node_p2p_pubkey_hex.as_deref()
            .ok_or_else(|| anyhow!("SolanaSettlement: node_pubkey_hex not configured"))?;
        let bytes = hex::decode(hex_str)
            .context("SolanaSettlement: node_pubkey_hex is not valid hex")?;
        bytes.try_into()
            .map_err(|_| anyhow!("SolanaSettlement: node_pubkey_hex must be exactly 32 bytes"))
    }

    // ── PDA derivation ────────────────────────────────────────────────────────

    fn escrow_pda(&self, request_id: &[u8; 16]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SEED_ESCROW, request_id], &self.program_id)
    }

    fn score_pda(&self, node_pubkey: &[u8; 32]) -> (Pubkey, u8) {
        Pubkey::find_program_address(&[SEED_SCORE, node_pubkey], &self.program_id)
    }

    // ── Transaction submission ────────────────────────────────────────────────

    /// Sign and submit a transaction containing `instructions`.
    ///
    /// Uses `CommitmentConfig::confirmed()` — waits for 2/3 stake confirmation
    /// (~400 ms on mainnet, ~800 ms on devnet).  Returns the transaction signature.
    async fn send_tx(
        &self,
        keypair:      &Keypair,
        instructions: &[Instruction],
    ) -> anyhow::Result<String> {
        let blockhash = self
            .client
            .get_latest_blockhash()
            .await
            .context("SolanaSettlement: failed to get latest blockhash")?;

        let message = Message::new(instructions, Some(&keypair.pubkey()));
        let tx = Transaction::new(&[keypair], message, blockhash);

        let sig = self
            .client
            .send_and_confirm_transaction(&tx)
            .await
            .context("SolanaSettlement: transaction failed")?;

        Ok(sig.to_string())
    }

    // ── Instruction builders ──────────────────────────────────────────────────

    /// Build the `lock_escrow` instruction.
    ///
    /// Accounts (must match programs/pinaivu/src/escrow.rs LockEscrow struct):
    ///   0. escrow PDA         writable, not-signer   (created by program)
    ///   1. program_state PDA  writable, not-signer
    ///   2. client             writable, signer        (payer)
    ///   3. node_wallet        not-writable, not-signer
    ///   4. system_program     not-writable, not-signer
    fn ix_lock_escrow(
        &self,
        escrow_pda:   Pubkey,
        client_key:   Pubkey,
        node_wallet:  Pubkey,
        request_id:   [u8; 16],
        amount_lamports: u64,
        timeout_secs: i64,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(escrow_pda,        false),
                AccountMeta::new(self.state_pda,    false),
                AccountMeta::new(client_key,         true),
                AccountMeta::new_readonly(node_wallet, false),
                AccountMeta::new_readonly(system_program::id(), false),
            ],
            data: encode_lock_escrow(request_id, amount_lamports, timeout_secs),
        }
    }

    /// Build the `release_escrow` instruction.
    ///
    /// Accounts (must match ReleaseEscrow struct):
    ///   0. escrow PDA         writable, not-signer
    ///   1. program_state PDA  writable, not-signer
    ///   2. node_wallet        writable, signer
    fn ix_release_escrow(
        &self,
        escrow_pda:  Pubkey,
        node_wallet: Pubkey,
        proof_hash:  [u8; 32],
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(escrow_pda,        false),
                AccountMeta::new(self.state_pda,    false),
                AccountMeta::new(node_wallet,        true),
            ],
            data: encode_release_escrow(proof_hash),
        }
    }

    /// Build the `refund_escrow` instruction.
    ///
    /// Accounts (must match RefundEscrow struct):
    ///   0. escrow PDA  writable, not-signer
    ///   1. client      writable, signer
    fn ix_refund_escrow(&self, escrow_pda: Pubkey, client_key: Pubkey) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(escrow_pda, false),
                AccountMeta::new(client_key,  true),
            ],
            data: encode_refund_escrow(),
        }
    }

    /// Build the `submit_proof` instruction.
    ///
    /// Accounts (must match SubmitProof struct):
    ///   0. score PDA  writable, not-signer
    ///   1. authority  not-writable, signer
    fn ix_submit_proof(
        &self,
        score_pda:       Pubkey,
        authority:       Pubkey,
        proof_hash:      [u8; 32],
        output_tokens:   u32,
        latency_ms:      u32,
        lamports_earned: u64,
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(score_pda, false),
                AccountMeta::new_readonly(authority, true),
            ],
            data: encode_submit_proof(proof_hash, output_tokens, latency_ms, lamports_earned),
        }
    }

    /// Build the `anchor_merkle_root` instruction.
    ///
    /// Accounts (must match AnchorMerkleRoot struct):
    ///   0. score PDA  writable, not-signer
    ///   1. authority  not-writable, signer
    fn ix_anchor_merkle_root(
        &self,
        score_pda:   Pubkey,
        authority:   Pubkey,
        merkle_root: [u8; 32],
        label:       [u8; 32],
    ) -> Instruction {
        Instruction {
            program_id: self.program_id,
            accounts: vec![
                AccountMeta::new(score_pda, false),
                AccountMeta::new_readonly(authority, true),
            ],
            data: encode_anchor_merkle_root(merkle_root, label),
        }
    }
}

// ---------------------------------------------------------------------------
// SettlementAdapter implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl SettlementAdapter for SolanaSettlement {
    fn id(&self) -> &'static str { "solana" }

    fn display_name(&self) -> &'static str { "Solana (SOL escrow via pinaivu program)" }

    fn capabilities(&self) -> SettlementCapabilities {
        SettlementCapabilities {
            has_escrow:        true,
            has_token:         false, // native SOL only, no SPL token for MVP
            is_trustless:      true,
            finality_seconds:  1,     // ~400 ms confirmed, 1 s conservative
            min_payment_nanox: 1_000,
            accepted_tokens:   vec!["sol".into(), "native".into()],
        }
    }

    async fn lock_funds(&self, params: &EscrowParams) -> anyhow::Result<EscrowHandle> {
        let keypair = self.keypair()?;

        let request_id_bytes: [u8; 16] = params
            .request_id
            .as_bytes()
            .try_into()
            .context("SolanaSettlement: request_id UUID must be 16 bytes")?;

        let node_wallet = Pubkey::from_str(&params.node_address)
            .with_context(|| format!("SolanaSettlement: invalid node_address '{}'", params.node_address))?;

        let (escrow_pda, _) = self.escrow_pda(&request_id_bytes);

        debug!(
            request_id = %params.request_id,
            amount     = params.amount_nanox,
            node       = %node_wallet,
            escrow_pda = %escrow_pda,
            "SolanaSettlement: locking funds",
        );

        let ix = self.ix_lock_escrow(
            escrow_pda,
            keypair.pubkey(),
            node_wallet,
            request_id_bytes,
            params.amount_nanox,
            0, // use program default timeout
        );

        let sig = self
            .send_tx(&keypair, &[ix])
            .await
            .with_context(|| format!("SolanaSettlement: lock_escrow failed for {}", params.request_id))?;

        info!(
            request_id = %params.request_id,
            escrow_pda = %escrow_pda,
            sig        = %sig,
            amount     = params.amount_nanox,
            "SolanaSettlement: escrow locked",
        );

        Ok(EscrowHandle {
            settlement_id: "solana".into(),
            request_id:    params.request_id.clone(),
            amount_nanox:  params.amount_nanox,
            chain_tx_id:   Some(sig),
            payload:       serde_json::json!({
                "escrow_pda":    escrow_pda.to_string(),
                "request_id_bytes": hex::encode(request_id_bytes),
            }),
        })
    }

    async fn release_funds(
        &self,
        handle: &EscrowHandle,
        proof:  &ProofOfInference,
    ) -> anyhow::Result<()> {
        let keypair = self.keypair()?;

        let escrow_pda = handle
            .payload
            .get("escrow_pda")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("SolanaSettlement: escrow_pda missing from handle"))?;
        let escrow_pda = Pubkey::from_str(escrow_pda)
            .context("SolanaSettlement: invalid escrow_pda in handle")?;

        let proof_hash = proof.id();

        debug!(
            request_id = %handle.request_id,
            escrow_pda = %escrow_pda,
            proof_hash = hex::encode(proof_hash),
            "SolanaSettlement: releasing funds + recording proof on-chain",
        );

        // Build release_escrow + submit_proof as a single atomic transaction.
        let (score_pda, _) = self.score_pda(&proof.node_pubkey);

        let ix_release = self.ix_release_escrow(
            escrow_pda,
            keypair.pubkey(),
            proof_hash,
        );
        let ix_proof = self.ix_submit_proof(
            score_pda,
            keypair.pubkey(),
            proof_hash,
            proof.output_tokens,
            proof.latency_ms,
            handle.amount_nanox,
        );

        let sig = self
            .send_tx(&keypair, &[ix_release, ix_proof])
            .await
            .with_context(|| {
                format!("SolanaSettlement: release_escrow+submit_proof failed for {}", handle.request_id)
            })?;

        info!(
            request_id = %handle.request_id,
            sig        = %sig,
            score_pda  = %score_pda,
            new_jobs   = proof.output_tokens,
            "SolanaSettlement: funds released and proof recorded",
        );

        Ok(())
    }

    async fn refund_funds(&self, handle: &EscrowHandle) -> anyhow::Result<()> {
        let keypair = self.keypair()?;

        let escrow_pda = handle
            .payload
            .get("escrow_pda")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow!("SolanaSettlement: escrow_pda missing from handle"))?;
        let escrow_pda = Pubkey::from_str(escrow_pda)
            .context("SolanaSettlement: invalid escrow_pda in handle")?;

        debug!(
            request_id = %handle.request_id,
            escrow_pda = %escrow_pda,
            "SolanaSettlement: refunding to client",
        );

        let ix = self.ix_refund_escrow(escrow_pda, keypair.pubkey());

        let sig = self
            .send_tx(&keypair, &[ix])
            .await
            .with_context(|| {
                format!("SolanaSettlement: refund_escrow failed for {}", handle.request_id)
            })?;

        info!(
            request_id = %handle.request_id,
            sig        = %sig,
            "SolanaSettlement: funds refunded",
        );

        Ok(())
    }

    async fn get_balance(&self, address: &str) -> anyhow::Result<NanoX> {
        let pubkey = Pubkey::from_str(address)
            .with_context(|| format!("SolanaSettlement: invalid address '{address}'"))?;
        let lamports = self
            .client
            .get_balance(&pubkey)
            .await
            .with_context(|| format!("SolanaSettlement: getBalance failed for {address}"))?;
        Ok(lamports)
    }

    /// Anchor the gossip Merkle root on-chain in the node's `NodeScore` account.
    ///
    /// The label is truncated/padded to 32 bytes to fit the on-chain field.
    /// This makes the root publicly observable and tamper-evident; clients and
    /// leaderboard readers can verify any ProofOfInference using only the root
    /// and a Merkle path obtained from the P2P layer.
    async fn anchor_hash(
        &self,
        hash:  &[u8; 32],
        label: &str,
    ) -> anyhow::Result<Option<String>> {
        let keypair        = self.keypair()?;
        let node_p2p_key   = self.node_p2p_pubkey()?;
        let (score_pda, _) = self.score_pda(&node_p2p_key);

        // Pad/truncate label string to exactly 32 bytes.
        let mut label_bytes = [0u8; 32];
        let label_raw = label.as_bytes();
        let copy_len = label_raw.len().min(32);
        label_bytes[..copy_len].copy_from_slice(&label_raw[..copy_len]);

        debug!(
            label      = label,
            hash       = hex::encode(hash),
            score_pda  = %score_pda,
            "SolanaSettlement: anchoring Merkle root",
        );

        let ix = self.ix_anchor_merkle_root(score_pda, keypair.pubkey(), *hash, label_bytes);

        let sig = self
            .send_tx(&keypair, &[ix])
            .await
            .with_context(|| format!("SolanaSettlement: anchor_merkle_root failed for label '{label}'"))?;

        info!(
            sig        = %sig,
            label      = label,
            hash       = hex::encode(hash),
            score_pda  = %score_pda,
            "SolanaSettlement: Merkle root anchored on Solana",
        );

        Ok(Some(sig))
    }
}

// ---------------------------------------------------------------------------
// Unit tests (no Solana node required)
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_discriminant_is_8_bytes() {
        assert_eq!(disc_lock_escrow().len(), 8);
        assert_eq!(disc_release_escrow().len(), 8);
        assert_eq!(disc_refund_escrow().len(), 8);
        assert_eq!(disc_submit_proof().len(), 8);
        assert_eq!(disc_anchor_merkle_root().len(), 8);
    }

    #[test]
    fn test_discriminants_are_unique() {
        let discs = [
            disc_lock_escrow(),
            disc_release_escrow(),
            disc_refund_escrow(),
            disc_submit_proof(),
            disc_anchor_merkle_root(),
        ];
        for i in 0..discs.len() {
            for j in (i + 1)..discs.len() {
                assert_ne!(discs[i], discs[j], "discriminants must be unique");
            }
        }
    }

    #[test]
    fn test_encode_lock_escrow_length() {
        let data = encode_lock_escrow([0u8; 16], 1_000_000, 300);
        // discriminant(8) + request_id(16) + amount(8) + timeout(8)
        assert_eq!(data.len(), 8 + 16 + 8 + 8);
    }

    #[test]
    fn test_encode_release_escrow_length() {
        let data = encode_release_escrow([0u8; 32]);
        // discriminant(8) + proof_hash(32)
        assert_eq!(data.len(), 8 + 32);
    }

    #[test]
    fn test_encode_submit_proof_length() {
        let data = encode_submit_proof([0u8; 32], 512, 250, 5_000_000);
        // discriminant(8) + hash(32) + output_tokens(4) + latency(4) + lamports(8)
        assert_eq!(data.len(), 8 + 32 + 4 + 4 + 8);
    }

    #[test]
    fn test_encode_anchor_merkle_root_length() {
        let data = encode_anchor_merkle_root([0u8; 32], [0u8; 32]);
        // discriminant(8) + root(32) + label(32)
        assert_eq!(data.len(), 8 + 32 + 32);
    }

    #[test]
    fn test_label_padding() {
        let mut label_bytes = [0u8; 32];
        let label = "v42";
        let raw = label.as_bytes();
        label_bytes[..raw.len().min(32)].copy_from_slice(&raw[..raw.len().min(32)]);
        assert_eq!(&label_bytes[..3], b"v42");
        assert_eq!(&label_bytes[3..], &[0u8; 29]);
    }

    #[test]
    fn test_new_with_invalid_program_id_fails() {
        let cfg = SolanaConfig {
            rpc_url:             "http://localhost:8899".into(),
            program_id_str:      "not-a-valid-pubkey".into(),
            keypair_hex:         None,
            node_p2p_pubkey_hex: None,
            price_per_1k:        10,
        };
        assert!(SolanaSettlement::new(cfg).is_err());
    }

    #[test]
    fn test_new_with_valid_program_id() {
        let cfg = SolanaConfig {
            rpc_url:             "http://localhost:8899".into(),
            program_id_str:      "11111111111111111111111111111111".into(),
            keypair_hex:         None,
            node_p2p_pubkey_hex: None,
            price_per_1k:        10,
        };
        let settlement = SolanaSettlement::new(cfg);
        assert!(settlement.is_ok());
        let s = settlement.unwrap();
        assert_eq!(s.id(), "solana");
        assert!(s.capabilities().has_escrow);
        assert!(s.capabilities().is_trustless);
    }
}

//! Settlement crate — pluggable payment and escrow backends for DeAI.
//!
//! ## Architecture
//!
//! ```text
//! SettlementAdapter (trait)
//! ├── FreeSettlement          — no payment, no chain required           ✅
//! ├── SignedReceiptSettlement  — node signs proof; client trusts receipt  ✅
//! ├── PaymentChannel          — off-chain bilateral channels + on-chain  ✅ Phase F
//! ├── SuiSettlement           — Move escrow contracts on Sui             ✅ Phase D
//! └── EvmSettlement           — Solidity escrow, any EVM chain           ✅ Phase E
//! ```
//!
//! All node code holds `Vec<Arc<dyn SettlementAdapter>>`. Which adapters are
//! active is controlled entirely by `config.toml` — no code changes needed to
//! add or remove a settlement method.

pub mod adapter;
pub mod channel;
pub mod evm;
pub mod free;
pub mod receipt;
pub mod sui;

pub use adapter::{
    compatible_bids, ensure_free_fallback, select_adapter,
    EscrowHandle, EscrowParams, SettlementAdapter, SettlementCapabilities,
};
pub use channel::{ChannelChainConfig, PaymentChannel};
pub use evm::{EvmConfig, EvmSettlement};
pub use free::FreeSettlement;
pub use receipt::SignedReceiptSettlement;
pub use sui::{SuiConfig, SuiSettlement};

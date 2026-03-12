use anchor_lang::prelude::*;

/// Configuration for a single oracle feed.
/// PDA seeds: [b"feed", feed_id]
#[account]
pub struct FeedConfig {
    pub feed_id: [u8; 16],
    pub feed_version: u16,
    pub authority: Pubkey,
    pub min_signers: u8,
    pub signer_set: Vec<Pubkey>,
    pub update_cadence: u32,
    pub bump: u8,
}

impl FeedConfig {
    pub const MAX_SIGNER_SET_LEN: usize = 10;
    pub const SPACE: usize = 8 + 16 + 2 + 32 + 1 + (4 + 32 * Self::MAX_SIGNER_SET_LEN) + 4 + 1;
}

/// Latest report for a single feed.
/// PDA seeds: [b"report", feed_id]
#[account]
pub struct FeedReport {
    pub feed_id: [u8; 16],
    pub feed_version: u16,
    /// Milliseconds since epoch (matches TypeScript Date.getTime())
    pub report_timestamp: i64,
    pub value: u64,
    pub decimals: u8,
    pub confidence: u16,
    pub revision: u16,
    pub input_manifest_hash: [u8; 32],
    pub computation_hash: [u8; 32],
    pub bump: u8,
}

impl FeedReport {
    pub const SPACE: usize = 8 + 16 + 2 + 8 + 8 + 1 + 2 + 2 + 32 + 32 + 1;
}

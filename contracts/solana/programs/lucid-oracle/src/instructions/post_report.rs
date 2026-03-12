use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions as ix_sysvar;
use anchor_lang::solana_program::ed25519_program;
use crate::state::{FeedConfig, FeedReport};
use crate::errors::OracleError;

#[derive(Accounts)]
pub struct PostReport<'info> {
    #[account(
        seeds = [b"feed", &feed_config.feed_id],
        bump = feed_config.bump,
        has_one = authority,
    )]
    pub feed_config: Account<'info, FeedConfig>,

    #[account(
        mut,
        seeds = [b"report", &feed_config.feed_id],
        bump = feed_report.bump,
    )]
    pub feed_report: Account<'info, FeedReport>,

    pub authority: Signer<'info>,

    /// CHECK: Instructions sysvar — used to inspect Ed25519SigVerify instruction
    #[account(address = ix_sysvar::ID)]
    pub instructions_sysvar: AccountInfo<'info>,
}

pub fn handler(
    ctx: Context<PostReport>,
    value: u64,
    decimals: u8,
    confidence: u16,
    revision: u16,
    report_timestamp: i64,
    input_manifest_hash: [u8; 32],
    computation_hash: [u8; 32],
) -> Result<()> {
    let report = &mut ctx.accounts.feed_report;
    let config = &ctx.accounts.feed_config;

    // Lexicographic freshness: (timestamp, revision) must be strictly greater
    require!(
        report_timestamp > report.report_timestamp
            || (report_timestamp == report.report_timestamp && revision > report.revision),
        OracleError::StaleReport
    );

    // Build expected message for Ed25519 binding verification
    let expected_message = build_report_message(
        &config.feed_id,
        report_timestamp,
        value,
        decimals,
        confidence,
        revision,
        &input_manifest_hash,
        &computation_hash,
    );

    // Verify Ed25519SigVerify instruction is present with correct signer + message
    verify_ed25519_instruction(
        &ctx.accounts.instructions_sysvar,
        &config.signer_set,
        &expected_message,
    )?;

    // Write report
    report.feed_version = config.feed_version;
    report.report_timestamp = report_timestamp;
    report.value = value;
    report.decimals = decimals;
    report.confidence = confidence;
    report.revision = revision;
    report.input_manifest_hash = input_manifest_hash;
    report.computation_hash = computation_hash;

    Ok(())
}

fn build_report_message(
    feed_id: &[u8; 16],
    report_timestamp: i64,
    value: u64,
    decimals: u8,
    confidence: u16,
    revision: u16,
    input_manifest_hash: &[u8; 32],
    computation_hash: &[u8; 32],
) -> Vec<u8> {
    let mut msg = Vec::with_capacity(16 + 8 + 8 + 1 + 2 + 2 + 32 + 32);
    msg.extend_from_slice(feed_id);
    msg.extend_from_slice(&report_timestamp.to_le_bytes());
    msg.extend_from_slice(&value.to_le_bytes());
    msg.push(decimals);
    msg.extend_from_slice(&confidence.to_le_bytes());
    msg.extend_from_slice(&revision.to_le_bytes());
    msg.extend_from_slice(input_manifest_hash);
    msg.extend_from_slice(computation_hash);
    msg
}

fn verify_ed25519_instruction(
    instructions_sysvar: &AccountInfo,
    signer_set: &[Pubkey],
    expected_message: &[u8],
) -> Result<()> {
    let num_instructions = ix_sysvar::load_current_index_checked(instructions_sysvar)
        .map_err(|_| error!(OracleError::MissingSigVerify))?;

    for i in 0..num_instructions {
        let ix = ix_sysvar::load_instruction_at_checked(i as usize, instructions_sysvar)
            .map_err(|_| error!(OracleError::MissingSigVerify))?;

        if ix.program_id != ed25519_program::ID {
            continue;
        }

        if ix.data.len() < 2 {
            continue;
        }

        let num_sigs = ix.data[0] as usize;
        if num_sigs == 0 {
            continue;
        }

        let offset_base = 2;
        if ix.data.len() < offset_base + 14 {
            continue;
        }

        let pubkey_offset = u16::from_le_bytes([ix.data[offset_base + 4], ix.data[offset_base + 5]]) as usize;
        let msg_offset = u16::from_le_bytes([ix.data[offset_base + 8], ix.data[offset_base + 9]]) as usize;
        let msg_size = u16::from_le_bytes([ix.data[offset_base + 10], ix.data[offset_base + 11]]) as usize;

        if ix.data.len() < pubkey_offset + 32 {
            continue;
        }
        let pubkey_bytes: [u8; 32] = ix.data[pubkey_offset..pubkey_offset + 32]
            .try_into()
            .unwrap();
        let signer_pubkey = Pubkey::from(pubkey_bytes);

        if !signer_set.contains(&signer_pubkey) {
            return Err(error!(OracleError::UnauthorizedSigner));
        }

        if ix.data.len() < msg_offset + msg_size {
            continue;
        }
        let msg_bytes = &ix.data[msg_offset..msg_offset + msg_size];

        if msg_bytes != expected_message {
            return Err(error!(OracleError::MessageMismatch));
        }

        return Ok(());
    }

    Err(error!(OracleError::MissingSigVerify))
}

use anchor_lang::prelude::*;
use crate::state::{FeedConfig, FeedReport};
use crate::errors::OracleError;

#[derive(Accounts)]
#[instruction(feed_id: [u8; 16])]
pub struct InitializeFeed<'info> {
    #[account(
        init,
        payer = authority,
        space = FeedConfig::SPACE,
        seeds = [b"feed", &feed_id],
        bump,
    )]
    pub feed_config: Account<'info, FeedConfig>,

    #[account(
        init,
        payer = authority,
        space = FeedReport::SPACE,
        seeds = [b"report", &feed_id],
        bump,
    )]
    pub feed_report: Account<'info, FeedReport>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeFeed>,
    feed_id: [u8; 16],
    feed_version: u16,
    update_cadence: u32,
    signer_set: Vec<Pubkey>,
) -> Result<()> {
    require!(
        signer_set.len() <= FeedConfig::MAX_SIGNER_SET_LEN,
        OracleError::SignerSetTooLarge
    );

    let config = &mut ctx.accounts.feed_config;
    config.feed_id = feed_id;
    config.feed_version = feed_version;
    config.authority = ctx.accounts.authority.key();
    config.min_signers = 1;
    config.signer_set = signer_set;
    config.update_cadence = update_cadence;
    config.bump = ctx.bumps.feed_config;

    let report = &mut ctx.accounts.feed_report;
    report.feed_id = feed_id;
    report.feed_version = feed_version;
    report.report_timestamp = 0;
    report.value = 0;
    report.decimals = 0;
    report.confidence = 0;
    report.revision = 0;
    report.input_manifest_hash = [0u8; 32];
    report.computation_hash = [0u8; 32];
    report.bump = ctx.bumps.feed_report;

    Ok(())
}

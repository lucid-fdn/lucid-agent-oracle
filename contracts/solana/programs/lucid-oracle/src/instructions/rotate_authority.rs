use anchor_lang::prelude::*;
use crate::state::FeedConfig;
use crate::errors::OracleError;

#[derive(Accounts)]
pub struct RotateAuthority<'info> {
    #[account(
        mut,
        seeds = [b"feed", &feed_config.feed_id],
        bump = feed_config.bump,
        has_one = authority,
    )]
    pub feed_config: Account<'info, FeedConfig>,

    pub authority: Signer<'info>,
}

pub fn handler(ctx: Context<RotateAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(new_authority != Pubkey::default(), OracleError::ZeroAuthority);
    ctx.accounts.feed_config.authority = new_authority;
    Ok(())
}

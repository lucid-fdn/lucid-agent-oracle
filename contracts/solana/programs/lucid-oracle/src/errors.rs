use anchor_lang::prelude::*;

#[error_code]
pub enum OracleError {
    #[msg("Report timestamp is stale")]
    StaleReport,
    #[msg("Ed25519 signature verification instruction not found")]
    MissingSigVerify,
    #[msg("Ed25519 signer not in signer_set")]
    UnauthorizedSigner,
    #[msg("Ed25519 message does not match report data")]
    MessageMismatch,
    #[msg("Signer set exceeds maximum length")]
    SignerSetTooLarge,
    #[msg("Authority cannot be the zero pubkey")]
    ZeroAuthority,
}

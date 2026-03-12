import type { OracleClickHouse, PublishedFeedRow, PublicationRequest } from '@lucid/oracle-core'

export interface PublicationStatusResult {
  skipSolana: boolean
  skipBase: boolean
}

export async function recordPublicationStatus(
  clickhouse: OracleClickHouse,
  req: PublicationRequest,
  solanaTxHash: string | null,
  baseTxHash: string | null,
): Promise<PublicationStatusResult> {
  const existing = await clickhouse.queryPublicationStatus(
    req.feed_id, req.feed_version, req.computed_at, req.revision,
  )

  const skipSolana = existing?.published_solana != null
  const skipBase = existing?.published_base != null

  const effectiveSolana = skipSolana ? existing!.published_solana : solanaTxHash
  const effectiveBase = skipBase ? existing!.published_base : baseTxHash

  if (effectiveSolana == null && effectiveBase == null) {
    return { skipSolana, skipBase }
  }

  const row: PublishedFeedRow = {
    feed_id: req.feed_id,
    feed_version: req.feed_version,
    computed_at: req.computed_at,
    revision: req.revision,
    pub_status_rev: (existing?.pub_status_rev ?? 0) + 1,
    value_json: req.value_json,
    value_usd: req.value_usd,
    value_index: req.value_index,
    confidence: req.confidence,
    completeness: req.completeness,
    freshness_ms: 0,
    staleness_risk: 'low',
    revision_status: 'preliminary',
    methodology_version: req.methodology_version,
    input_manifest_hash: req.input_manifest_hash,
    computation_hash: req.computation_hash,
    signer_set_id: req.signer_set_id,
    signatures_json: req.signatures_json,
    source_coverage: JSON.stringify(['lucid_gateway']),
    published_solana: effectiveSolana,
    published_base: effectiveBase,
  }

  await clickhouse.insertPublishedFeedValue(row)
  return { skipSolana, skipBase }
}

export async function checkAlreadyPublished(
  clickhouse: OracleClickHouse,
  req: PublicationRequest,
): Promise<PublicationStatusResult> {
  const existing = await clickhouse.queryPublicationStatus(
    req.feed_id, req.feed_version, req.computed_at, req.revision,
  )
  return {
    skipSolana: existing?.published_solana != null,
    skipBase: existing?.published_base != null,
  }
}

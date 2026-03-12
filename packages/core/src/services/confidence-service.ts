import { CONFIDENCE_WEIGHTS, type ConfidenceInputs } from '../types/quality.js'

/**
 * Compute deterministic confidence score from normalized inputs.
 * All inputs must be in [0, 1] where higher = more confident.
 * Formula version is embedded in CONFIDENCE_WEIGHTS.version.
 */
export function computeConfidence(inputs: ConfidenceInputs): number {
  const w = CONFIDENCE_WEIGHTS
  const raw =
    clamp01(inputs.source_diversity_score) * w.source_diversity_score +
    clamp01(inputs.identity_confidence) * w.identity_confidence +
    clamp01(inputs.data_completeness) * w.data_completeness +
    clamp01(inputs.anomaly_cleanliness) * w.anomaly_cleanliness +
    clamp01(inputs.freshness_score) * w.freshness_score +
    clamp01(inputs.revision_stability) * w.revision_stability

  return clamp01(raw)
}

/** Compute freshness score with exponential decay */
export function computeFreshnessScore(
  ageMs: number,
  expectedIntervalMs: number,
): number {
  if (expectedIntervalMs <= 0) return 0
  return Math.exp(-ageMs / expectedIntervalMs)
}

/** Determine staleness risk level from age vs expected interval */
export function computeStalenessRisk(
  ageMs: number,
  expectedIntervalMs: number,
): 'low' | 'medium' | 'high' {
  const ratio = ageMs / expectedIntervalMs
  if (ratio < 2) return 'low'
  if (ratio < 5) return 'medium'
  return 'high'
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

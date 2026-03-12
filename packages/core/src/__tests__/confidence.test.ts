import { describe, it, expect } from 'vitest'
import { computeConfidence } from '../services/confidence-service.js'
import type { ConfidenceInputs } from '../types/quality.js'

describe('computeConfidence', () => {
  it('returns 1.0 for perfect inputs', () => {
    const inputs: ConfidenceInputs = {
      source_diversity_score: 1.0,
      identity_confidence: 1.0,
      data_completeness: 1.0,
      anomaly_cleanliness: 1.0,
      freshness_score: 1.0,
      revision_stability: 1.0,
    }
    expect(computeConfidence(inputs)).toBeCloseTo(1.0, 4)
  })

  it('returns 0.0 for zero inputs', () => {
    const inputs: ConfidenceInputs = {
      source_diversity_score: 0,
      identity_confidence: 0,
      data_completeness: 0,
      anomaly_cleanliness: 0,
      freshness_score: 0,
      revision_stability: 0,
    }
    expect(computeConfidence(inputs)).toBeCloseTo(0.0, 4)
  })

  it('weights source diversity highest (0.25)', () => {
    const base: ConfidenceInputs = {
      source_diversity_score: 0,
      identity_confidence: 0,
      data_completeness: 0,
      anomaly_cleanliness: 0,
      freshness_score: 0,
      revision_stability: 0,
    }
    const withDiversity = { ...base, source_diversity_score: 1.0 }
    const withFreshness = { ...base, freshness_score: 1.0 }
    expect(computeConfidence(withDiversity)).toBeGreaterThan(
      computeConfidence(withFreshness),
    )
    expect(computeConfidence(withDiversity)).toBeCloseTo(0.25, 4)
    expect(computeConfidence(withFreshness)).toBeCloseTo(0.10, 4)
  })

  it('clamps output to [0, 1]', () => {
    const inputs: ConfidenceInputs = {
      source_diversity_score: 1.5,
      identity_confidence: 1.0,
      data_completeness: 1.0,
      anomaly_cleanliness: 1.0,
      freshness_score: 1.0,
      revision_stability: 1.0,
    }
    expect(computeConfidence(inputs)).toBeLessThanOrEqual(1.0)
  })
})

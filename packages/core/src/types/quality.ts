/** Quality envelope attached to every metric response.
 *  Provides transparency about data reliability at the response level. */
export interface QualityEnvelope {
  /** Deterministic confidence score [0.0, 1.0] — computed from versioned formula */
  confidence: number
  /** Data completeness ratio [0.0, 1.0] — % of expected data points present */
  completeness: number
  /** Age of newest input event in milliseconds */
  freshness_ms: number
  /** Risk assessment based on data staleness */
  staleness_risk: 'low' | 'medium' | 'high'
  /** Current revision status of this data point */
  revision: RevisionStatus
  /** Which data sources contributed to this computation */
  source_coverage: Record<string, boolean>
}

/** Revision lifecycle of a data point */
export type RevisionStatus = 'preliminary' | 'revised' | 'final' | 'exceptional'

/** Normalized inputs to the deterministic confidence formula.
 *  All values must be in [0, 1] where higher = more confident. */
export interface ConfidenceInputs {
  /** Ratio of reporting sources that contributed data */
  source_diversity_score: number
  /** Average entity resolution confidence across subjects */
  identity_confidence: number
  /** Percentage of expected data points present */
  data_completeness: number
  /** 1.0 if clean, decays with anomaly detection flags */
  anomaly_cleanliness: number
  /** exp(-age / expected_interval) — decays with staleness */
  freshness_score: number
  /** 1.0 - revision_probability — stability of the data point */
  revision_stability: number
}

/** Confidence formula weights — versioned for reproducibility.
 *  Sum of weights must equal 1.0. */
export const CONFIDENCE_WEIGHTS = {
  version: 1,
  source_diversity_score: 0.25,
  identity_confidence: 0.20,
  data_completeness: 0.20,
  anomaly_cleanliness: 0.15,
  freshness_score: 0.10,
  revision_stability: 0.10,
} as const

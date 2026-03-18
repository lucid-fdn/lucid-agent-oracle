/**
 * Custom OpenTelemetry metrics for the Oracle system.
 *
 * Metric naming follows OTel semantic conventions:
 *   oracle.{domain}.{metric_name}
 */
import { metrics } from '@opentelemetry/api'

const meter = metrics.getMeter('oracle', '0.1.0')

// ── Feed computation metrics ─────────────────────────────────

/** Feed value published (gauge per feed) */
export const feedValue = meter.createObservableGauge('oracle.feed.value', {
  description: 'Latest computed feed value',
  unit: '{value}',
})

/** Feed computation duration */
export const feedComputeDuration = meter.createHistogram('oracle.feed.compute_duration', {
  description: 'Time to compute a single feed value',
  unit: 'ms',
})

/** Feed publication count */
export const feedPublishCount = meter.createCounter('oracle.feed.publish_total', {
  description: 'Total feed publications (on-chain + stream)',
  unit: '{publication}',
})

/** Feed confidence score (gauge per feed) */
export const feedConfidence = meter.createObservableGauge('oracle.feed.confidence', {
  description: 'Latest feed confidence score [0,1]',
  unit: '{ratio}',
})

// ── Worker cycle metrics ─────────────────────────────────────

/** Worker cycle duration */
export const workerCycleDuration = meter.createHistogram('oracle.worker.cycle_duration', {
  description: 'Duration of a single worker poll-compute-publish cycle',
  unit: 'ms',
})

/** Events ingested per cycle */
export const workerEventsIngested = meter.createCounter('oracle.worker.events_ingested', {
  description: 'Total raw events ingested into ClickHouse',
  unit: '{event}',
})

/** Checkpoint lag (ms behind real-time) */
export const workerCheckpointLag = meter.createHistogram('oracle.worker.checkpoint_lag', {
  description: 'Time lag between newest event and checkpoint',
  unit: 'ms',
})

// ── SSE streaming metrics ────────────────────────────────────

/** Active SSE connections (gauge) */
export const sseActiveConnections = meter.createUpDownCounter('oracle.sse.active_connections', {
  description: 'Number of active SSE connections',
  unit: '{connection}',
})

/** SSE events sent */
export const sseEventsSent = meter.createCounter('oracle.sse.events_sent', {
  description: 'Total SSE events sent to clients',
  unit: '{event}',
})

// ── Webhook delivery metrics ─────────────────────────────────

/** Webhook deliveries attempted */
export const webhookDeliveryAttempts = meter.createCounter('oracle.webhook.delivery_attempts', {
  description: 'Total webhook delivery attempts',
  unit: '{attempt}',
})

/** Webhook delivery duration */
export const webhookDeliveryDuration = meter.createHistogram('oracle.webhook.delivery_duration', {
  description: 'Time to deliver a webhook (HTTP POST)',
  unit: 'ms',
})

/** Webhook delivery outcomes */
export const webhookDeliveryResult = meter.createCounter('oracle.webhook.delivery_result', {
  description: 'Webhook delivery outcomes by status',
  unit: '{delivery}',
})

/** Webhook retry queue depth */
export const webhookRetryQueueDepth = meter.createUpDownCounter('oracle.webhook.retry_queue_depth', {
  description: 'Number of pending webhook retries',
  unit: '{message}',
})

// ── API request metrics (supplementing auto-instrumentation) ─

/** API request count by tier */
export const apiRequestsByTier = meter.createCounter('oracle.api.requests_by_tier', {
  description: 'API requests broken down by plan tier',
  unit: '{request}',
})

/** EventBus emit count */
export const eventBusEmitCount = meter.createCounter('oracle.eventbus.emit_total', {
  description: 'Events emitted through the EventBus',
  unit: '{event}',
})

/** EventBus buffer overflow drops */
export const eventBusDropCount = meter.createCounter('oracle.eventbus.buffer_drops', {
  description: 'Events dropped due to EventBus buffer overflow',
  unit: '{event}',
})

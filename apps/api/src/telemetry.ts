/**
 * OpenTelemetry instrumentation — shared across API, worker, webhook-worker.
 *
 * Must be imported BEFORE any other modules (Fastify, pg, redis, etc.)
 * so that auto-instrumentation can patch them.
 *
 * Usage:
 *   node --import tsx/esm --require ./telemetry-register.cjs apps/api/src/server.ts
 *   Or: import './telemetry.js' as the FIRST line of the entry point.
 */
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

const OTEL_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318'
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME ?? 'oracle-api'

const resource = new Resource({
  [ATTR_SERVICE_NAME]: SERVICE_NAME,
  [ATTR_SERVICE_VERSION]: '0.1.0',
  'deployment.environment': process.env.NODE_ENV ?? 'development',
})

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: `${OTEL_ENDPOINT}/v1/traces`,
  }),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: `${OTEL_ENDPOINT}/v1/metrics`,
    }),
    exportIntervalMillis: 15_000,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy fs instrumentation
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // Configure HTTP to capture request/response details
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingPaths: ['/health', '/metrics'],
      },
    }),
  ],
})

export function startTelemetry(): void {
  if (process.env.OTEL_ENABLED === 'false') return
  sdk.start()
  console.log(`[otel] Telemetry started → ${OTEL_ENDPOINT} (service: ${SERVICE_NAME})`)
}

export async function shutdownTelemetry(): Promise<void> {
  await sdk.shutdown()
}

export { sdk }

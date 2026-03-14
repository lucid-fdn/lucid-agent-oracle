# Plan 3B: MCP Tools — Design Specification

**Date:** 2026-03-14
**Status:** Approved for implementation planning
**Depends on:** Plan 3A v2 (complete), oracle-core attestation service, ClickHouse schema

---

## 1. Goal

Make the Lucid Agent Economy Oracle queryable by every AI agent via MCP. Ship a curated 9-tool MCP release — 6 free, 3 pro — generated from the OpenAPI spec by Speakeasy. OpenAPI is the single source of truth for REST API, MCP tools, and future SDK generation.

## 2. Architecture

```
TypeBox schemas (source of truth)
    ↓
@fastify/swagger → OpenAPI 3.0 JSON
    ↓
x-speakeasy-mcp annotations (curate which endpoints become tools)
    ↓
Speakeasy CLI → apps/mcp/ (generated MCP server)
    ↓
Thin HTTP client calling Oracle REST API
```

The MCP server is a **separate process** that calls the Oracle API over HTTP. It does not import the service layer directly. This keeps the API as the single deployment boundary for business logic. The MCP server is stateless and trivially scalable.

**Transports:** stdio (local — Claude Desktop, Cursor, etc.) + SSE (remote — deployed on Railway).

## 3. New API Endpoints

Three new endpoints are required before MCP generation. They follow Plan 3A v2 patterns: TypeBox schemas, OpenAPI annotations, Redis cache, rate-limit config, RFC 9457 errors.

### 3.1 GET /v1/oracle/feeds/:id/history

**Purpose:** Time-series feed values from ClickHouse.

**Tier gating:** Free = period <= 7d. Pro/Growth = up to 90d.

**Query parameters:**

| Param | Type | Default | Values |
|-------|------|---------|--------|
| `period` | string | `'7d'` | `'1d'`, `'7d'`, `'30d'`, `'90d'` |
| `interval` | string | `'1h'` | `'1m'`, `'1h'`, `'1d'` |

**Response (200):**

```json
{
  "data": {
    "feed_id": "aegdp",
    "period": "7d",
    "interval": "1h",
    "has_data": true,
    "points": [
      {
        "timestamp": "2026-03-13T00:00:00Z",
        "value": "{\"value_usd\":12345.67}",
        "confidence": 0.85
      }
    ]
  }
}
```

**Empty result:** `has_data: false`, `points: []`. Not an error — 200 with empty data.

**ClickHouse query:**

```sql
SELECT
  toStartOfInterval(computed_at, INTERVAL {interval}) AS timestamp,
  argMax(value_json, computed_at) AS value,
  argMax(confidence, computed_at) AS confidence
FROM published_feed_values
WHERE feed_id = {feed_id}
  AND feed_version = {version}
  AND computed_at >= now() - INTERVAL {period}
GROUP BY timestamp
ORDER BY timestamp ASC
```

Uses `argMax` to pick the latest value within each interval bucket, avoiding duplicates from revisions.

**Errors:**
- 404: Feed not found (invalid feed_id)
- 403: Period exceeds tier limit

**Cache:** 60s TTL, key: `oracle:feed:history:{feed_id}:{period}:{interval}:{plan}`

**Rate limit:** 30 req/min

**Schema:** `tags: ['feeds']`, `summary: 'Get feed history'`

### 3.2 GET /v1/oracle/agents/model-usage

**Purpose:** LLM model/provider distribution across the agent economy.

**Tier:** Pro required.

**Query parameters:**

| Param | Type | Default | Values |
|-------|------|---------|--------|
| `period` | string | `'7d'` | `'1d'`, `'7d'`, `'30d'` |
| `limit` | integer | `20` | `1`-`50` |

**Response (200):**

```json
{
  "data": {
    "period": "7d",
    "has_data": true,
    "models": [
      {
        "model_id": "claude-sonnet-4-5-20250514",
        "provider": "anthropic",
        "event_count": 15420,
        "pct": 34.2
      }
    ],
    "total_events": 45100
  }
}
```

**Empty result:** `has_data: false`, `models: []`, `total_events: 0`.

**ClickHouse query:**

```sql
SELECT
  model_id,
  provider,
  count() AS event_count
FROM raw_economic_events
WHERE event_type = 'llm_inference'
  AND event_timestamp >= now() - INTERVAL {period}
  AND model_id IS NOT NULL
  AND model_id != ''
GROUP BY model_id, provider
ORDER BY event_count DESC
LIMIT {limit}
```

`pct` is computed application-side from `event_count / total_events * 100`, rounded to 1 decimal.

**Errors:**
- 403: Free tier (requires pro)

**Cache:** 120s TTL, key: `oracle:model-usage:{period}:{limit}:{plan}`

**Rate limit:** 30 req/min

**Schema:** `tags: ['agents']`, `summary: 'Get model usage distribution'`

### 3.3 POST /v1/oracle/reports/verify

**Purpose:** Verify a signed oracle report envelope — Ed25519 signature + payload integrity.

**Tier:** Free (verification is a trust feature, should be accessible to all).

**Request body:**

```json
{
  "report": {
    "feeds": [ ... ],
    "computed_at": "2026-03-13T00:00:00Z",
    "signer": "base64-pubkey",
    "signature": "base64-sig",
    "input_manifest_hash": "sha256hex",
    "computation_hash": "sha256hex"
  }
}
```

The `report` field accepts the full signed report envelope as produced by `AttestationService.sign()`.

**Response (200):**

```json
{
  "data": {
    "valid": true,
    "checks": {
      "signature": "pass",
      "payload_integrity": "pass",
      "signer": "base64-pubkey"
    },
    "publication": {
      "solana_tx": "abc123..." ,
      "base_tx": null
    }
  }
}
```

**Verification steps:**

1. **Signature check:** Use `AttestationService.verify()` from `oracle-core` to verify Ed25519 signature against the canonical JSON payload.
2. **Payload integrity:** Recompute canonical JSON hash of the report body (excluding signature fields) and compare against `computation_hash`.
3. **Publication lookup:** If the report contains a `feed_id` + `computed_at`, query `published_feed_values` in ClickHouse for matching `published_solana` / `published_base` tx hashes. Return null if no on-chain publication found. **No live RPC calls** — this is a lookup against stored state only.

**Errors:**
- 400: Invalid report format (missing required fields)

**Cache:** None (POST, unique payloads).

**Rate limit:** 10 req/min (prevent abuse of crypto verification).

**Schema:** `tags: ['reports']`, `summary: 'Verify oracle report'`

## 4. MCP Tool Curation

### 4.1 The 9 Tools

| # | Tool Name | Maps To | Tier | Description |
|---|-----------|---------|------|-------------|
| 1 | `oracle_economy_snapshot` | `GET /feeds` | Free | Current state of the agent economy — all 3 feed values with confidence and freshness |
| 2 | `oracle_feed_value` | `GET /feeds/:id` + `GET /feeds/:id/methodology` | Free | Deep dive on a single feed with methodology context |
| 3 | `oracle_agent_lookup` | `GET /agents/:id` | Free | Agent profile — wallets, protocols, reputation, stats |
| 4 | `oracle_agent_search` | `GET /agents/search` | Free | Find agents by wallet, protocol, ERC-8004 ID, or name |
| 5 | `oracle_protocol_stats` | `GET /protocols` + `GET /protocols/:id` | Free | Protocol listing and detail with agent/wallet counts |
| 6 | `oracle_verify_report` | `POST /reports/verify` | Free | Verify signed oracle report — signature + integrity + publication status |
| 7 | `oracle_agent_deep_metrics` | `GET /agents/:id/metrics` + `GET /agents/:id/activity` | Pro | Full agent dossier — wallet/evidence/protocol breakdowns + activity feed |
| 8 | `oracle_feed_history` | `GET /feeds/:id/history` | Pro | Time-series feed values for trend analysis |
| 9 | `oracle_model_usage` | `GET /agents/model-usage` | Pro | LLM model/provider distribution across the agent economy |

### 4.2 Composite Tools

Tools 2, 5, and 7 combine multiple API endpoints into a single tool invocation. Speakeasy's `x-speakeasy-mcp` supports grouping operations under a single tool name. The MCP server makes multiple HTTP calls and merges the responses.

- **`oracle_feed_value`**: Calls feed detail + methodology, returns unified object
- **`oracle_protocol_stats`**: When given a protocol ID, calls detail endpoint. Without ID, calls list endpoint.
- **`oracle_agent_deep_metrics`**: Calls metrics + activity (first page), returns combined result

### 4.3 Excluded Endpoints

| Endpoint | Reason |
|----------|--------|
| `GET /agents/leaderboard` | Dashboard/SDK surface, not a natural agent query |
| `GET /protocols/:id/metrics` | Folded into `oracle_protocol_stats` composite |
| `GET /health` | Infrastructure |
| Identity/admin routes | Internal |

### 4.4 OpenAPI Annotations

Tools are annotated in the Fastify route schemas using Speakeasy extensions:

```typescript
// Included as tool:
schema: {
  'x-speakeasy-mcp': {
    'tool-name': 'oracle_economy_snapshot',
    description: 'Get current state of the agent economy — AEGDP, AAI, APRI feed values.',
  },
  // ... existing schema
}

// Excluded:
schema: {
  'x-speakeasy-mcp': { disabled: true },
  // ... existing schema
}
```

If TypeBox `extensions` don't propagate cleanly to the Swagger output, a post-processing step on the exported `openapi.json` adds the annotations before Speakeasy generation.

## 5. Speakeasy Integration

### 5.1 Generation Pipeline

```bash
# 1. Export OpenAPI spec from running Fastify
curl http://localhost:4040/docs/json > openapi.json

# 2. Validate spec
speakeasy validate -s openapi.json

# 3. Generate MCP server
speakeasy generate -s openapi.json -o apps/mcp -t typescript
```

### 5.2 Package Structure

```
apps/mcp/
  package.json            — @lucid/oracle-mcp
  src/
    index.ts              — Entry point (stdio + SSE transport)
  .speakeasy/
    gen.yaml              — Generation config
speakeasy.yaml            — Root config (org: lucidflare)
openapi.json              — Build artifact (gitignored)
```

### 5.3 Speakeasy Config

```yaml
# speakeasy.yaml
configVersion: 2.0.0
generation:
  sdkClassName: LucidOracle
  targetLanguage: typescript
mcpServerOptions:
  serverName: lucid-oracle-mcp
  serverVersion: 1.0.0
```

### 5.4 Deployment

- **Local/stdio:** `npx @lucid/oracle-mcp` — agents connect via stdio (Claude Desktop, Cursor, etc.)
- **Remote/SSE:** Deployed on Railway alongside the API, separate port. Agents connect via SSE URL.
- Both transports are generated by Speakeasy.

### 5.5 API Base URL

The MCP server reads `ORACLE_API_URL` env var (defaults to `http://localhost:4040`). In production, this points to the deployed API.

API key passthrough: The MCP server forwards the connecting agent's API key (from MCP auth context or env var `ORACLE_API_KEY`) as `x-api-key` header on all API calls.

## 6. Empty Data Handling

ClickHouse-backed endpoints (feed_history, model_usage) may return empty results if:
- The deployment hasn't accumulated data yet
- The requested time range has no events
- The feed worker hasn't run

**Contract:**
- Always return 200 with `has_data: false` and empty arrays
- Never return 404 for empty data (404 is reserved for invalid IDs)
- Never return mock/synthetic data
- MCP tool descriptions should note that empty results mean "no data available for this period" not "error"

## 7. Testing Strategy

### 7.1 API Endpoint Tests (~15 new tests)

**`feed-history.test.ts`** (~6 tests):
- Returns time-series for valid feed_id
- Returns `has_data: false` with empty points when no data
- Rejects invalid feed_id (404)
- Free tier capped at 7d (403 for 30d/90d)
- Validates interval parameter
- Cache key includes plan tier

**`model-usage.test.ts`** (~4 tests):
- Returns model breakdown with percentages
- Returns `has_data: false` when empty
- Requires pro tier (403 for free)
- Respects limit parameter

**`verify-report.test.ts`** (~5 tests):
- Valid report passes all checks
- Tampered signature fails
- Tampered payload fails integrity check
- Returns publication tx hashes when available
- Returns null publication when no on-chain data

### 7.2 OpenAPI Spec Validation

Build step: export spec → `speakeasy validate` → verify all 9 tool annotations present, excluded endpoints disabled. Runs as CI check.

### 7.3 MCP Server Smoke Test

Post-generation: `npx @modelcontextprotocol/inspector` against generated server. Verify 9 tools listed with correct schemas. Manual/CI verification.

### 7.4 Test Targets

- New API tests: ~15
- Existing tests: 242
- Total target: **257+**

## 8. Scope Boundaries

### In scope (Plan 3B)

- 3 new API endpoints (feed_history, model_usage, verify_report)
- OpenAPI `x-speakeasy-mcp` annotations on all route schemas
- Speakeasy-generated MCP server (`apps/mcp/`)
- 9 curated tools (6 free + 3 pro)
- ~15 new tests

### Out of scope (future waves)

- **Wave 2:** `oracle_tool_popularity`, `oracle_cost_index`, `oracle_chain_heatmap`
- **Wave 3:** `oracle_set_alert`, `oracle_demand_signals`, `oracle_raw_query`
- **Plan 3C:** TypeScript SDK (`@lucidai/oracle`)
- **Plan 3D:** Dashboard (Next.js)
- **Plan 3E:** SSE streaming + webhook alerts

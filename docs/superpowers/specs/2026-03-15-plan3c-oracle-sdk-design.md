# Plan 3C: Oracle TypeScript SDK — Design Spec

## 1. Overview

**Goal:** Publish `@lucid-fdn/oracle`, an open-source TypeScript SDK for the Lucid Agent Oracle API. The SDK provides typed access to all 15 public endpoints with clean resource-oriented naming (`oracle.feeds.list()`, `oracle.agents.search()`).

**Approach:** Overlay-driven Speakeasy generation. The raw OpenAPI spec is exported from the oracle monorepo. A Speakeasy overlay file applies SDK-specific naming, grouping, and configuration. Speakeasy generates 100% of the SDK code. No hand-written wrapper layer.

**Repo:** `lucid-fdn/oracle-sdk-node` (separate public GitHub repo)
**npm:** `@lucid-fdn/oracle`
**Base URL:** `https://api.lucid.foundation`

---

## 2. Architecture

### 2.1 Repo Structure

```
oracle-sdk-node/
  openapi/
    openapi.yaml          # Raw OpenAPI spec (exported from oracle monorepo)
    overlay.yaml          # Speakeasy overlay: naming, grouping, pagination, errors
  .speakeasy/
    gen.yaml              # SDK package config, auth, retries
    workflow.yaml         # Source pipeline: spec + overlay → typescript
  src/                    # 100% Speakeasy-generated TypeScript
  package.json            # Generated (name: @lucid-fdn/oracle)
  tsconfig.json           # Generated
  README.md               # Generated + hand-edited for DX docs
  LICENSE                 # Apache-2.0
```

### 2.2 Generation Pipeline

The OpenAPI spec originates in the oracle monorepo. The SDK repo consumes it.

**In the oracle monorepo (`lucid-agent-oracle`):**
```bash
CURSOR_SECRET=test npx tsx scripts/export-openapi.ts > openapi.json
```

This exports the full 15-endpoint spec without needing a running database (uses stub DB for route registration). The overlay sets the production server URL, so the export script's default `localhost:4040` is overridden.

**In the SDK repo (`oracle-sdk-node`):**
```bash
# Copy spec from oracle monorepo (or CI fetches it)
cp ../lucid-agent-oracle/openapi.json openapi/openapi.json

# Generate SDK (overlay applied automatically via workflow.yaml)
speakeasy run
```

`speakeasy run` reads `workflow.yaml`, applies the overlay to the spec, and generates the TypeScript SDK into `src/`.

### 2.3 What Lives Where

| Oracle monorepo | SDK repo |
|-----------------|----------|
| `scripts/export-openapi.ts` — spec export | `openapi/openapi.json` — spec copy |
| `scripts/annotate-openapi.ts` — MCP annotations only | `openapi/overlay.yaml` — SDK naming/grouping |
| API source of truth | SDK source of truth |
| `apps/mcp/` — MCP server (separate Speakeasy target) | `src/` — generated SDK |

---

## 3. Speakeasy Configuration

### 3.1 Overlay (`openapi/overlay.yaml`)

The overlay maps every public endpoint to a clean `resource.verb()` name using Speakeasy's `x-speakeasy-group` and `x-speakeasy-name-override` extensions. It also hides non-public endpoints with `x-speakeasy-ignore`.

```yaml
overlay: 1.0.0
info:
  title: Lucid Oracle SDK Overlay
  version: 1.0.0
actions:
  # --- Feeds ---
  - target: $.paths["/v1/oracle/feeds"].get
    update:
      x-speakeasy-group: feeds
      x-speakeasy-name-override: list
  - target: $.paths["/v1/oracle/feeds/{id}"].get
    update:
      x-speakeasy-group: feeds
      x-speakeasy-name-override: get
  - target: $.paths["/v1/oracle/feeds/{id}/methodology"].get
    update:
      x-speakeasy-group: feeds
      x-speakeasy-name-override: methodology
  - target: $.paths["/v1/oracle/feeds/{id}/history"].get
    update:
      x-speakeasy-group: feeds
      x-speakeasy-name-override: history

  # --- Agents ---
  - target: $.paths["/v1/oracle/agents/search"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: search
  - target: $.paths["/v1/oracle/agents/leaderboard"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: leaderboard
  - target: $.paths["/v1/oracle/agents/model-usage"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: modelUsage
  - target: $.paths["/v1/oracle/agents/{id}"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: get
  - target: $.paths["/v1/oracle/agents/{id}/metrics"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: metrics
  - target: $.paths["/v1/oracle/agents/{id}/activity"].get
    update:
      x-speakeasy-group: agents
      x-speakeasy-name-override: activity

  # --- Protocols ---
  - target: $.paths["/v1/oracle/protocols"].get
    update:
      x-speakeasy-group: protocols
      x-speakeasy-name-override: list
  - target: $.paths["/v1/oracle/protocols/{id}"].get
    update:
      x-speakeasy-group: protocols
      x-speakeasy-name-override: get
  - target: $.paths["/v1/oracle/protocols/{id}/metrics"].get
    update:
      x-speakeasy-group: protocols
      x-speakeasy-name-override: metrics

  # --- Reports ---
  - target: $.paths["/v1/oracle/reports/latest"].get
    update:
      x-speakeasy-group: reports
      x-speakeasy-name-override: latest
  - target: $.paths["/v1/oracle/reports/verify"].post
    update:
      x-speakeasy-group: reports
      x-speakeasy-name-override: verify

  # --- Hide non-public ---
  - target: $.paths["/health"].get
    update:
      x-speakeasy-ignore: true

  # --- Server URL override ---
  - target: $.servers[0]
    update:
      url: https://api.lucid.foundation
```

Identity and admin routes (`/v1/oracle/agents/challenge`, `/v1/oracle/agents/register`, `/v1/internal/*`) are already excluded by the `export-openapi.ts` script which only registers public routes.

### 3.2 gen.yaml (`.speakeasy/gen.yaml`)

```yaml
configVersion: 2.0.0
generation:
  sdkClassName: LucidOracle
  auth:
    envVarPrefix: LUCID_ORACLE
typescript:
  version: 0.1.0
  author: Lucid Foundation
  packageName: "@lucid-fdn/oracle"
```

Key settings:
- **`sdkClassName: LucidOracle`** — the main class name
- **`envVarPrefix: LUCID_ORACLE`** — SDK auto-reads `LUCID_ORACLE_API_KEY` from env (derived from scheme name `apiKey` + prefix)
- **`packageName: @lucid-fdn/oracle`** — npm package identity

> **Note:** This is a seed configuration. `speakeasy run` will expand it with additional fields (fixes, usageSnippets, responseFormat, etc.) on first generation. The monorepo-root `speakeasy.yaml` is for the MCP target only and is unrelated to this config.

### 3.3 workflow.yaml (`.speakeasy/workflow.yaml`)

```yaml
workflowVersion: 1.0.0
sources:
  oracle-api:
    inputs:
      - location: openapi/openapi.json
    overlays:
      - location: openapi/overlay.yaml
targets:
  sdk:
    target: typescript
    source: oracle-api
```

---

## 4. SDK Public Surface

### 4.1 Constructor

```typescript
import { LucidOracle } from '@lucid-fdn/oracle'

// Auto-reads LUCID_ORACLE_API_KEY from env
const oracle = new LucidOracle()

// Explicit API key
const oracle = new LucidOracle({ apiKey: 'sk_...' })

// Custom server URL (for local dev or staging)
const oracle = new LucidOracle({
  apiKey: 'sk_...',
  serverURL: 'http://localhost:4040',
})
```

### 4.2 Resource Methods

All methods return typed response objects. Speakeasy generates request/response types from the TypeBox schemas in the OpenAPI spec.

#### Feeds (all free tier)

| Method | Endpoint | Auth |
|--------|----------|------|
| `oracle.feeds.list()` | `GET /v1/oracle/feeds` | Free |
| `oracle.feeds.get({ id })` | `GET /v1/oracle/feeds/:id` | Free |
| `oracle.feeds.methodology({ id })` | `GET /v1/oracle/feeds/:id/methodology` | Free |
| `oracle.feeds.history({ id, period?, interval? })` | `GET /v1/oracle/feeds/:id/history` | Free (7d), Pro (30d/90d) |

#### Agents

| Method | Endpoint | Auth |
|--------|----------|------|
| `oracle.agents.search({ q, cursor?, limit? })` | `GET /v1/oracle/agents/search` | Free |
| `oracle.agents.leaderboard({ sort?, cursor?, limit? })` | `GET /v1/oracle/agents/leaderboard` | Free |
| `oracle.agents.get({ id })` | `GET /v1/oracle/agents/:id` | Free |
| `oracle.agents.metrics({ id })` | `GET /v1/oracle/agents/:id/metrics` | Pro |
| `oracle.agents.activity({ id, cursor?, limit? })` | `GET /v1/oracle/agents/:id/activity` | Pro |
| `oracle.agents.modelUsage({ period?, limit? })` | `GET /v1/oracle/agents/model-usage` | Pro |

#### Protocols

| Method | Endpoint | Auth |
|--------|----------|------|
| `oracle.protocols.list()` | `GET /v1/oracle/protocols` | Free |
| `oracle.protocols.get({ id })` | `GET /v1/oracle/protocols/:id` | Free |
| `oracle.protocols.metrics({ id })` | `GET /v1/oracle/protocols/:id/metrics` | Pro |

#### Reports

| Method | Endpoint | Auth |
|--------|----------|------|
| `oracle.reports.latest()` | `GET /v1/oracle/reports/latest` | Free |
| `oracle.reports.verify({ ...reportEnvelope })` | `POST /v1/oracle/reports/verify` | Free |

### 4.3 Error Handling

Speakeasy generates typed error responses from the OpenAPI spec. The generated client exposes SDK error classes for non-2xx responses. Exact class names and shapes are verified after generation — the directional contract is:

```typescript
try {
  const agent = await oracle.agents.get({ id: 'nonexistent' })
} catch (err) {
  // Generated SDK error with status code, response body, raw Response
  // Exact class name determined by Speakeasy generation output
}
```

API error codes propagated: 400 (validation), 401 (invalid key), 403 (tier required), 404 (not found), 429 (rate limited), 500 (internal). All errors follow RFC 9457 Problem Details format.

### 4.4 Auth Model

**API key is optional globally.** Free-tier endpoints work anonymously with no key. Some endpoints require auth and a specific plan tier. The SDK must not make auth feel mandatory.

| Scenario | Behavior |
|----------|----------|
| No key, no env var | Anonymous — free-tier endpoints work, pro endpoints return 403 |
| `LUCID_ORACLE_API_KEY` env var set | Auto-used (via `envVarPrefix`); tier determined by key's plan |
| `apiKey` passed to constructor | Takes precedence over env var |
| Invalid/revoked key | 401 error |
| Free key hitting pro endpoint | 403 error |

### 4.5 Pagination

Cursor-paginated endpoints (search, leaderboard, activity) return `{ data, pagination: { next_cursor, has_more, limit } }`. The API uses `snake_case` field names; the generated SDK may camelCase them (e.g., `nextCursor`, `hasMore`) depending on Speakeasy's naming config. The exact field casing is verified after generation.

```typescript
let cursor: string | undefined
do {
  const page = await oracle.agents.search({ q: 'lucid', cursor })
  for (const agent of page.data) { /* ... */ }
  // Field name may be next_cursor or nextCursor depending on generation output
  cursor = page.pagination.next_cursor ?? undefined
} while (cursor)
```

Auto-pagination via `x-speakeasy-pagination` can be added in a future overlay update if demand warrants it. For v0.1.0, manual cursor passing matches the API contract directly.

---

## 5. Implementation Scope

### 5.1 What Gets Built

**Prerequisite:** The SDK assumes the Oracle API's OpenAPI spec is complete and validated. Any missing schema fidelity (weak response types, inconsistent security annotations, missing examples) is a blocker, not "future cleanup." The spec export from Plan 3B covers all 15 endpoints with TypeBox schemas.

**In the oracle monorepo (`lucid-agent-oracle`):**
1. Verify the exported OpenAPI spec has complete schemas for all 15 endpoints (done in Plan 3B)
2. No other changes needed — `export-openapi.ts` exports JSON, overlay overrides the server URL

**In the SDK repo (`oracle-sdk-node`):**
1. Create the repo structure: `openapi/`, `.speakeasy/`, `LICENSE`, `.gitignore`
2. Write `openapi/overlay.yaml` with all 15 endpoint mappings
3. Write `.speakeasy/gen.yaml` with package config
4. Write `.speakeasy/workflow.yaml` for the generation pipeline
5. Copy the exported OpenAPI spec to `openapi/openapi.json`
6. Run `speakeasy run` to generate the SDK
7. Verify generation succeeds and types are correct
8. Write a README with usage examples
9. Publish v0.1.0 to npm as `@lucid-fdn/oracle`

### 5.2 What's Deferred

- **Auto-pagination** (`x-speakeasy-pagination`) — add when users request it
- **Retries** (`x-speakeasy-retries`) — add global retry policy later
- **CI/CD** — GitHub Actions for auto-regeneration on spec changes
- **Multi-language SDKs** — Python, Go (same overlay, different Speakeasy target)
- **Webhook/SSE support** — depends on Plan 3E

### 5.3 Testing Strategy

Speakeasy generates the SDK with its own test scaffolding. For v0.1.0, the test suite must cover more than compilation:

**Compile-time checks:**
- `tsc --noEmit` passes
- All 15 endpoints present as typed methods on their resource groups (feeds/agents/protocols/reports)

**Smoke tests (per resource group, against running oracle API):**
- `feeds.list()` — returns feed array with expected shape
- `agents.search({ q: 'test' })` — returns paginated response
- `protocols.list()` — returns protocol array
- `reports.latest()` — returns report or null

**Auth behavior:**
- Anonymous client can call free-tier endpoints successfully
- Anonymous client gets 403 on pro-tier endpoint (`agents.metrics`)
- Authenticated client can call pro-tier endpoints

**Pagination round-trip:**
- `agents.leaderboard({ limit: 1 })` → get cursor → pass cursor → get next page

**Error contract:**
- 404 on `agents.get({ id: 'nonexistent' })` — error has status code + problem details
- 400 on `agents.search({})` (missing required param)

---

## 6. Constraints & Decisions

| Decision | Rationale |
|----------|-----------|
| Overlay-driven, not wrapper-driven | Eliminates drift between spec and SDK; single source of truth |
| Separate repo | Open-source friendly; independent release cycle; industry standard |
| `@lucid-fdn/oracle` on npm | Matches new org identity |
| `envVarPrefix: LUCID_ORACLE` | Zero-config auth in server environments |
| Base URL `https://api.lucid.foundation` | Unified domain; infrastructure-agnostic |
| Version in path (`/v1/`) not server variable | Speakeasy recommendation; stable routing |
| Manual pagination for v0.1.0 | Simple, matches API contract; auto-pagination deferred |
| Apache-2.0 license | Standard for open-source SDKs |

### 6.1 Method Name Stability

The SDK's public method names (e.g., `oracle.feeds.list()`) are stable as long as:
- The API path stays the same, OR
- The overlay target is updated when a path changes

If a path is renamed or removed in the API without an overlay update, Speakeasy generation will either produce a broken overlay (if the target doesn't match) or silently drop the method. The overlay must be kept in sync with the API spec on every SDK release. CI validation (deferred) should catch this automatically.

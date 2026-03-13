# Plan 4B: Self-Registration + Identity Evidence + Conflict Review — Design Specification

**Date:** 2026-03-12
**Status:** Implemented
**Authors:** RaijinLabs + Claude
**Parent spec:** `docs/specs/2026-03-12-agent-economy-oracle-design.md`
**Depends on:** Plan 4A (External Adapters + Identity Resolution)
**Unlocks:** Plan 3A (API expansion with Agents as first-class noun)

---

## 1. Goal

Make Agents a populated, claimable identity — not an empty shell backed only by ERC-8004 on-chain registration.

Plan 4B adds:
- **Self-registration endpoint** — agents claim wallets with cryptographic proof (EVM `personal_sign` + Solana Ed25519), the highest-confidence identity strategy in the parent design (§5.2)
- **Identity evidence model** — first-class table for all identity proofs, replacing 4A's inline `evidence_json` approach
- **Conflict review tooling** — admin endpoints for manual resolution when two entities claim the same wallet
- **Lucid-native batch resolver** — carried-over 4A completion item that populates the agent table from `gateway_tenants.payment_config`

**Design principle:** Conservative conflict handling. Every cross-entity wallet claim goes to manual review. No auto-win, no silent reassignment. Automated merge/split is deferred to Plan 4C.

---

## 2. Architecture

### 2.1 Self-Registration Flow

Two-step challenge-response:

```
Step 1: Issue Challenge
    POST /v1/oracle/agents/challenge
    { chain, address, target_entity?, auth_chain?, auth_address?, auth_signature? }
    (auth fields required when target_entity is set — see Section 2.4)
        │
        ▼
    Server generates nonce, stores challenge
    Returns: { nonce, message, expires_at }

Step 2: Submit Registration
    POST /v1/oracle/agents/register
    { nonce, signature }
        │
        ▼
    ┌─────────────────────────────────┐
    │  Registration Handler           │
    │  1. Lookup challenge by nonce   │
    │  2. Reject if expired/consumed  │
    │  3. Verify signature (EVM/Sol)  │
    │                                 │
    │  ── BEGIN TRANSACTION ────────  │
    │  4. Find-or-create agent_entity │
    │  5. Re-validate target_entity    │
    │     (if set, check mapping      │
    │      still active — race guard) │
    │  6. Store identity_evidence     │
    │  7. Upsert wallet_mapping       │
    │     (link_type: 'self_claim',   │
    │      confidence: 1.0)           │
    │     (evidence inserted first so │
    │      claim_evidence_id is       │
    │      always populated on        │
    │      conflict rows)             │
    │  8. Consume nonce               │
    │  ── COMMIT ───────────────────  │
    │                                 │
    │  9. Publish watchlist update    │
    │     (after commit — side effect │
    │      only on successful write)  │
    └─────────────────────────────────┘
        │
        ▼
    Returns: { agent_entity_id, wallets[], evidence_id }
```

### 2.2 Challenge Format

The signed message is human-readable, environment-bound, and replay-resistant:

```
Lucid Agent Oracle — Wallet Verification

Action: Link wallet to agent identity
Agent: <agent_entity_id or "new">
Wallet: <address>
Chain: <chain>
Environment: <production|staging>
Domain: oracle.lucid.foundation
Nonce: <UUID v4>
Issued: <ISO 8601 UTC>
Expires: <ISO 8601 UTC>
```

- **Nonce**: Server-generated UUID v4, stored in `registration_challenges` table
- **Validity window**: 5 minutes from issuance
- **One-time consumption**: Nonce is consumed on successful registration, rejected if reused
- **Environment binding**: Prevents cross-environment replay

### 2.3 Signature Encoding

**EVM (Base, Ethereum, Arbitrum, Polygon, Optimism, Gnosis):**
- Method: `personal_sign` (EIP-191)
- Signature format: `0x`-prefixed hex string (65 bytes: r + s + v)
- Verification: `ethers.verifyMessage(message, signature)` recovers signer address, compared case-insensitively to claimed address
- The message is UTF-8 encoded and prefixed with `\x19Ethereum Signed Message:\n{length}` per EIP-191

**Solana:**
- Method: Ed25519 `sign` over raw message bytes
- Signature format: base58-encoded (64 bytes)
- Address format: base58-encoded public key (32 bytes)
- Verification: `@noble/ed25519.verify(signature, messageBytes, publicKey)` — returns boolean
- The message is UTF-8 encoded to bytes before signing (no additional prefix)

### 2.4 Existing Entity Authorization

**Critical security rule:** A wallet can only attach to an existing `agent_entity` if the caller already controls a wallet mapped to that entity.

**Authentication model:** The challenge endpoint requires **cryptographic proof** of entity ownership via an `auth_address` — a wallet already mapped to the target entity. The caller provides `{ chain, address, target_entity, auth_chain, auth_address, auth_signature }`. The new wallet to claim is `(chain, address)`. The proof of entity ownership is `(auth_chain, auth_address, auth_signature)`.

The `auth_signature` is a signature from `auth_address` over a canonical consent message:

```
Lucid Agent Oracle — Entity Authorization

Action: Authorize wallet attachment
Entity: <target_entity>
New Wallet: <address>
New Chain: <chain>
Auth Wallet: <auth_address>
Auth Chain: <auth_chain>
Environment: <production|staging>
Timestamp: <ISO 8601 UTC>
```

This message is **not** nonce-gated (the challenge nonce protects the registration itself). The timestamp prevents indefinite replay; the server rejects auth signatures older than 5 minutes.

Enforcement at challenge issuance:
- If `target_entity` is null → challenge issued for "new" entity creation (always allowed, no auth fields needed)
- If `target_entity` is set:
  - `auth_chain`, `auth_address`, and `auth_signature` are all required
  - Server verifies `auth_signature` using the appropriate `WalletVerifier` for `auth_chain` — this proves the caller **controls** auth_address, not just knows it
  - Server verifies that `(auth_chain, auth_address)` is in `wallet_mappings` for `target_entity` with `removed_at IS NULL`
  - If both pass → challenge issued with `target_entity` bound
  - If signature invalid → 401 Unauthorized: "Auth signature verification failed"
  - If wallet not mapped → 403 Forbidden: "Auth address not mapped to target entity"
  - The challenge message includes both the new wallet and the auth wallet for transparency

**Re-validation at registration time (race guard):** When the registration handler processes a challenge with `target_entity` set (step 5 in the flow), it re-checks that `(auth_chain, auth_address)` still has an active mapping to `target_entity`. If the mapping was removed during the challenge window (e.g., by an admin conflict resolution or an `OwnershipTransferred` event), the registration is rejected with 403: "Authorization expired — auth wallet no longer mapped to target entity."

This prevents both:
- A fresh wallet from attaching itself to an entity it doesn't control
- A stale challenge from completing after the caller's authorization has been revoked

### 2.5 Transactionality

The registration write path (steps 4–8) executes within a single Postgres transaction. This ensures:
- No partial state if the process crashes between mapping and nonce consumption
- The nonce cannot be consumed without the mapping being committed
- On rollback, neither evidence nor mapping is persisted

The watchlist publish (step 9) fires **after** commit — it is a side effect that only executes on successful writes. If the publish fails, the mapping is still committed; the watchlist will catch up on the next registration or batch resolver run.

The batch resolver (Section 5) follows the same principle: each tenant's resolution runs in a single transaction.

### 2.6 Self-Registration Data Values

When a self-registration succeeds, the following values are written:

**`wallet_mappings` row:**
- `link_type`: `'self_claim'` (new value — added to `WalletLinkType` in `identity.ts`)
- `confidence`: `1.0` (top of parent spec's 0.95–1.0 range for explicit claims — cryptographic proof warrants maximum confidence)
- `evidence_hash`: SHA-256 of the signed message

**`identity_evidence` row:**
- `evidence_type`: `'signed_message'`
- `chain`, `address`, `signature`, `message`, `nonce`: from the challenge + registration
- `metadata_json`: `{ "verification_method": "personal_sign" | "ed25519" }`

**No `identity_link` row.** Self-registration is wallet ownership proof, not a cross-protocol link. The `wallet_mapping` + `identity_evidence` pair is the complete artifact. `identity_links` are for protocol-level links (ERC-8004, Lucid tenant) — self-registration is chain-level, not protocol-level.

### 2.7 HTTP Response Codes

| Scenario | Endpoint | Status | Body |
|----------|----------|--------|------|
| Challenge issued | POST /challenge | 200 | `{ nonce, message, expires_at }` |
| Auth signature invalid | POST /challenge | 401 | `{ error: "Auth signature verification failed" }` |
| Auth wallet not mapped | POST /challenge | 403 | `{ error: "Auth address not mapped to target entity" }` |
| Rate limited | POST /challenge | 429 | `{ error: "Rate limit exceeded", retry_after_ms }` |
| Registration success | POST /register | 200 | `{ agent_entity_id, wallets[], evidence_id }` |
| Challenge expired | POST /register | 410 Gone | `{ error: "Challenge expired" }` |
| Challenge already consumed | POST /register | 410 Gone | `{ error: "Challenge already consumed" }` |
| Challenge not found | POST /register | 404 | `{ error: "Challenge not found" }` |
| Signature verification failed | POST /register | 401 | `{ error: "Signature verification failed" }` |
| Auth wallet revoked (race) | POST /register | 403 | `{ error: "Authorization expired" }` |
| Conflict detected | POST /register | 409 Conflict | `{ error: "Wallet claimed by another entity", conflict_id }` |
| Rate limited | POST /register | 429 | `{ error: "Rate limit exceeded", retry_after_ms }` |

### 2.8 Conflict Detection

When a wallet is already mapped to a different entity:

| Scenario | Action |
|----------|--------|
| Wallet not mapped to any entity | Create mapping, no conflict |
| Wallet already mapped to **same** entity | Update evidence (re-verification), no conflict |
| Wallet mapped to **different** entity | **Always: log conflict, keep existing, require admin review** |

No auto-win. No silent reassignment. Every cross-entity wallet claim creates an `identity_conflicts` row.

Auto-win based on confidence ranking is deferred to Plan 4C when merge/split infrastructure exists.

---

## 3. Signature Verification — Two Verifiers, One Interface

```typescript
interface WalletVerifier {
  readonly chains: readonly string[]
  verify(address: string, message: string, signature: string): Promise<boolean>
}
```

| Verifier | Chains | Method | Library |
|----------|--------|--------|---------|
| `EvmVerifier` | `base`, `ethereum`, `arbitrum`, `polygon`, `gnosis`, `optimism` | `ethers.verifyMessage()` — recovers signer from `personal_sign`, case-insensitive address comparison | `ethers` (v6) |
| `SolanaVerifier` | `solana` | `@noble/ed25519.verify()` — Ed25519 signature over UTF-8 message bytes | `@noble/ed25519` (already a dep) |

Both are stateless pure functions. A `VerifierRegistry` (same pattern as `AdapterRegistry`) maps chain → verifier at startup.

---

## 4. Control Plane Tables

### 4.1 registration_challenges

```sql
CREATE TABLE registration_challenges (
  nonce           TEXT PRIMARY KEY,       -- UUID v4
  chain           TEXT NOT NULL,
  address         TEXT NOT NULL,
  target_entity   TEXT,                   -- NULL = "new", else existing entity ID
  auth_chain      TEXT,                   -- chain of the authorizing wallet (when target_entity set)
  auth_address    TEXT,                   -- address of the authorizing wallet (when target_entity set)
  message         TEXT NOT NULL,          -- the full signable message
  environment     TEXT NOT NULL,          -- 'production' | 'staging'
  issued_at       TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,   -- issued_at + 5 min
  consumed_at     TIMESTAMPTZ             -- NULL = unused, set on successful registration
);

CREATE INDEX idx_challenges_lookup
  ON registration_challenges(chain, address) WHERE consumed_at IS NULL;
CREATE INDEX idx_challenges_expiry
  ON registration_challenges(expires_at) WHERE consumed_at IS NULL;
```

Expired challenges cleaned up by periodic sweep every 15 minutes (DELETE WHERE expires_at < now() - interval '1 hour'). Also runs on API startup.

**Note:** `auth_chain` and `auth_address` are included inline in the CREATE TABLE above.

### 4.2 identity_evidence

Promoted from inline `evidence_json` (4A) to first-class table per parent spec §4.5.

```sql
CREATE TABLE identity_evidence (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agent_entity    TEXT NOT NULL REFERENCES agent_entities(id),
  evidence_type   TEXT NOT NULL,          -- 'signed_message' | 'on_chain_proof' | 'gateway_correlation'
  chain           TEXT,
  address         TEXT,
  signature       TEXT,                   -- the raw signature (for signed_message)
  message         TEXT,                   -- the signed message (for signed_message)
  nonce           TEXT,                   -- challenge nonce (for signed_message)
  verified_at     TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ,            -- NULL = never expires
  revoked_at      TIMESTAMPTZ,            -- NULL = active
  metadata_json   JSONB                   -- flexible: tx_hash, block, tenant_id, etc.
);

CREATE INDEX idx_evidence_entity ON identity_evidence(agent_entity);
CREATE INDEX idx_evidence_chain_address ON identity_evidence(chain, address);

-- Dedup: one active gateway_correlation per (entity, type, chain, address)
CREATE UNIQUE INDEX idx_evidence_dedup_correlation
  ON identity_evidence(agent_entity, evidence_type, chain, address)
  WHERE evidence_type = 'gateway_correlation' AND revoked_at IS NULL;

-- Dedup: one active signed_message per (entity, chain, address)
-- Re-verification revokes the previous evidence and creates a new one.
-- Multiple active proofs for the same wallet are not allowed.
CREATE UNIQUE INDEX idx_evidence_dedup_signed
  ON identity_evidence(agent_entity, evidence_type, chain, address)
  WHERE evidence_type = 'signed_message' AND revoked_at IS NULL;
```

### 4.3 identity_conflicts

```sql
CREATE TABLE identity_conflicts (
  id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chain               TEXT NOT NULL,
  address             TEXT NOT NULL,
  existing_entity     TEXT NOT NULL REFERENCES agent_entities(id),
  claiming_entity     TEXT NOT NULL REFERENCES agent_entities(id),
  existing_confidence REAL NOT NULL,
  claiming_confidence REAL NOT NULL,
  claim_evidence_id   BIGINT REFERENCES identity_evidence(id),
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolution          TEXT
                      CHECK (resolution IS NULL OR resolution IN ('keep_existing', 'keep_claiming', 'merge')),
  resolved_by         TEXT,                            -- admin identifier
  resolution_reason   TEXT,                            -- free-text audit note
  resolved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conflicts_status ON identity_conflicts(status) WHERE status = 'open';
```

### 4.4 Schema Migration for agent_entities

```sql
-- Add UNIQUE constraint on lucid_tenant (was indexed but not unique in 4A)
CREATE UNIQUE INDEX idx_agent_entities_lucid_unique
  ON agent_entities(lucid_tenant) WHERE lucid_tenant IS NOT NULL;
```

---

## 5. Lucid-Native Batch Resolver (4A Completion)

Carried-over 4A item. Populates the agent table from `gateway_tenants.payment_config`.

### 5.1 Concurrency Guard

Uses Postgres advisory lock to guarantee single-writer:

```sql
SELECT pg_try_advisory_lock(hashtext('lucid_resolver'))
```

- If lock acquired → run batch, release on completion
- If lock held → skip silently (another instance is running)
- Same lock used by both startup and admin-triggered runs

This is the correct simplification per 4A's "resolver runs inside the API process" rule. When the resolver becomes its own service (future), this becomes a proper distributed lock.

### 5.2 Resolution Flow

```
Acquire advisory lock (or skip)
    │
    ▼
Query: SELECT id, payment_config FROM gateway_tenants
       WHERE payment_config IS NOT NULL
       AND payment_config->'wallets' IS NOT NULL
    │
    ▼
For each tenant with payment_config.wallets[]:
    │
    ├── Check agent_entities for lucid_tenant = tenant.id
    │   ├── Exists → use existing entity
    │   └── Not found → check if any wallet already maps to an ERC-8004 entity
    │       ├── Yes → enrich that entity (SET lucid_tenant = tenant.id)
    │       └── No → create new entity (id = 'ae_' + nanoid, lucid_tenant = tenant.id)
    │
    ├── For each wallet in payment_config.wallets[]:
    │   ├── INSERT identity_evidence ... ON CONFLICT DO NOTHING RETURNING id
    │   │   evidence_type: 'gateway_correlation'
    │   │   metadata_json: { tenant_id, source: 'payment_config' }
    │   │   If RETURNING yields no row (conflict), SELECT id WHERE dedup columns match
    │   │   → evidence_id is always available for conflict rows
    │   │
    │   ├── Check wallet_mappings(chain, address) WHERE removed_at IS NULL
    │   │   ├── Not mapped → INSERT wallet_mapping (link_type: 'lucid_passport', confidence: 1.0)
    │   │   ├── Mapped to same entity → skip (idempotent)
    │   │   └── Mapped to different entity → INSERT identity_conflicts
    │   │       (claim_evidence_id = evidence_id from above, always populated)
    │   │       skip mapping
    │
    ├── Upsert identity_link (protocol: 'lucid', protocol_id: tenant.id, link_type: 'gateway_correlation')
    │   ON CONFLICT (protocol, protocol_id) DO NOTHING
    │
    └── Publish wallet_watchlist.updated for any NEW Solana wallets added
        (only wallets that were actually inserted, not skipped)
```

### 5.3 Cross-Source Merge (ERC-8004 ↔ Lucid)

When a Lucid tenant's wallet already has an ERC-8004 agent entity:

1. Link `lucid_tenant` to the existing ERC-8004 entity (`UPDATE agent_entities SET lucid_tenant = $1 WHERE id = $2`)
2. Upsert `identity_links` row for `protocol = 'lucid'`
3. Store `identity_evidence` with `evidence_type = 'gateway_correlation'`
4. Publish `wallet_watchlist.updated` for any new Solana wallets the Lucid side contributes

This is enrichment, not conflict — one canonical entity gains a second protocol link.

### 5.4 Idempotency

The resolver is fully idempotent:
- `agent_entities`: `lucid_tenant` has UNIQUE constraint; uses `ON CONFLICT DO NOTHING` for inserts, conditional `UPDATE` for enrichment (only if `lucid_tenant IS NULL`)
- `wallet_mappings`: partial unique index `(chain, address) WHERE removed_at IS NULL`
- `identity_links`: existing `UNIQUE (protocol, protocol_id)`
- `identity_evidence`: dedup indexes prevent duplicate rows
- Can run on every startup without side effects

---

## 6. Admin Conflict Review

### 6.1 Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/v1/internal/identity/conflicts` | List open conflicts (paginated) | `X-Admin-Key` |
| GET | `/v1/internal/identity/conflicts/:id` | Single conflict detail with evidence | `X-Admin-Key` |
| PATCH | `/v1/internal/identity/conflicts/:id` | Resolve conflict | `X-Admin-Key` |
| POST | `/v1/internal/identity/resolve-lucid` | Re-trigger Lucid batch resolver | `X-Admin-Key` |

### 6.2 Resolution Actions

When an admin resolves a conflict via PATCH:

**`keep_existing`:**
- Set conflict `status = 'resolved'`, `resolution = 'keep_existing'`
- No mapping changes — existing mapping stays
- Log: admin, timestamp, reason

**`keep_claiming`:**
- Soft-delete existing mapping (`SET removed_at = now()`)
- Create new mapping for claiming entity
- Publish `wallet_watchlist.updated` (remove old, add new)
- Set conflict `status = 'resolved'`, `resolution = 'keep_claiming'`
- Log: admin, timestamp, reason

**`merge`:**
- Flag for future implementation (Plan 4C automated merge)
- For now: set status = `'resolved'`, `resolution = 'merge'`, log admin note
- Actual entity merge not performed in 4B

### 6.3 Audit Trail

Every admin resolution is fully auditable via the `identity_conflicts` table:
- `resolved_by`: admin identifier (from `X-Admin-Key` lookup)
- `resolution_reason`: free-text note explaining the decision
- `resolved_at`: timestamp
- All mapping changes are tracked through `wallet_mappings.removed_at` and new insert rows

---

## 7. Rate Limiting

| Endpoint | Limit | Scope |
|----------|-------|-------|
| `POST /agents/challenge` | 10 req/min | per `(chain, address)` |
| `POST /agents/register` | 5 req/min | per `(chain, address)` |
| `POST /agents/challenge` | 30 req/min | per IP |
| `POST /agents/register` | 15 req/min | per IP |

Implemented via in-memory rate limiter (same pattern as existing 402 rate limiting in the gateway). Not a Redis dependency.

---

## 8. New Files

### New files

```
# Verifiers (packages/core — pure, stateless, reusable)
packages/core/src/identity/evm-verifier.ts          — EVM personal_sign verification
packages/core/src/identity/solana-verifier.ts        — Solana Ed25519 verification
packages/core/src/identity/verifier-registry.ts      — Chain → verifier lookup registry
packages/core/src/identity/challenge.ts              — Challenge message generation + formatting

# API routes + services (apps/api)
apps/api/src/routes/identity-registration.ts         — POST /agents/challenge, POST /agents/register
apps/api/src/routes/identity-admin.ts                — GET/PATCH /conflicts, POST /resolve-lucid
apps/api/src/services/lucid-resolver.ts              — Batch resolver for gateway_tenants
apps/api/src/services/registration-handler.ts        — Orchestrates verify → entity → mapping → evidence

# Tests
packages/core/src/__tests__/evm-verifier.test.ts     — EVM signature verification (4 tests)
packages/core/src/__tests__/solana-verifier.test.ts   — Solana signature verification (4 tests)
packages/core/src/__tests__/verifier-registry.test.ts — Verifier registry lookup (3 tests)
packages/core/src/__tests__/challenge.test.ts         — Challenge message generation (unit, 3 tests)
apps/api/src/__tests__/challenge.test.ts              — Challenge endpoint integration (6 tests)
apps/api/src/__tests__/registration.test.ts           — Full registration flow (8 tests)
apps/api/src/__tests__/lucid-resolver.test.ts         — Batch resolver (5 tests)
apps/api/src/__tests__/conflict-review.test.ts        — Admin conflict review (4 tests)
apps/api/src/__tests__/registration-race.test.ts      — Concurrency (2 tests + 2 race conditions)

# Migration
migrations/supabase/20260313_identity_4b.sql            — identity_evidence, registration_challenges,
                                                        identity_conflicts, lucid_tenant unique index
```

### Modified files

```
packages/core/src/types/identity.ts                  — Extend WalletLinkType with 'self_claim'
packages/core/src/index.ts                           — Export verifier interfaces + implementations
packages/core/package.json                           — Add ethers dependency
apps/api/src/server.ts                               — Wire Lucid resolver at startup + registration routes
```

---

## 9. What Plan 4B Does NOT Include

| Deferred Item | Target Plan |
|---------------|-------------|
| Automated entity merge/split | Plan 4C |
| Behavioral heuristic linking (timing, interaction graphs) | Plan 4C |
| Gateway correlation at sub-1.0 confidence (currently 1.0 per 4A deterministic-only stance) | Plan 4C |
| ClickHouse backfill on entity resolution changes | Plan 4C |
| Feed recomputation on merge/split | Plan 4C |
| Confidence auto-win (new claim overrides weaker existing) | Plan 4C |

---

## 10. Success Criteria

Plan 4B is complete when:
1. Lucid-native batch resolver populates `agent_entities` from `gateway_tenants.payment_config`
2. Cross-source merge enriches ERC-8004 entities with Lucid tenant links (not duplicates)
3. Self-registration endpoint accepts EVM `personal_sign` and Solana Ed25519 proofs
4. Challenge lifecycle is replay-resistant (nonce consumed exactly once, 5-min expiry)
5. Existing entity attachment requires cryptographic proof (`auth_signature`) of control over a mapped wallet
6. All wallet conflicts logged to `identity_conflicts`, never silently resolved
7. Admin endpoints allow manual conflict review with full audit trail
8. `identity_evidence` table stores all proofs with dedup indexes
9. Advisory lock prevents concurrent batch resolver runs
10. Registration write path is transactional (no partial state on crash)
11. ~41 new tests pass (190+ total across all suites)

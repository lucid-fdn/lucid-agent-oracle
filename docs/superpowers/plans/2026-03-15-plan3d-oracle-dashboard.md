# Plan 3D: Oracle Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an extraction-ready Oracle dashboard in LucidMerged's `(oracle)/` route group, served at `oracle.lucid.foundation`, using `@lucid-fdn/oracle` SDK for all data fetching.

**Architecture:** Self-contained Next.js route group following the `(launchpad)/` pattern — server layout with feature flag gate, client layout with Oracle-specific nav/ticker, React Query hooks wrapping the SDK, domain-specific components in `src/components/oracle/`, no cross-route-group imports.

**Tech Stack:** Next.js 15 (App Router), React 19, `@lucid-fdn/oracle` SDK, TanStack React Query 5, TradingView Lightweight Charts, Recharts, Radix UI, Tailwind CSS, motion/react.

**Working directory:** `C:\LucidMerged`

**Spec:** `C:\lucid-agent-oracle\docs\superpowers\specs\2026-03-15-plan3d-oracle-dashboard-design.md`

---

## File Map

### New files — `src/lib/oracle/` (data layer)

| File | Responsibility |
|------|---------------|
| `src/lib/oracle/cache-keys.ts` | Parameterized query key builders |
| `src/lib/oracle/data-provider.tsx` | OracleContext: SDK instance via context, `useOracleClient()` hook |
| `src/lib/oracle/hooks.ts` | 14 React Query hooks wrapping SDK calls |
| `src/lib/oracle/report-mapper.ts` | `mapWireReportToSdk()` — snake_case → camelCase for verifier |

### New files — `src/components/oracle/` (UI components)

| File | Responsibility |
|------|---------------|
| `src/components/oracle/oracle-nav.tsx` | Navigation bar (glass morphism, mobile menu) |
| `src/components/oracle/stats-ticker.tsx` | Scrolling feed values + LIVE dot |
| `src/components/oracle/feed-card.tsx` | Feed summary card (value, confidence, staleness) |
| `src/components/oracle/feed-chart.tsx` | TradingView Lightweight Charts wrapper (dynamic import, SSR-safe) |
| `src/components/oracle/feed-methodology.tsx` | Expandable methodology accordion |
| `src/components/oracle/agent-card.tsx` | Agent summary card |
| `src/components/oracle/agent-metrics.tsx` | Detailed agent metrics (Recharts pie/bar) |
| `src/components/oracle/agent-activity.tsx` | Activity timeline |
| `src/components/oracle/protocol-card.tsx` | Protocol summary card with chain badges |
| `src/components/oracle/protocol-metrics.tsx` | Protocol detailed metrics |
| `src/components/oracle/leaderboard-table.tsx` | Sortable leaderboard with pagination |
| `src/components/oracle/search-bar.tsx` | Debounced agent/protocol search |
| `src/components/oracle/model-usage-chart.tsx` | Recharts horizontal bar for model distribution |
| `src/components/oracle/report-verifier.tsx` | JSON paste → verify → pass/fail display |
| `src/components/oracle/pro-gate.tsx` | Frosted "Upgrade to Pro" overlay |

### New files — `src/app/(oracle)/` (route group)

| File | Responsibility |
|------|---------------|
| `src/app/(oracle)/layout.tsx` | Server layout: feature flag gate + metadata |
| `src/app/(oracle)/oracle-client-layout.tsx` | Client layout: OracleDataProvider + nav + ticker + shell |
| `src/app/(oracle)/error.tsx` | Route-group error boundary |
| `src/app/(oracle)/not-found.tsx` | 404 page |
| `src/app/(oracle)/page.tsx` | Home: feed hero + stats + leaderboard preview + protocol grid |
| `src/app/(oracle)/loading.tsx` | Home skeleton |
| `src/app/(oracle)/feeds/[id]/page.tsx` | Feed detail: chart + methodology |
| `src/app/(oracle)/feeds/[id]/loading.tsx` | Feed detail skeleton |
| `src/app/(oracle)/agents/page.tsx` | Agents: search + leaderboard + model usage tabs |
| `src/app/(oracle)/agents/loading.tsx` | Agents skeleton |
| `src/app/(oracle)/agents/[id]/page.tsx` | Agent detail: profile + metrics + activity |
| `src/app/(oracle)/agents/[id]/loading.tsx` | Agent detail skeleton |
| `src/app/(oracle)/protocols/page.tsx` | Protocol list grid |
| `src/app/(oracle)/protocols/loading.tsx` | Protocols skeleton |
| `src/app/(oracle)/protocols/[id]/page.tsx` | Protocol detail + metrics |
| `src/app/(oracle)/protocols/[id]/loading.tsx` | Protocol detail skeleton |
| `src/app/(oracle)/reports/page.tsx` | Latest report + verifier |
| `src/app/(oracle)/reports/loading.tsx` | Reports skeleton |

### Modified files

| File | Change |
|------|--------|
| `src/lib/features.ts` | Add `oracleDashboard` flag |
| `src/middleware.ts` | Add oracle domain rewrite + `/oracle` public route |
| `package.json` | Add `@lucid-fdn/oracle`, `recharts` dependencies |

---

## Chunk 1: Foundation (Data Layer + Routing + Shell)

### Task 1: Install dependencies and add feature flag

**Files:**
- Modify: `C:\LucidMerged\package.json`
- Modify: `C:\LucidMerged\src\lib\features.ts`

- [ ] **Step 1: Install new dependencies**

```bash
cd C:\LucidMerged
npm install @lucid-fdn/oracle recharts --legacy-peer-deps
```

Verify both appear in `package.json` dependencies. Note: `lightweight-charts` (^4.2.2) is already installed — do NOT reinstall it.

- [ ] **Step 2: Add feature flag**

In `src/lib/features.ts`, find the `FEATURES` object and add `oracleDashboard`:

```typescript
// In the FEATURES object, add under a new "ORACLE" section comment:
// ==================
// ORACLE DASHBOARD
// ==================
oracleDashboard: flag('oracleDashboard', false),
```

- [ ] **Step 3: Verify flag is accessible**

```bash
cd C:\LucidMerged
node -e "
  process.env.FEATURE_ORACLE_DASHBOARD = 'true';
  const { FEATURES } = await import('./src/lib/features.ts');
  console.log('oracleDashboard:', FEATURES.oracleDashboard);
" --input-type=module
```

Expected: `oracleDashboard: true`

If tsx is available instead, use: `npx tsx -e "process.env.FEATURE_ORACLE_DASHBOARD='true'; const {FEATURES}=await import('./src/lib/features.ts'); console.log(FEATURES.oracleDashboard)"`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/lib/features.ts
git commit -m "feat(oracle): install SDK + recharts, add oracleDashboard feature flag"
```

---

### Task 2: Cache keys and SDK data provider

**Files:**
- Create: `C:\LucidMerged\src\lib\oracle\cache-keys.ts`
- Create: `C:\LucidMerged\src\lib\oracle\data-provider.tsx`

- [ ] **Step 1: Create cache key builders**

Create `src/lib/oracle/cache-keys.ts`:

```typescript
/**
 * Parameterized query key builders for Oracle React Query hooks.
 * Each builder returns a unique queryKey array scoped by parameters.
 */
const P = 'oracle' as const

export const oracleKeys = {
  // Feeds
  feeds:           ()                                            => [P, 'feeds'] as const,
  feedDetail:      (id: string)                                  => [P, 'feeds', id] as const,
  feedHistory:     (id: string, period: string, interval: string) => [P, 'feeds', id, 'history', period, interval] as const,
  feedMethodology: (id: string)                                  => [P, 'feeds', id, 'methodology'] as const,

  // Agents
  agentSearch:      (q: string)                                  => [P, 'agents', 'search', q] as const,
  agentLeaderboard: (sort?: string, cursor?: string)             => [P, 'agents', 'leaderboard', sort, cursor] as const,
  agentProfile:     (id: string)                                 => [P, 'agents', id] as const,
  agentMetrics:     (id: string)                                 => [P, 'agents', id, 'metrics'] as const,
  agentActivity:    (id: string, cursor?: string)                => [P, 'agents', id, 'activity', cursor] as const,
  modelUsage:       (period: string)                             => [P, 'agents', 'model-usage', period] as const,

  // Protocols
  protocols:       ()                                            => [P, 'protocols'] as const,
  protocolDetail:  (id: string)                                  => [P, 'protocols', id] as const,
  protocolMetrics: (id: string)                                  => [P, 'protocols', id, 'metrics'] as const,

  // Reports
  latestReport:    ()                                            => [P, 'reports', 'latest'] as const,
} as const
```

- [ ] **Step 2: Create OracleDataProvider**

Create `src/lib/oracle/data-provider.tsx`:

```tsx
'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { LucidOracle } from '@lucid-fdn/oracle'

const OracleContext = createContext<LucidOracle | null>(null)
const ApiKeyContext = createContext<string | undefined>(undefined)

interface OracleDataProviderProps {
  children: ReactNode
  apiKey?: string
}

export function OracleDataProvider({ children, apiKey }: OracleDataProviderProps) {
  const oracle = useMemo(
    () => new LucidOracle(apiKey ? { apiKey } : undefined),
    [apiKey],
  )
  return (
    <ApiKeyContext.Provider value={apiKey}>
      <OracleContext.Provider value={oracle}>{children}</OracleContext.Provider>
    </ApiKeyContext.Provider>
  )
}

/** Returns the current API key, or undefined for anonymous users. Pro hooks use this to gate `enabled`. */
export function useOracleApiKey(): string | undefined {
  return useContext(ApiKeyContext)
}

export function useOracleClient(): LucidOracle {
  const oracle = useContext(OracleContext)
  if (!oracle) throw new Error('useOracleClient must be used within OracleDataProvider')
  return oracle
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/oracle/
git commit -m "feat(oracle): add cache key builders and OracleDataProvider context"
```

---

### Task 3: React Query hooks

**Files:**
- Create: `C:\LucidMerged\src\lib\oracle\hooks.ts`

- [ ] **Step 1: Create all 14 hooks**

Create `src/lib/oracle/hooks.ts`:

```typescript
'use client'

import { useQueryWithCache } from '@/hooks/useQueryWithCache'
import { useOracleClient, useOracleApiKey } from './data-provider'
import { oracleKeys } from './cache-keys'

// Shared retry: skip retries on deterministic 4xx errors
const oracleRetry = (failureCount: number, error: unknown) => {
  const status = (error as any)?.statusCode ?? (error as any)?.status
  if (status && status >= 400 && status < 500) return false
  return failureCount < 3
}

// ---------------------------------------------------------------------------
// Feeds
// ---------------------------------------------------------------------------

export function useFeeds() {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_feeds',
    queryKey: oracleKeys.feeds(),
    queryFn: () => oracle.feeds.list(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: oracleRetry,
  })
}

export function useFeedDetail(id: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_feeds',
    queryKey: oracleKeys.feedDetail(id),
    queryFn: () => oracle.feeds.get({ id }),
    staleTime: 30_000,
    retry: oracleRetry,
    enabled: !!id,
  })
}

export function useFeedHistory(id: string, period: string, interval: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_feeds',
    queryKey: oracleKeys.feedHistory(id, period, interval),
    queryFn: () => oracle.feeds.history({ id, period, interval }),
    staleTime: 60_000,
    retry: oracleRetry,
    enabled: !!id,
  })
}

export function useFeedMethodology(id: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_feeds',
    queryKey: oracleKeys.feedMethodology(id),
    queryFn: () => oracle.feeds.methodology({ id }),
    staleTime: 300_000,
    retry: oracleRetry,
    enabled: !!id,
  })
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function useAgentSearch(q: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.agentSearch(q),
    queryFn: () => oracle.agents.search({ q }),
    staleTime: 30_000,
    retry: oracleRetry,
    enabled: q.length > 0,
  })
}

export function useAgentLeaderboard(sort?: string, cursor?: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.agentLeaderboard(sort, cursor),
    queryFn: () => oracle.agents.leaderboard({ sort, cursor } as any),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: oracleRetry,
  })
}

export function useAgentProfile(id: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.agentProfile(id),
    queryFn: () => oracle.agents.get({ id }),
    staleTime: 60_000,
    retry: oracleRetry,
    enabled: !!id,
  })
}

export function useAgentMetrics(id: string) {
  const oracle = useOracleClient()
  const apiKey = useOracleApiKey()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.agentMetrics(id),
    queryFn: () => oracle.agents.metrics({ id }),
    staleTime: 120_000,
    retry: oracleRetry,
    enabled: !!id && !!apiKey, // Pro-only: don't fire without API key
  })
}

export function useAgentActivity(id: string, cursor?: string) {
  const oracle = useOracleClient()
  const apiKey = useOracleApiKey()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.agentActivity(id, cursor),
    queryFn: () => oracle.agents.activity({ id, cursor } as any),
    staleTime: 120_000,
    retry: oracleRetry,
    enabled: !!id && !!apiKey, // Pro-only: don't fire without API key
  })
}

export function useModelUsage(period: string) {
  const oracle = useOracleClient()
  const apiKey = useOracleApiKey()
  return useQueryWithCache({
    cacheKey: 'oracle_agents',
    queryKey: oracleKeys.modelUsage(period),
    queryFn: () => oracle.agents.modelUsage({ period } as any),
    staleTime: 120_000,
    retry: oracleRetry,
    enabled: !!apiKey, // Pro-only: don't fire without API key
  })
}

// ---------------------------------------------------------------------------
// Protocols
// ---------------------------------------------------------------------------

export function useProtocols() {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_protocols',
    queryKey: oracleKeys.protocols(),
    queryFn: () => oracle.protocols.list(),
    staleTime: 120_000,
    retry: oracleRetry,
  })
}

export function useProtocolDetail(id: string) {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_protocols',
    queryKey: oracleKeys.protocolDetail(id),
    queryFn: () => oracle.protocols.get({ id }),
    staleTime: 120_000,
    retry: oracleRetry,
    enabled: !!id,
  })
}

export function useProtocolMetrics(id: string) {
  const oracle = useOracleClient()
  const apiKey = useOracleApiKey()
  return useQueryWithCache({
    cacheKey: 'oracle_protocols',
    queryKey: oracleKeys.protocolMetrics(id),
    queryFn: () => oracle.protocols.metrics({ id }),
    staleTime: 120_000,
    retry: oracleRetry,
    enabled: !!id && !!apiKey, // Pro-only: don't fire without API key
  })
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function useLatestReport() {
  const oracle = useOracleClient()
  return useQueryWithCache({
    cacheKey: 'oracle_reports',
    queryKey: oracleKeys.latestReport(),
    queryFn: () => oracle.reports.latest(),
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: oracleRetry,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/oracle/hooks.ts
git commit -m "feat(oracle): add 14 React Query hooks wrapping SDK calls"
```

---

### Task 4: Middleware — domain routing + public routes

**Files:**
- Modify: `C:\LucidMerged\src\middleware.ts`

- [ ] **Step 1: Add oracle domain rewrite**

In `src/middleware.ts`, find the block after the subdomain blog rewrite (after `return NextResponse.rewrite(new URL(blogPath, req.url))`), and add the oracle domain rewrite **before** the `// === SKIP API ROUTES ENTIRELY ===` comment:

```typescript
  // === ORACLE DASHBOARD DOMAIN REWRITE ===
  const ORACLE_HOSTS = new Set(['oracle.lucid.foundation', 'oracle.localhost:3000'])
  if (ORACLE_HOSTS.has(hostname)) {
    const oraclePath = `/oracle${pathname === '/' ? '' : pathname}`
    return NextResponse.rewrite(new URL(oraclePath, req.url))
  }
```

- [ ] **Step 2: Add oracle to public routes**

Find the `publicRoutes` array (around line 119) and add `/oracle`:

```typescript
  const publicRoutes = [
    '/browse',
    '/explore',
    // ... existing routes ...
    '/agent',        // Launchpad — public agent detail pages
    '/oracle',       // Oracle dashboard — public by default, pro gating at component level
  ];
```

Since the existing check uses `pathname.startsWith(route)`, adding `/oracle` covers all subpaths (`/oracle/feeds/abc`, `/oracle/agents/xyz`, etc.).

- [ ] **Step 3: Verify middleware compiles**

```bash
cd C:\LucidMerged
npx tsc --noEmit src/middleware.ts 2>&1 | head -20
```

If `tsc` doesn't work directly on a single file, just verify the dev server starts:

```bash
npm run dev &
sleep 3
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/oracle
kill %1
```

Expected: `200` or `307` (redirect if feature flag is off — that's correct behavior).

- [ ] **Step 4: Commit**

```bash
git add src/middleware.ts
git commit -m "feat(oracle): add domain rewrite + public route for oracle dashboard"
```

---

### Task 5: Route group shell — layouts, error, not-found

**Files:**
- Create: `C:\LucidMerged\src\app\(oracle)\layout.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\oracle-client-layout.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\error.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\not-found.tsx`

- [ ] **Step 1: Create server layout**

Create `src/app/(oracle)/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { FEATURES } from '@/lib/features'
import { OracleClientLayout } from './oracle-client-layout'

export const metadata: Metadata = {
  title: 'Lucid Oracle — Agent Economy Intelligence',
  description: 'Economic data, feeds, and analytics for the agent economy. Real-time indexes, agent rankings, and protocol metrics.',
}

export default function OracleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  if (!FEATURES.oracleDashboard) {
    redirect('/')
  }

  return <OracleClientLayout>{children}</OracleClientLayout>
}
```

- [ ] **Step 2: Create client layout (navigation + ticker + shell)**

Create `src/app/(oracle)/oracle-client-layout.tsx`:

```tsx
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { Menu, X, Key } from 'lucide-react'
import { OracleDataProvider } from '@/lib/oracle/data-provider'
import { StatsTicker } from '@/components/oracle/stats-ticker'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { href: '/oracle', label: 'Home', exact: true },
  { href: '/oracle/feeds', label: 'Feeds' },
  { href: '/oracle/agents', label: 'Agents' },
  { href: '/oracle/protocols', label: 'Protocols' },
  { href: '/oracle/reports', label: 'Reports' },
] as const

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function OracleNav() {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (item: typeof NAV_ITEMS[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-ink-900/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Logo */}
        <Link href="/oracle" className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-lucid opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-lucid" />
          </span>
          <span className="text-sm font-bold tracking-widest text-white">LUCID ORACLE</span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item) ? 'text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {item.label}
              {isActive(item) && (
                <motion.div
                  layoutId="oracle-nav-indicator"
                  className="absolute inset-x-1 -bottom-[1px] h-[2px] bg-gradient-to-r from-lucid to-lucid-purple"
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                />
              )}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400 md:flex">
            <Key className="h-3 w-3" />
            <span>Anonymous</span>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="rounded-lg p-2 text-slate-400 hover:text-white md:hidden"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/5 md:hidden"
          >
            <div className="space-y-1 px-4 py-3">
              {NAV_ITEMS.map((item, i) => (
                <motion.div
                  key={item.href}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <Link
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className={`block rounded-lg px-3 py-2 text-sm font-medium ${
                      isActive(item) ? 'bg-white/[0.05] text-white' : 'text-slate-400'
                    }`}
                  >
                    {item.label}
                  </Link>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Client Layout
// ---------------------------------------------------------------------------

export function OracleClientLayout({ children }: { children: React.ReactNode }) {
  // TODO: Read API key from Privy auth context or localStorage
  const apiKey = undefined

  return (
    <OracleDataProvider apiKey={apiKey}>
      <div className="min-h-screen bg-[#050a0f] text-white">
        <OracleNav />
        <StatsTicker />
        <main className="mx-auto max-w-7xl px-4 pt-[calc(4rem+2.5rem+1.5rem)] sm:px-6">
          {children}
        </main>
      </div>
    </OracleDataProvider>
  )
}
```

- [ ] **Step 3: Create error boundary**

Create `src/app/(oracle)/error.tsx`:

```tsx
'use client'

import Link from 'next/link'

export default function OracleError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/10">
        <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="text-xl font-semibold text-white">Something went wrong</h2>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-gradient-to-r from-lucid to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-lucid/20 transition-all hover:shadow-lucid/30 hover:brightness-110"
        >
          Try Again
        </button>
        <Link
          href="/oracle"
          className="rounded-lg border border-white/10 bg-white/[0.05] px-5 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
        >
          Go to Home
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create not-found page**

Create `src/app/(oracle)/not-found.tsx`:

```tsx
import Link from 'next/link'

export default function OracleNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
        <span className="text-2xl font-bold text-slate-500">404</span>
      </div>
      <h2 className="text-xl font-semibold text-white">Not Found</h2>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <div className="mt-6 flex items-center gap-3">
        <Link
          href="/oracle/agents"
          className="rounded-lg bg-gradient-to-r from-lucid to-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-lucid/20"
        >
          Search Agents
        </Link>
        <Link
          href="/oracle"
          className="rounded-lg border border-white/10 bg-white/[0.05] px-5 py-2 text-sm font-medium text-slate-300 transition-colors hover:text-white"
        >
          Go to Home
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(oracle\)/
git commit -m "feat(oracle): add route group shell — layouts, error boundary, not-found"
```

---

### Task 6: Stats ticker component

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\stats-ticker.tsx`

- [ ] **Step 1: Create stats ticker**

Create `src/components/oracle/stats-ticker.tsx`:

```tsx
'use client'

import { useFeeds, useLatestReport } from '@/lib/oracle/hooks'

export function StatsTicker() {
  const { data: feedsData } = useFeeds()
  const { data: reportData } = useLatestReport()

  // Extract feed values — handle both array and object response shapes
  const feeds = (feedsData as any)?.feeds ?? feedsData ?? []
  const feedItems = Array.isArray(feeds) ? feeds : []

  return (
    <div className="fixed top-16 z-40 w-full border-b border-white/5 bg-ink-900/90 backdrop-blur-md">
      <div className="mx-auto flex h-10 max-w-7xl items-center gap-6 overflow-x-auto px-4 text-xs sm:px-6">
        {/* LIVE indicator */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          <span className="font-semibold text-emerald-400">LIVE</span>
        </div>

        {/* Feed values */}
        {feedItems.map((feed: any) => (
          <div key={feed.id} className="flex shrink-0 items-center gap-2">
            <span className="font-medium text-slate-400">{feed.name ?? feed.id}</span>
            <span className="tabular-nums font-semibold text-white">
              {feed.latest_value?.value ?? feed.latestValue?.value ?? '—'}
            </span>
          </div>
        ))}

        {/* Report timestamp */}
        {reportData && (
          <div className="flex shrink-0 items-center gap-2 text-slate-500">
            <span>Last report:</span>
            <span className="tabular-nums text-slate-400">
              {(() => {
                const ts = (reportData as any)?.report?.timestamp ?? (reportData as any)?.report?.report_timestamp ?? (reportData as any)?.timestamp
                return ts ? new Date(ts).toLocaleTimeString() : '—'
              })()}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/oracle/stats-ticker.tsx
git commit -m "feat(oracle): add Bloomberg-style stats ticker component"
```

---

### Task 7: ProGate component

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\pro-gate.tsx`

- [ ] **Step 1: Create ProGate overlay**

Create `src/components/oracle/pro-gate.tsx`:

```tsx
'use client'

import { Key, Lock } from 'lucide-react'

interface ProGateProps {
  children: React.ReactNode
  feature?: string
}

export function ProGate({ children, feature = 'this feature' }: ProGateProps) {
  return (
    <div className="relative">
      {/* Blurred content preview */}
      <div className="pointer-events-none select-none blur-sm">{children}</div>

      {/* Overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-white/10 bg-ink-900/80 backdrop-blur-sm">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
          <Lock className="h-5 w-5 text-slate-400" />
        </div>
        <p className="text-sm font-medium text-white">Pro tier required</p>
        <p className="mt-1 text-xs text-slate-400">
          Sign in or enter an API key to access {feature}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-lucid to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-lucid/20 transition-all hover:shadow-lucid/30 hover:brightness-110">
            <Key className="h-3 w-3" />
            Enter API Key
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/oracle/pro-gate.tsx
git commit -m "feat(oracle): add ProGate overlay component for pro-tier gating"
```

---

## Chunk 2: Home Page + Feed Components

### Task 8: Feed card component

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\feed-card.tsx`

- [ ] **Step 1: Create feed card**

Create `src/components/oracle/feed-card.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface FeedCardProps {
  id: string
  name: string
  description?: string
  value?: string
  confidence?: number
  freshnessMs?: number
}

function stalenessColor(ms: number | undefined): string {
  if (!ms) return 'bg-slate-500'
  if (ms < 120_000) return 'bg-emerald-400'   // < 2min = fresh
  if (ms < 600_000) return 'bg-yellow-400'    // < 10min = stale
  return 'bg-red-400'                          // > 10min = very stale
}

export function FeedCard({ id, name, description, value, confidence, freshnessMs }: FeedCardProps) {
  return (
    <Link href={`/oracle/feeds/${id}`}>
      <Card className="group relative overflow-hidden border-white/5 bg-white/[0.02] p-5 transition-all hover:border-white/10 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">{name}</h3>
            {description && (
              <p className="mt-1 line-clamp-1 text-xs text-slate-400">{description}</p>
            )}
          </div>
          <span className={`h-2 w-2 shrink-0 rounded-full ${stalenessColor(freshnessMs)}`} />
        </div>

        <div className="mt-4">
          <span className="text-2xl font-bold tabular-nums text-white">
            {value ?? '—'}
          </span>
        </div>

        {confidence != null && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">Confidence</span>
              <span className="tabular-nums text-slate-300">{(confidence * 100).toFixed(1)}%</span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-lucid to-lucid-purple"
                style={{ width: `${confidence * 100}%` }}
              />
            </div>
          </div>
        )}
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/oracle/feed-card.tsx
git commit -m "feat(oracle): add FeedCard component with staleness indicator"
```

---

### Task 9: Agent card, protocol card, leaderboard table

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\agent-card.tsx`
- Create: `C:\LucidMerged\src\components\oracle\protocol-card.tsx`
- Create: `C:\LucidMerged\src\components\oracle\leaderboard-table.tsx`

- [ ] **Step 1: Create agent card**

Create `src/components/oracle/agent-card.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface AgentCardProps {
  id: string
  displayName?: string | null
  erc8004Id?: string | null
  walletCount?: number
  protocolCount?: number
  evidenceCount?: number
  createdAt?: string
}

export function AgentCard({ id, displayName, erc8004Id, walletCount, protocolCount, evidenceCount }: AgentCardProps) {
  return (
    <Link href={`/oracle/agents/${id}`}>
      <Card className="border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-white">
              {displayName || id.slice(0, 12) + '...'}
            </h3>
            {erc8004Id && (
              <Badge variant="outline" className="mt-1 border-white/10 text-xs text-slate-400">
                ERC-8004: {erc8004Id.slice(0, 10)}
              </Badge>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
          <span><span className="tabular-nums font-medium text-white">{walletCount ?? 0}</span> wallets</span>
          <span><span className="tabular-nums font-medium text-white">{protocolCount ?? 0}</span> protocols</span>
          <span><span className="tabular-nums font-medium text-white">{evidenceCount ?? 0}</span> evidence</span>
        </div>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 2: Create protocol card**

Create `src/components/oracle/protocol-card.tsx`:

```tsx
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ProtocolCardProps {
  id: string
  name: string
  chains?: string[]
  status?: string
  agentCount?: number
  walletCount?: number
}

export function ProtocolCard({ id, name, chains, status, agentCount, walletCount }: ProtocolCardProps) {
  return (
    <Link href={`/oracle/protocols/${id}`}>
      <Card className="border-white/5 bg-white/[0.02] p-4 transition-all hover:border-white/10 hover:bg-white/[0.04]">
        <div className="flex items-start justify-between">
          <h3 className="text-sm font-semibold text-white">{name}</h3>
          <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        </div>
        {chains && chains.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {chains.map((chain) => (
              <Badge key={chain} variant="outline" className="border-white/10 text-[10px] text-slate-400">
                {chain}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
          <span><span className="tabular-nums font-medium text-white">{agentCount ?? 0}</span> agents</span>
          <span><span className="tabular-nums font-medium text-white">{walletCount ?? 0}</span> wallets</span>
        </div>
      </Card>
    </Link>
  )
}
```

- [ ] **Step 3: Create leaderboard table**

Create `src/components/oracle/leaderboard-table.tsx`:

```tsx
'use client'

import Link from 'next/link'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface LeaderboardEntry {
  id: string
  display_name?: string | null
  displayName?: string | null
  erc8004_id?: string | null
  erc8004Id?: string | null
  wallet_count?: number
  walletCount?: number
  protocol_count?: number
  protocolCount?: number
  evidence_count?: number
  evidenceCount?: number
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[]
  compact?: boolean
}

export function LeaderboardTable({ entries, compact }: LeaderboardTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="border-white/5 hover:bg-transparent">
          <TableHead className="w-10 text-slate-400">#</TableHead>
          <TableHead className="text-slate-400">Agent</TableHead>
          <TableHead className="text-right text-slate-400">Wallets</TableHead>
          <TableHead className="text-right text-slate-400">Protocols</TableHead>
          {!compact && <TableHead className="text-right text-slate-400">Evidence</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry, i) => {
          const name = entry.display_name ?? entry.displayName ?? entry.id.slice(0, 12) + '...'
          const wallets = entry.wallet_count ?? entry.walletCount ?? 0
          const protocols = entry.protocol_count ?? entry.protocolCount ?? 0
          const evidence = entry.evidence_count ?? entry.evidenceCount ?? 0

          return (
            <TableRow key={entry.id} className="border-white/5 hover:bg-white/[0.02]">
              <TableCell className="tabular-nums text-slate-500">{i + 1}</TableCell>
              <TableCell>
                <Link href={`/oracle/agents/${entry.id}`} className="text-sm font-medium text-white hover:text-lucid">
                  {name}
                </Link>
              </TableCell>
              <TableCell className="text-right tabular-nums text-slate-300">{wallets}</TableCell>
              <TableCell className="text-right tabular-nums text-slate-300">{protocols}</TableCell>
              {!compact && <TableCell className="text-right tabular-nums text-slate-300">{evidence}</TableCell>}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/oracle/agent-card.tsx src/components/oracle/protocol-card.tsx src/components/oracle/leaderboard-table.tsx
git commit -m "feat(oracle): add AgentCard, ProtocolCard, LeaderboardTable components"
```

---

### Task 10: Home page + loading skeleton

**Files:**
- Create: `C:\LucidMerged\src\app\(oracle)\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\loading.tsx`

- [ ] **Step 1: Create home page**

Create `src/app/(oracle)/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { useFeeds, useAgentLeaderboard, useProtocols, useLatestReport } from '@/lib/oracle/hooks'
import { FeedCard } from '@/components/oracle/feed-card'
import { ProtocolCard } from '@/components/oracle/protocol-card'
import { LeaderboardTable } from '@/components/oracle/leaderboard-table'

export default function OracleHomePage() {
  const { data: feedsData, isLoading: feedsLoading } = useFeeds()
  const { data: lbData, isLoading: lbLoading } = useAgentLeaderboard()
  const { data: protocolsData, isLoading: protocolsLoading } = useProtocols()
  const { data: reportData } = useLatestReport()

  const feeds = (feedsData as any)?.feeds ?? feedsData ?? []
  const feedList = Array.isArray(feeds) ? feeds : []
  const lbEntries = (lbData as any)?.data ?? []
  const protocols = (protocolsData as any)?.data ?? protocolsData ?? []
  const protocolList = Array.isArray(protocols) ? protocols : []

  return (
    <div className="space-y-10 pb-16">
      {/* Feed Hero */}
      <section>
        <h1 className="text-2xl font-bold text-white">Oracle Feeds</h1>
        <p className="mt-1 text-sm text-slate-400">Real-time economic indexes for the agent economy</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {feedsLoading
            ? Array.from({ length: 3 }).map((_, i) => (
                <Card key={i} className="h-40 animate-pulse border-white/5 bg-white/[0.02]" />
              ))
            : feedList.map((feed: any) => (
                <FeedCard
                  key={feed.id}
                  id={feed.id}
                  name={feed.name ?? feed.id}
                  description={feed.description}
                  value={feed.latest_value?.value ?? feed.latestValue?.value}
                  confidence={feed.latest_value?.confidence ?? feed.latestValue?.confidence}
                  freshnessMs={feed.latest_value?.freshness_ms ?? feed.latestValue?.freshnessMs}
                />
              ))}
        </div>
      </section>

      {/* Global Stats */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: 'Total Agents', value: (lbData as any)?.pagination?.total ?? (lbData as any)?.meta?.total ?? (lbEntries.length || '—') },
          { label: 'Protocols', value: protocolList.length || '—' },
          { label: 'Active Feeds', value: feedList.length || '—' },
          {
            label: 'Last Report',
            value: (() => {
              const ts = (reportData as any)?.report?.timestamp ?? (reportData as any)?.report?.report_timestamp ?? (reportData as any)?.timestamp
              return ts ? new Date(ts).toLocaleTimeString() : '—'
            })(),
          },
        ].map((stat) => (
          <Card key={stat.label} className="border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs text-slate-400">{stat.label}</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-white">{stat.value}</p>
          </Card>
        ))}
      </section>

      {/* Leaderboard Preview */}
      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Top Agents</h2>
          <Link href="/oracle/agents" className="text-xs font-medium text-lucid hover:underline">
            View Full Leaderboard →
          </Link>
        </div>
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02]">
          {lbLoading ? (
            <div className="space-y-3 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-white/[0.04]" />
              ))}
            </div>
          ) : (
            <LeaderboardTable entries={lbEntries.slice(0, 5)} compact />
          )}
        </div>
      </section>

      {/* Protocol Grid */}
      <section>
        <h2 className="text-lg font-semibold text-white">Indexed Protocols</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {protocolsLoading
            ? Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="h-28 animate-pulse border-white/5 bg-white/[0.02]" />
              ))
            : protocolList.map((p: any) => (
                <ProtocolCard
                  key={p.id}
                  id={p.id}
                  name={p.name ?? p.id}
                  chains={p.chains}
                  status={p.status}
                  agentCount={p.stats?.agent_count ?? p.stats?.agentCount}
                  walletCount={p.stats?.wallet_count ?? p.stats?.walletCount}
                />
              ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Create home loading skeleton**

Create `src/app/(oracle)/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function OracleHomeLoading() {
  return (
    <div className="space-y-10 pb-16">
      {/* Feed hero skeleton */}
      <section>
        <div className="h-7 w-40 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-white/[0.04]" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="h-40 animate-pulse border-white/5 bg-white/[0.02]" />
          ))}
        </div>
      </section>

      {/* Stats skeleton */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-20 animate-pulse border-white/5 bg-white/[0.02]" />
        ))}
      </section>

      {/* Leaderboard skeleton */}
      <section>
        <div className="h-6 w-32 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-white/[0.04]" />
            ))}
          </div>
        </div>
      </section>

      {/* Protocol grid skeleton */}
      <section>
        <div className="h-6 w-40 animate-pulse rounded bg-white/[0.06]" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-28 animate-pulse border-white/5 bg-white/[0.02]" />
          ))}
        </div>
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Verify home page renders**

```bash
cd C:\LucidMerged
FEATURE_ORACLE_DASHBOARD=true npm run dev &
sleep 5
curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/oracle
kill %1
```

Expected: `200`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(oracle\)/page.tsx src/app/\(oracle\)/loading.tsx
git commit -m "feat(oracle): add home page with feed hero, leaderboard preview, protocol grid"
```

---

## Chunk 3: Feed, Agent, Protocol, and Report Pages

### Task 11: Feed detail page with TradingView chart

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\feed-chart.tsx`
- Create: `C:\LucidMerged\src\components\oracle\feed-methodology.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\feeds\[id]\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\feeds\[id]\loading.tsx`

- [ ] **Step 1: Create TradingView chart wrapper**

Create `src/components/oracle/feed-chart.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { createChart, type IChartApi, type ISeriesApi, ColorType } from 'lightweight-charts'

interface FeedChartProps {
  points: Array<{ timestamp: string; value: string; confidence: number }>
}

export function FeedChart({ points }: FeedChartProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9CA3AF',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.03)' },
        horzLines: { color: 'rgba(255,255,255,0.03)' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.05)' },
      timeScale: { borderColor: 'rgba(255,255,255,0.05)', timeVisible: true },
      handleScroll: { vertTouchDrag: false },
    })

    const series = chart.addAreaSeries({
      lineColor: '#0B84F3',
      topColor: 'rgba(11, 132, 243, 0.3)',
      bottomColor: 'rgba(11, 132, 243, 0.02)',
      lineWidth: 2,
    })

    chartRef.current = chart
    seriesRef.current = series

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  useEffect(() => {
    if (!seriesRef.current || !points.length) return

    const data = points
      .map((p) => ({
        time: Math.floor(new Date(p.timestamp).getTime() / 1000) as any,
        value: parseFloat(p.value) || 0,
      }))
      .sort((a, b) => a.time - b.time)

    seriesRef.current.setData(data)
    chartRef.current?.timeScale().fitContent()
  }, [points])

  return (
    <div ref={containerRef} className="h-[400px] w-full rounded-xl border border-white/5 bg-white/[0.02] p-2" />
  )
}
```

- [ ] **Step 2: Create methodology accordion**

Create `src/components/oracle/feed-methodology.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'

interface FeedMethodologyProps {
  data: any
}

export function FeedMethodology({ data }: FeedMethodologyProps) {
  const [open, setOpen] = useState(false)

  if (!data) return null

  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between p-4 text-left"
      >
        <div>
          <h3 className="text-sm font-semibold text-white">Methodology</h3>
          <p className="mt-0.5 text-xs text-slate-400">{data.description ?? 'Computation details'}</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-white/5 p-4">
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create feed detail page**

Create `src/app/(oracle)/feeds/[id]/page.tsx`:

```tsx
'use client'

import { use, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useFeedDetail, useFeedHistory, useFeedMethodology } from '@/lib/oracle/hooks'
import { FeedChart } from '@/components/oracle/feed-chart'
import { FeedMethodology } from '@/components/oracle/feed-methodology'
import { ProGate } from '@/components/oracle/pro-gate'

const PERIODS = ['1d', '7d', '30d', '90d'] as const

export default function FeedDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [period, setPeriod] = useState<string>('7d')
  const [interval, setInterval] = useState<string>('1h')

  const { data: feedData, isLoading } = useFeedDetail(id)
  const { data: historyData } = useFeedHistory(id, period, interval)
  const { data: methodologyData } = useFeedMethodology(id)

  const feed = (feedData as any)?.feed ?? feedData
  const latest = (feedData as any)?.latest ?? feed?.latest_value ?? feed?.latestValue
  const points = (historyData as any)?.data?.points ?? (historyData as any)?.points ?? []
  const isPro = period === '30d' || period === '90d'

  if (isLoading) {
    return <div className="space-y-4"><Card className="h-12 animate-pulse border-white/5 bg-white/[0.02]" /><Card className="h-[400px] animate-pulse border-white/5 bg-white/[0.02]" /></div>
  }

  return (
    <div className="space-y-6 pb-16">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">{feed?.name ?? id}</h1>
        {feed?.description && <p className="mt-1 text-sm text-slate-400">{feed.description}</p>}
      </div>

      {/* Current value */}
      {latest && (
        <Card className="border-white/5 bg-white/[0.02] p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-slate-400">Current Value</p>
              <p className="mt-1 text-3xl font-bold tabular-nums text-white">{latest.value ?? '—'}</p>
            </div>
            <div className="text-right text-xs text-slate-400">
              <p>Confidence: <span className="text-white">{((latest.confidence ?? 0) * 100).toFixed(1)}%</span></p>
              <p className="mt-0.5">Completeness: <span className="text-white">{((latest.completeness ?? 0) * 100).toFixed(0)}%</span></p>
            </div>
          </div>
        </Card>
      )}

      {/* Period selector */}
      <div className="flex items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              period === p ? 'bg-lucid/20 text-lucid' : 'text-slate-400 hover:text-white'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Chart */}
      {isPro ? (
        <ProGate feature="extended feed history">
          <FeedChart points={points} />
        </ProGate>
      ) : (
        <FeedChart points={points} />
      )}

      {/* Methodology */}
      <FeedMethodology data={methodologyData} />
    </div>
  )
}
```

- [ ] **Step 4: Create feed detail loading skeleton**

Create `src/app/(oracle)/feeds/[id]/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function FeedDetailLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-48 animate-pulse rounded bg-white/[0.06]" />
      <Card className="h-24 animate-pulse border-white/5 bg-white/[0.02]" />
      <Card className="h-[400px] animate-pulse border-white/5 bg-white/[0.02]" />
      <Card className="h-16 animate-pulse border-white/5 bg-white/[0.02]" />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/oracle/feed-chart.tsx src/components/oracle/feed-methodology.tsx src/app/\(oracle\)/feeds/
git commit -m "feat(oracle): add feed detail page with TradingView chart + methodology"
```

---

### Task 12: Agents page (search + leaderboard + model usage tabs)

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\search-bar.tsx`
- Create: `C:\LucidMerged\src\components\oracle\model-usage-chart.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\agents\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\agents\loading.tsx`

- [ ] **Step 1: Create search bar**

Create `src/components/oracle/search-bar.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'

interface SearchBarProps {
  onSearch: (query: string) => void
  placeholder?: string
}

export function SearchBar({ onSearch, placeholder = 'Search agents...' }: SearchBarProps) {
  const [value, setValue] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => onSearch(value), 300)
    return () => clearTimeout(timer)
  }, [value, onSearch])

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/10 bg-white/[0.03] py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition-colors focus:border-lucid/50 focus:ring-1 focus:ring-lucid/20"
      />
    </div>
  )
}
```

- [ ] **Step 2: Create model usage chart**

Create `src/components/oracle/model-usage-chart.tsx`:

```tsx
'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface ModelUsageChartProps {
  data: Array<{ model_id?: string; modelId?: string; provider?: string; pct?: number; event_count?: number; eventCount?: number }>
}

const COLORS = ['#0B84F3', '#8B5CF6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899']

export function ModelUsageChart({ data }: ModelUsageChartProps) {
  const items = data.map((d) => ({
    name: d.model_id ?? d.modelId ?? 'unknown',
    provider: d.provider ?? '',
    pct: d.pct ?? 0,
    events: d.event_count ?? d.eventCount ?? 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={items} layout="vertical" margin={{ left: 100 }}>
        <XAxis type="number" domain={[0, 100]} tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fill: '#9CA3AF', fontSize: 11 }} axisLine={false} width={100} />
        <Tooltip
          contentStyle={{ backgroundColor: '#14191F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: '#fff' }}
          formatter={(value: number) => [`${value.toFixed(1)}%`, 'Usage']}
        />
        <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
          {items.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
```

- [ ] **Step 3: Create agents page**

Create `src/app/(oracle)/agents/page.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAgentSearch, useAgentLeaderboard, useModelUsage } from '@/lib/oracle/hooks'
import { SearchBar } from '@/components/oracle/search-bar'
import { AgentCard } from '@/components/oracle/agent-card'
import { LeaderboardTable } from '@/components/oracle/leaderboard-table'
import { ModelUsageChart } from '@/components/oracle/model-usage-chart'
import { ProGate } from '@/components/oracle/pro-gate'

export default function AgentsPage() {
  const [query, setQuery] = useState('')
  const [usagePeriod, setUsagePeriod] = useState('7d')

  const { data: searchData, isLoading: searchLoading } = useAgentSearch(query)
  const { data: lbData, isLoading: lbLoading } = useAgentLeaderboard()
  const { data: usageData } = useModelUsage(usagePeriod)

  const searchResults = (searchData as any)?.data ?? []
  const lbEntries = (lbData as any)?.data ?? []
  const usageModels = (usageData as any)?.data?.models ?? (usageData as any)?.models ?? []

  const handleSearch = useCallback((q: string) => setQuery(q), [])

  return (
    <div className="space-y-6 pb-16">
      <h1 className="text-2xl font-bold text-white">Agents</h1>

      <Tabs defaultValue="search">
        <TabsList className="border-white/5 bg-white/[0.02]">
          <TabsTrigger value="search">Search</TabsTrigger>
          <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
          <TabsTrigger value="model-usage">Model Usage</TabsTrigger>
        </TabsList>

        <TabsContent value="search" className="mt-6 space-y-4">
          <SearchBar onSearch={handleSearch} />
          {query && searchLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-24 animate-pulse rounded-xl bg-white/[0.02]" />
              ))}
            </div>
          )}
          {query && !searchLoading && searchResults.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">No agents found for &ldquo;{query}&rdquo;</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {searchResults.map((agent: any) => (
              <AgentCard
                key={agent.id}
                id={agent.id}
                displayName={agent.display_name ?? agent.displayName}
                erc8004Id={agent.erc8004_id ?? agent.erc8004Id}
                createdAt={agent.created_at ?? agent.createdAt}
              />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="leaderboard" className="mt-6">
          <div className="rounded-xl border border-white/5 bg-white/[0.02]">
            {lbLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="h-8 animate-pulse rounded bg-white/[0.04]" />
                ))}
              </div>
            ) : (
              <LeaderboardTable entries={lbEntries} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="model-usage" className="mt-6">
          <ProGate feature="model usage analytics">
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
              <div className="mb-4 flex items-center gap-2">
                {['1d', '7d', '30d'].map((p) => (
                  <button
                    key={p}
                    onClick={() => setUsagePeriod(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      usagePeriod === p ? 'bg-lucid/20 text-lucid' : 'text-slate-400'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <ModelUsageChart data={usageModels} />
            </div>
          </ProGate>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 4: Create agents loading skeleton**

Create `src/app/(oracle)/agents/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function AgentsLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-24 animate-pulse rounded bg-white/[0.06]" />
      <div className="h-10 w-80 animate-pulse rounded-lg bg-white/[0.04]" />
      <div className="h-10 w-64 animate-pulse rounded bg-white/[0.04]" />
      <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-8 animate-pulse rounded bg-white/[0.04]" />
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/oracle/search-bar.tsx src/components/oracle/model-usage-chart.tsx src/app/\(oracle\)/agents/page.tsx src/app/\(oracle\)/agents/loading.tsx
git commit -m "feat(oracle): add agents page with search, leaderboard, and model usage tabs"
```

---

### Task 13: Agent detail page

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\agent-metrics.tsx`
- Create: `C:\LucidMerged\src\components\oracle\agent-activity.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\agents\[id]\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\agents\[id]\loading.tsx`

- [ ] **Step 1: Create agent metrics component**

Create `src/components/oracle/agent-metrics.tsx`:

```tsx
'use client'

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts'
import { Card } from '@/components/ui/card'

interface AgentMetricsProps {
  data: any
}

const COLORS = ['#0B84F3', '#8B5CF6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444']

export function AgentMetrics({ data }: AgentMetricsProps) {
  if (!data) return null

  const walletsByChain = Object.entries(data.wallets?.by_chain ?? data.wallets?.byChain ?? {}).map(
    ([name, value]) => ({ name, value: value as number }),
  )

  const evidenceByType = Object.entries(data.evidence?.by_type ?? data.evidence?.byType ?? {}).map(
    ([name, value]) => ({ name, value: value as number }),
  )

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Wallets by chain */}
      {walletsByChain.length > 0 && (
        <Card className="border-white/5 bg-white/[0.02] p-4">
          <h4 className="text-xs font-medium text-slate-400">Wallets by Chain</h4>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={walletsByChain} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} strokeWidth={0}>
                {walletsByChain.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#14191F', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Conflicts */}
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <h4 className="text-xs font-medium text-slate-400">Conflicts</h4>
        <div className="mt-3 flex items-center gap-6">
          <div>
            <p className="text-2xl font-bold tabular-nums text-white">{data.conflicts?.active ?? 0}</p>
            <p className="text-xs text-slate-400">Active</p>
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums text-white">{data.conflicts?.resolved ?? 0}</p>
            <p className="text-xs text-slate-400">Resolved</p>
          </div>
        </div>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create agent activity timeline**

Create `src/components/oracle/agent-activity.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'

interface ActivityEvent {
  type: string
  timestamp: string
  detail?: Record<string, unknown>
}

interface AgentActivityProps {
  events: ActivityEvent[]
}

const TYPE_LABELS: Record<string, string> = {
  evidence_added: 'Evidence Added',
  conflict_opened: 'Conflict Opened',
  wallet_linked: 'Wallet Linked',
}

const TYPE_COLORS: Record<string, string> = {
  evidence_added: 'bg-emerald-400',
  conflict_opened: 'bg-yellow-400',
  wallet_linked: 'bg-lucid',
}

export function AgentActivity({ events }: AgentActivityProps) {
  if (!events.length) {
    return <p className="py-6 text-center text-sm text-slate-400">No recent activity</p>
  }

  return (
    <div className="space-y-3">
      {events.map((event, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] p-3">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_COLORS[event.type] ?? 'bg-slate-400'}`} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-white/10 text-[10px] text-slate-400">
                {TYPE_LABELS[event.type] ?? event.type}
              </Badge>
              <span className="text-[10px] text-slate-500">
                {new Date(event.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create agent detail page**

Create `src/app/(oracle)/agents/[id]/page.tsx`:

```tsx
'use client'

import { use } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useAgentProfile, useAgentMetrics, useAgentActivity } from '@/lib/oracle/hooks'
import { AgentMetrics } from '@/components/oracle/agent-metrics'
import { AgentActivity } from '@/components/oracle/agent-activity'
import { ProGate } from '@/components/oracle/pro-gate'

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: profileData, isLoading, error } = useAgentProfile(id)
  const { data: metricsData } = useAgentMetrics(id)
  const { data: activityData } = useAgentActivity(id)

  const agent = (profileData as any)?.data ?? profileData
  const metrics = (metricsData as any)?.data ?? metricsData
  const activities = (activityData as any)?.data ?? []

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 4 }).map((_, i) => <Card key={i} className="h-20 animate-pulse border-white/5 bg-white/[0.02]" />)}</div>
  }

  if (error && ((error as any)?.statusCode === 404 || (error as any)?.status === 404)) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <p className="text-lg font-semibold text-white">Agent not found</p>
        <p className="mt-1 text-sm text-slate-400">No agent exists with ID &ldquo;{id}&rdquo;</p>
      </div>
    )
  }

  if (!agent) return null

  return (
    <div className="space-y-6 pb-16">
      {/* Profile header */}
      <div>
        <h1 className="text-2xl font-bold text-white">{agent.display_name ?? agent.displayName ?? id}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {(agent.erc8004_id ?? agent.erc8004Id) && (
            <Badge variant="outline" className="border-white/10 text-xs text-slate-400">
              ERC-8004: {agent.erc8004_id ?? agent.erc8004Id}
            </Badge>
          )}
          {agent.reputation && (
            <Badge className="bg-lucid/20 text-xs text-lucid">
              Rep: {agent.reputation.score}
            </Badge>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Wallets', value: agent.stats?.wallet_count ?? agent.stats?.walletCount ?? 0 },
          { label: 'Protocols', value: agent.stats?.protocol_count ?? agent.stats?.protocolCount ?? 0 },
          { label: 'Evidence', value: agent.stats?.evidence_count ?? agent.stats?.evidenceCount ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="border-white/5 bg-white/[0.02] p-4">
            <p className="text-xs text-slate-400">{s.label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums text-white">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Wallets table */}
      {agent.wallets?.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-white">Wallets</h2>
          <div className="rounded-xl border border-white/5 bg-white/[0.02]">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5">
                  <TableHead className="text-slate-400">Chain</TableHead>
                  <TableHead className="text-slate-400">Address</TableHead>
                  <TableHead className="text-slate-400">Type</TableHead>
                  <TableHead className="text-right text-slate-400">Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agent.wallets.map((w: any, i: number) => (
                  <TableRow key={i} className="border-white/5">
                    <TableCell>
                      <Badge variant="outline" className="border-white/10 text-[10px]">{w.chain}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-300">{w.address?.slice(0, 10)}...{w.address?.slice(-6)}</TableCell>
                    <TableCell className="text-xs text-slate-400">{w.link_type ?? w.linkType}</TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-slate-300">{((w.confidence ?? 0) * 100).toFixed(0)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}

      {/* Pro metrics */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Detailed Metrics</h2>
        <ProGate feature="detailed agent metrics">
          <AgentMetrics data={metrics} />
        </ProGate>
      </section>

      {/* Pro activity */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Activity</h2>
        <ProGate feature="agent activity feed">
          <AgentActivity events={activities} />
        </ProGate>
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Create agent detail loading skeleton**

Create `src/app/(oracle)/agents/[id]/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function AgentDetailLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-56 animate-pulse rounded bg-white/[0.06]" />
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="h-20 animate-pulse border-white/5 bg-white/[0.02]" />
        ))}
      </div>
      <Card className="h-48 animate-pulse border-white/5 bg-white/[0.02]" />
      <Card className="h-48 animate-pulse border-white/5 bg-white/[0.02]" />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/components/oracle/agent-metrics.tsx src/components/oracle/agent-activity.tsx src/app/\(oracle\)/agents/\[id\]/
git commit -m "feat(oracle): add agent detail page with profile, metrics, activity"
```

---

### Task 14: Protocols pages

**Files:**
- Create: `C:\LucidMerged\src\components\oracle\protocol-metrics.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\protocols\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\protocols\loading.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\protocols\[id]\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\protocols\[id]\loading.tsx`

- [ ] **Step 1: Create protocol metrics component**

Create `src/components/oracle/protocol-metrics.tsx`:

```tsx
import { Card } from '@/components/ui/card'

interface ProtocolMetricsProps {
  data: any
}

export function ProtocolMetrics({ data }: ProtocolMetricsProps) {
  if (!data) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-slate-400">Total Agents</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-white">{data.agents?.total ?? 0}</p>
      </Card>
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-slate-400">Total Wallets</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-white">{data.wallets?.total ?? 0}</p>
      </Card>
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-slate-400">Recent Registrations (7d)</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-white">{data.recent_registrations_7d ?? data.recentRegistrations7d ?? 0}</p>
      </Card>
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-slate-400">Total Evidence</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-white">{data.evidence?.total ?? 0}</p>
      </Card>
      <Card className="border-white/5 bg-white/[0.02] p-4">
        <p className="text-xs text-slate-400">Active Conflicts</p>
        <p className="mt-1 text-xl font-bold tabular-nums text-white">{data.active_conflicts ?? data.activeConflicts ?? 0}</p>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create protocols list page**

Create `src/app/(oracle)/protocols/page.tsx`:

```tsx
'use client'

import { useProtocols } from '@/lib/oracle/hooks'
import { ProtocolCard } from '@/components/oracle/protocol-card'
import { Card } from '@/components/ui/card'

export default function ProtocolsPage() {
  const { data, isLoading } = useProtocols()
  const protocols = (data as any)?.data ?? data ?? []
  const list = Array.isArray(protocols) ? protocols : []

  return (
    <div className="space-y-6 pb-16">
      <h1 className="text-2xl font-bold text-white">Protocols</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-28 animate-pulse border-white/5 bg-white/[0.02]" />
            ))
          : list.map((p: any) => (
              <ProtocolCard
                key={p.id}
                id={p.id}
                name={p.name ?? p.id}
                chains={p.chains}
                status={p.status}
                agentCount={p.stats?.agent_count ?? p.stats?.agentCount}
                walletCount={p.stats?.wallet_count ?? p.stats?.walletCount}
              />
            ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create protocols loading + protocol detail page + loading**

Create `src/app/(oracle)/protocols/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function ProtocolsLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-32 animate-pulse rounded bg-white/[0.06]" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="h-28 animate-pulse border-white/5 bg-white/[0.02]" />
        ))}
      </div>
    </div>
  )
}
```

Create `src/app/(oracle)/protocols/[id]/page.tsx`:

```tsx
'use client'

import { use } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useProtocolDetail, useProtocolMetrics } from '@/lib/oracle/hooks'
import { ProtocolMetrics } from '@/components/oracle/protocol-metrics'
import { ProGate } from '@/components/oracle/pro-gate'

export default function ProtocolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: detailData, isLoading, error } = useProtocolDetail(id)
  const { data: metricsData } = useProtocolMetrics(id)

  const protocol = (detailData as any)?.data ?? detailData
  const metrics = (metricsData as any)?.data ?? metricsData

  if (isLoading) {
    return <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Card key={i} className="h-20 animate-pulse border-white/5 bg-white/[0.02]" />)}</div>
  }

  if (error && ((error as any)?.statusCode === 404 || (error as any)?.status === 404)) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
        <p className="text-lg font-semibold text-white">Protocol not found</p>
        <p className="mt-1 text-sm text-slate-400">No protocol exists with ID &ldquo;{id}&rdquo;</p>
      </div>
    )
  }

  if (!protocol) return null

  return (
    <div className="space-y-6 pb-16">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">{protocol.name ?? id}</h1>
          <span className={`h-2 w-2 rounded-full ${protocol.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        </div>
        {protocol.chains?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {protocol.chains.map((c: string) => (
              <Badge key={c} variant="outline" className="border-white/10 text-xs text-slate-400">{c}</Badge>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="border-white/5 bg-white/[0.02] p-4">
          <p className="text-xs text-slate-400">Agents</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-white">{protocol.stats?.agent_count ?? protocol.stats?.agentCount ?? 0}</p>
        </Card>
        <Card className="border-white/5 bg-white/[0.02] p-4">
          <p className="text-xs text-slate-400">Wallets</p>
          <p className="mt-1 text-xl font-bold tabular-nums text-white">{protocol.stats?.wallet_count ?? protocol.stats?.walletCount ?? 0}</p>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Detailed Metrics</h2>
        <ProGate feature="protocol metrics">
          <ProtocolMetrics data={metrics} />
        </ProGate>
      </section>
    </div>
  )
}
```

Create `src/app/(oracle)/protocols/[id]/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function ProtocolDetailLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-40 animate-pulse rounded bg-white/[0.06]" />
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="h-20 animate-pulse border-white/5 bg-white/[0.02]" />
        ))}
      </div>
      <Card className="h-48 animate-pulse border-white/5 bg-white/[0.02]" />
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/oracle/protocol-metrics.tsx src/app/\(oracle\)/protocols/
git commit -m "feat(oracle): add protocols list page and protocol detail page"
```

---

### Task 15: Reports page with verifier

**Files:**
- Create: `C:\LucidMerged\src\lib\oracle\report-mapper.ts`
- Create: `C:\LucidMerged\src\components\oracle\report-verifier.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\reports\page.tsx`
- Create: `C:\LucidMerged\src\app\(oracle)\reports\loading.tsx`

- [ ] **Step 1: Create report mapper utility**

Create `src/lib/oracle/report-mapper.ts`:

```typescript
/**
 * Maps a raw wire-format report (snake_case) to the SDK's camelCase request shape.
 * This is the single place in the dashboard with format-aware logic.
 */
export function mapWireReportToSdk(raw: Record<string, any>): Record<string, any> {
  return {
    feedId: raw.feed_id ?? raw.feedId,
    feedVersion: raw.feed_version ?? raw.feedVersion,
    reportTimestamp: raw.report_timestamp ?? raw.reportTimestamp,
    values: raw.values,
    inputManifestHash: raw.input_manifest_hash ?? raw.inputManifestHash,
    computationHash: raw.computation_hash ?? raw.computationHash,
    revision: raw.revision,
    signerSetId: raw.signer_set_id ?? raw.signerSetId,
    signatures: (raw.signatures ?? []).map((s: any) => ({
      signer: s.signer,
      sig: s.sig,
    })),
  }
}
```

- [ ] **Step 2: Create report verifier component**

Create `src/components/oracle/report-verifier.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useOracleClient } from '@/lib/oracle/data-provider'
import { mapWireReportToSdk } from '@/lib/oracle/report-mapper'

export function ReportVerifier() {
  const oracle = useOracleClient()
  const [input, setInput] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleVerify = async () => {
    setError(null)
    setResult(null)

    let parsed: any
    try {
      parsed = JSON.parse(input)
    } catch {
      setError('Invalid JSON. Paste a report envelope with feed_id, feed_version, report_timestamp, values, signatures, etc.')
      return
    }

    const report = parsed.report ?? parsed
    const mapped = mapWireReportToSdk(report)

    setLoading(true)
    try {
      const res = await oracle.reports.verify({ report: mapped } as any)
      setResult(res)
    } catch (err: any) {
      setError(err.message || 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  const checks = (result as any)?.data?.checks ?? (result as any)?.checks

  return (
    <Card className="border-white/5 bg-white/[0.02] p-5">
      <h3 className="text-sm font-semibold text-white">Verify Report</h3>
      <p className="mt-1 text-xs text-slate-400">Paste a raw report envelope (JSON) to verify its signature and integrity</p>

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder='{"feed_id": "aai", "feed_version": 1, "report_timestamp": ..., "signatures": [...]}'
        className="mt-3 h-32 w-full resize-none rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-lucid/50"
      />

      <button
        onClick={handleVerify}
        disabled={!input.trim() || loading}
        className="mt-3 rounded-lg bg-gradient-to-r from-lucid to-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-lucid/20 transition-all hover:brightness-110 disabled:opacity-50"
      >
        {loading ? 'Verifying...' : 'Verify'}
      </button>

      {error && (
        <p className="mt-3 text-xs text-red-400">{error}</p>
      )}

      {checks && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-2">
            <Badge className={checks.signature === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}>
              Signature: {checks.signature}
            </Badge>
            <Badge className={checks.payload_integrity === 'pass' || checks.payloadIntegrity === 'pass' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}>
              Integrity: {checks.payload_integrity ?? checks.payloadIntegrity}
            </Badge>
          </div>
          {(checks.publication ?? (result as any)?.data?.publication) && (
            <div className="text-xs text-slate-400">
              {((checks.publication ?? (result as any)?.data?.publication)?.solana_tx ?? (checks.publication ?? (result as any)?.data?.publication)?.solanaTx) && (
                <p>Solana TX: <span className="font-mono text-slate-300">{((checks.publication ?? (result as any)?.data?.publication)?.solana_tx ?? (checks.publication ?? (result as any)?.data?.publication)?.solanaTx)}</span></p>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 3: Create reports page**

Create `src/app/(oracle)/reports/page.tsx`:

```tsx
'use client'

import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useLatestReport } from '@/lib/oracle/hooks'
import { ReportVerifier } from '@/components/oracle/report-verifier'

export default function ReportsPage() {
  const { data, isLoading } = useLatestReport()
  const report = (data as any)?.report ?? data
  const feeds = report?.feeds ?? []

  return (
    <div className="space-y-6 pb-16">
      <h1 className="text-2xl font-bold text-white">Reports</h1>

      {/* Latest report */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Latest Report</h2>
        {isLoading ? (
          <Card className="h-40 animate-pulse border-white/5 bg-white/[0.02]" />
        ) : feeds.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {feeds.map((feed: any) => (
              <Card key={feed.feed_id ?? feed.feedId} className="border-white/5 bg-white/[0.02] p-4">
                <p className="text-xs font-medium text-slate-400">{feed.feed_id ?? feed.feedId}</p>
                <p className="mt-1 text-xl font-bold tabular-nums text-white">{feed.value ?? '—'}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="outline" className="border-white/10 text-[10px] text-slate-400">
                    Confidence: {((feed.confidence ?? 0) * 100).toFixed(1)}%
                  </Badge>
                </div>
                <p className="mt-2 truncate font-mono text-[10px] text-slate-500" title={feed.signature}>
                  Sig: {feed.signature?.slice(0, 20)}...
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="border-white/5 bg-white/[0.02] p-6 text-center">
            <p className="text-sm text-slate-400">No reports available yet</p>
          </Card>
        )}
      </section>

      {/* Verifier */}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-white">Report Verification</h2>
        <ReportVerifier />
      </section>
    </div>
  )
}
```

- [ ] **Step 4: Create reports loading skeleton**

Create `src/app/(oracle)/reports/loading.tsx`:

```tsx
import { Card } from '@/components/ui/card'

export default function ReportsLoading() {
  return (
    <div className="space-y-6 pb-16">
      <div className="h-8 w-28 animate-pulse rounded bg-white/[0.06]" />
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="h-32 animate-pulse border-white/5 bg-white/[0.02]" />
        ))}
      </div>
      <Card className="h-64 animate-pulse border-white/5 bg-white/[0.02]" />
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/oracle/report-mapper.ts src/components/oracle/report-verifier.tsx src/app/\(oracle\)/reports/
git commit -m "feat(oracle): add reports page with latest report display and verifier"
```

---

## Chunk 4: Integration Verification + CLAUDE.md Update

### Task 16: Build verification

**Files:** None new — verification only

- [ ] **Step 1: Verify TypeScript compiles**

```bash
cd C:\LucidMerged
npx tsc --noEmit 2>&1 | grep -c 'error TS' || echo "0 errors"
```

Fix any type errors. Common issues:
- SDK types may use different casing — adjust `as any` casts if needed
- `lightweight-charts` may need `'use client'` + dynamic import if SSR fails

- [ ] **Step 2: Verify dev server starts with feature flag**

```bash
cd C:\LucidMerged
FEATURE_ORACLE_DASHBOARD=true npm run dev &
sleep 8

# Test all routes return 200
for path in /oracle /oracle/agents /oracle/protocols /oracle/reports; do
  status=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000${path}")
  echo "${path}: ${status}"
done

kill %1
```

Expected: All routes return `200`.

- [ ] **Step 3: Verify feature flag gate works**

```bash
cd C:\LucidMerged
npm run dev &
sleep 5
status=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/oracle)
echo "Without flag: ${status}"
kill %1
```

Expected: `307` (redirect to `/`).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git diff --cached --stat
# Only commit if there are changes
git commit -m "fix(oracle): address build verification issues" || echo "No fixes needed"
```

---

### Task 17: Update CLAUDE.md

**Files:**
- Modify: `C:\lucid-agent-oracle\CLAUDE.md`

- [ ] **Step 1: Update Plan 3D status**

In `C:\lucid-agent-oracle\CLAUDE.md`, find the implementation status table and change Plan 3D:

```markdown
| Plan 3D | Done | Dashboard (Next.js in LucidMerged — `oracle.lucid.foundation`, extraction-ready `(oracle)/` route group) |
```

- [ ] **Step 2: Add dashboard section**

Add after the SDK Generation section:

```markdown
### Dashboard (Plan 3D)

Dashboard lives in LucidMerged repo at `src/app/(oracle)/`. Requires `FEATURE_ORACLE_DASHBOARD=true` env var.

```bash
# Local development
cd C:\LucidMerged
FEATURE_ORACLE_DASHBOARD=true npm run dev
# Access at http://localhost:3000/oracle or http://oracle.localhost:3000
```

**Key directories:**
- `src/app/(oracle)/` — Route group (layouts, pages, loading skeletons)
- `src/components/oracle/` — Domain-specific components
- `src/lib/oracle/` — SDK provider, hooks, cache keys
```

- [ ] **Step 3: Commit**

```bash
cd C:\lucid-agent-oracle
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md — Plan 3D status + dashboard section"
```

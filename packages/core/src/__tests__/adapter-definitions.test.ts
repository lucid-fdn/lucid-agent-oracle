import { describe, it, expect, beforeEach } from 'vitest'
import { AdapterRegistry } from '../adapters/registry.js'
import { gatewayTapAdapter } from '../adapters/gateway-tap-adapter.js'
import { erc8004Adapter } from '../adapters/erc8004-adapter.js'
import { heliusAdapter } from '../adapters/helius-adapter.js'
import { sol8004Adapter } from '../adapters/sol8004-adapter.js'
import { registerDefaultAdapters } from '../adapters/register-defaults.js'
import { adapterRegistry } from '../adapters/registry.js'
import { TOPICS } from '../clients/redpanda.js'

describe('Built-in adapter definitions', () => {
  describe('gatewayTapAdapter', () => {
    it('has correct source and metadata', () => {
      expect(gatewayTapAdapter.source).toBe('lucid_gateway')
      expect(gatewayTapAdapter.version).toBe(1)
      expect(gatewayTapAdapter.topic).toBe(TOPICS.RAW_GATEWAY)
      expect(gatewayTapAdapter.chains).toContain('offchain')
    })

    it('has no webhook or identity handler', () => {
      expect(gatewayTapAdapter.webhook).toBeUndefined()
      expect(gatewayTapAdapter.identity).toBeUndefined()
    })
  })

  describe('erc8004Adapter', () => {
    it('has correct source and metadata', () => {
      expect(erc8004Adapter.source).toBe('erc8004')
      expect(erc8004Adapter.version).toBe(2)
      expect(erc8004Adapter.topic).toBe(TOPICS.RAW_ERC8004)
      expect(erc8004Adapter.chains).toContain('base')
    })

    it('has identity handler for all ERC-8004 event types', () => {
      expect(erc8004Adapter.identity).toBeDefined()
      expect(erc8004Adapter.identity!.handles).toContain('agent_registered')
      expect(erc8004Adapter.identity!.handles).toContain('uri_updated')
      expect(erc8004Adapter.identity!.handles).toContain('metadata_set')
      expect(erc8004Adapter.identity!.handles).toContain('ownership_transferred')
      expect(erc8004Adapter.identity!.handles).toContain('feedback_revoked')
    })

    it('has no webhook', () => {
      expect(erc8004Adapter.webhook).toBeUndefined()
    })
  })

  describe('heliusAdapter', () => {
    it('has correct source and metadata', () => {
      expect(heliusAdapter.source).toBe('agent_wallets_sol')
      expect(heliusAdapter.version).toBe(1)
      expect(heliusAdapter.topic).toBe(TOPICS.RAW_AGENT_WALLETS)
      expect(heliusAdapter.chains).toContain('solana')
    })

    it('has webhook handler', () => {
      expect(heliusAdapter.webhook).toBeDefined()
      expect(heliusAdapter.webhook!.path).toBe('/v1/internal/helius/webhook')
    })

    it('has no identity handler', () => {
      expect(heliusAdapter.identity).toBeUndefined()
    })
  })

  describe('sol8004Adapter', () => {
    it('has correct source and metadata', () => {
      expect(sol8004Adapter.source).toBe('sol8004')
      expect(sol8004Adapter.version).toBe(1)
      expect(sol8004Adapter.chains).toContain('solana')
      expect(sol8004Adapter.description).toContain('Solana 8004')
    })

    it('shares identity handler with erc8004Adapter', () => {
      expect(sol8004Adapter.identity).toBeDefined()
      expect(sol8004Adapter.identity).toBe(erc8004Adapter.identity)
    })

    it('has no webhook', () => {
      expect(sol8004Adapter.webhook).toBeUndefined()
    })
  })
})

describe('registerDefaultAdapters', () => {
  beforeEach(() => {
    adapterRegistry.clear()
  })

  it('registers all built-in adapters', () => {
    registerDefaultAdapters()
    expect(adapterRegistry.size).toBe(4)
    expect(adapterRegistry.get('lucid_gateway')).toBeDefined()
    expect(adapterRegistry.get('erc8004')).toBeDefined()
    expect(adapterRegistry.get('agent_wallets_sol')).toBeDefined()
    expect(adapterRegistry.get('sol8004')).toBeDefined()
  })

  it('is idempotent', () => {
    registerDefaultAdapters()
    registerDefaultAdapters() // should not throw
    expect(adapterRegistry.size).toBe(4)
  })
})

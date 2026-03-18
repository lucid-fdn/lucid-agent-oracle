import { describe, it, expect } from 'vitest'
import { validateStreamParams } from '../routes/stream.js'

describe('SSE endpoint validation', () => {
  it('parses valid channels', () => {
    const result = validateStreamParams('feeds,reports', undefined)
    expect(result.channels).toEqual(['feeds', 'reports'])
    expect(result.error).toBeUndefined()
  })

  it('rejects invalid channel names', () => {
    const result = validateStreamParams('feeds,invalid_channel', undefined)
    expect(result.error).toContain('invalid_channel')
  })

  it('rejects empty channels', () => {
    const result = validateStreamParams('', undefined)
    expect(result.error).toBeDefined()
  })

  it('accepts all three valid channels', () => {
    const result = validateStreamParams('feeds,agent_events,reports', undefined)
    expect(result.channels).toHaveLength(3)
    expect(result.error).toBeUndefined()
  })

  it('parses valid filter JSON', () => {
    const result = validateStreamParams('feeds', '{"feeds":["aegdp"]}')
    expect(result.filters).toEqual({ feeds: ['aegdp'] })
  })

  it('rejects malformed filter JSON', () => {
    const result = validateStreamParams('feeds', 'not-json')
    expect(result.error).toContain('filter')
  })

  it('rejects filter keys not matching subscribed channels', () => {
    const result = validateStreamParams('feeds', '{"agent_events":["a1"]}')
    expect(result.error).toContain('agent_events')
  })
})

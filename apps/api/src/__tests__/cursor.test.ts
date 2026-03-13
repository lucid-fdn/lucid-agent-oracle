import { describe, it, expect } from 'vitest'

// Set secret before importing cursor module
process.env.CURSOR_SECRET = 'test-cursor-secret-32chars-long!'

const { encodeCursor, decodeCursor, assertCursorSecret } = await import('../utils/cursor.js')

describe('Cursor utilities', () => {
  it('assertCursorSecret does not throw when secret is set', () => {
    expect(() => assertCursorSecret()).not.toThrow()
  })

  it('encode then decode round-trips correctly', () => {
    const cursor = encodeCursor('2026-03-12T00:00:00Z', 'ae_abc123')
    expect(typeof cursor).toBe('string')
    const decoded = decodeCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded!.s).toBe('2026-03-12T00:00:00Z')
    expect(decoded!.id).toBe('ae_abc123')
    expect(decoded!.v).toBe(1)
  })

  it('encode with numeric sort value round-trips', () => {
    const cursor = encodeCursor(42, 'ae_xyz')
    const decoded = decodeCursor(cursor)
    expect(decoded).not.toBeNull()
    expect(decoded!.s).toBe(42)
  })

  it('rejects tampered cursor (modified payload)', () => {
    const cursor = encodeCursor('2026-03-12', 'ae_1')
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    raw.id = 'ae_tampered'
    const tampered = Buffer.from(JSON.stringify(raw)).toString('base64url')
    expect(decodeCursor(tampered)).toBeNull()
  })

  it('rejects completely invalid cursor string', () => {
    expect(decodeCursor('not-a-cursor')).toBeNull()
    expect(decodeCursor('')).toBeNull()
  })

  it('rejects cursor with wrong version', () => {
    const cursor = encodeCursor('val', 'ae_1')
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString())
    raw.v = 99
    const modified = Buffer.from(JSON.stringify(raw)).toString('base64url')
    expect(decodeCursor(modified)).toBeNull()
  })
})

import { createHmac } from 'node:crypto'

interface CursorPayload {
  v: number
  s: string | number
  id: string
}

function getSecrets(): { current: string; previous?: string } {
  const current = process.env.CURSOR_SECRET
  if (!current) throw new Error('CURSOR_SECRET env var is required')
  return { current, previous: process.env.CURSOR_SECRET_PREV }
}

export function assertCursorSecret(): void {
  getSecrets()
}

function sign(payload: CursorPayload, secret: string): string {
  const data = `${payload.v}:${String(payload.s)}:${payload.id}`
  return createHmac('sha256', secret).update(data).digest('base64url')
}

export function encodeCursor(s: string | number, id: string): string {
  const { current } = getSecrets()
  const payload: CursorPayload = { v: 1, s, id }
  const sig = sign(payload, current)
  return Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
}

export function decodeCursor(cursor: string): CursorPayload | null {
  if (!cursor) return null
  try {
    const raw = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as CursorPayload & { sig: string }
    if (raw.v !== 1) return null
    const { current, previous } = getSecrets()
    if (sign(raw, current) === raw.sig) return { v: raw.v, s: raw.s, id: raw.id }
    if (previous && sign(raw, previous) === raw.sig) return { v: raw.v, s: raw.s, id: raw.id }
    return null
  } catch {
    return null
  }
}

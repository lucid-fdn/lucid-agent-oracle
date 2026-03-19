/**
 * Olas Marketplace Enricher — fetches image, description, and category
 * from the Olas marketplace for agents with olas.network URIs.
 *
 * Tries the Olas API first, then falls back to fetching the agent_uri JSON.
 *
 * Runs every 15 minutes, 5 agents per cycle.
 * Advisory-locked to prevent concurrent execution across replicas.
 * Brittle by nature — everything is wrapped in try/catch, never fails the cycle.
 */
import type pg from 'pg'

export interface OlasEnricherConfig {
  intervalMs: number
  agentsPerCycle: number
  timeoutMs: number
}

const DEFAULT_CONFIG: OlasEnricherConfig = {
  intervalMs: 15 * 60_000, // 15 minutes
  agentsPerCycle: 5,
  timeoutMs: 10_000,
}

interface OlasServiceData {
  image_url?: string
  description?: string
  category?: string
}

/**
 * Enrich Olas agents with marketplace data.
 */
export async function enrichOlasAgents(
  pool: pg.Pool,
  config: OlasEnricherConfig = DEFAULT_CONFIG,
): Promise<number> {
  const client = await pool.connect()
  let enriched = 0

  try {
    const lockResult = await client.query("SELECT pg_try_advisory_lock(hashtext('olas_enricher'))")
    if (!lockResult.rows[0].pg_try_advisory_lock) return 0

    // Select agents with Olas URIs that haven't been enriched yet
    const agents = await client.query(
      `SELECT id, agent_uri, metadata_json
       FROM oracle_agent_entities
       WHERE image_url IS NULL
         AND agent_uri LIKE '%olas%'
       ORDER BY created_at ASC
       LIMIT $1::int`,
      [config.agentsPerCycle],
    )

    for (const agent of agents.rows) {
      try {
        const agentUri = agent.agent_uri as string
        const agentId = agent.id as string

        let data: OlasServiceData | null = null

        // Try to extract service ID from the URI and call Olas API
        const serviceId = extractOlasServiceId(agentUri)
        if (serviceId) {
          data = await fetchOlasAPIData(serviceId, config.timeoutMs)
        }

        // Fallback: try fetching the agent_uri JSON itself
        if (!data) {
          data = await fetchOlasURIData(agentUri, config.timeoutMs)
        }

        if (data && (data.image_url || data.description || data.category)) {
          await client.query(
            `UPDATE oracle_agent_entities
             SET image_url = COALESCE($1::text, image_url),
                 description = COALESCE($2::text, description),
                 category = COALESCE($3::text, category),
                 updated_at = now()
             WHERE id = $4::text`,
            [data.image_url ?? null, data.description ?? null, data.category ?? null, agentId],
          )
          enriched++
        } else {
          // Mark as attempted so we don't retry immediately
          // Set image_url to empty string to indicate we tried
          await client.query(
            `UPDATE oracle_agent_entities
             SET image_url = '',
                 updated_at = now()
             WHERE id = $1::text AND image_url IS NULL`,
            [agentId],
          )
        }

        // Rate limit: 500ms between agents
        await new Promise((r) => setTimeout(r, 500))
      } catch (err) {
        console.error(`[olas-enricher] Error enriching ${(agent.id as string).slice(0, 20)}:`, (err as Error).message)
      }
    }

    await client.query("SELECT pg_advisory_unlock(hashtext('olas_enricher'))")
  } finally {
    client.release()
  }

  return enriched
}

/**
 * Extract Olas service ID from a URI like:
 * - https://marketplace.olas.network/services/123
 * - https://registry.olas.network/gnosis/services/456
 */
function extractOlasServiceId(uri: string): string | null {
  try {
    const match = uri.match(/services\/(\d+)/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

/**
 * Fetch service data from Olas marketplace API.
 */
async function fetchOlasAPIData(
  serviceId: string,
  timeoutMs: number,
): Promise<OlasServiceData | null> {
  const url = `https://marketplace.olas.network/api/services/${serviceId}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!res.ok) return null

    const data = await res.json() as Record<string, unknown>

    return {
      image_url: typeof data.image === 'string' ? data.image : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      category: typeof data.category === 'string' ? data.category :
                typeof data.service_type === 'string' ? data.service_type : undefined,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fallback: fetch the agent_uri JSON and extract metadata.
 */
async function fetchOlasURIData(
  uri: string,
  timeoutMs: number,
): Promise<OlasServiceData | null> {
  if (!uri.startsWith('http')) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(uri, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })

    if (!res.ok) return null

    const text = await res.text()
    if (text.length > 500_000) return null // 500KB max

    const data = JSON.parse(text) as Record<string, unknown>

    return {
      image_url: typeof data.image === 'string' ? data.image :
                 typeof data.image_url === 'string' ? data.image_url : undefined,
      description: typeof data.description === 'string' ? data.description : undefined,
      category: typeof data.category === 'string' ? data.category :
                typeof data.type === 'string' ? data.type : undefined,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start the Olas enricher on a timer.
 */
export function startOlasEnricher(
  pool: pg.Pool,
  config: Partial<OlasEnricherConfig> = {},
): { stop: () => void } {
  const fullConfig = { ...DEFAULT_CONFIG, ...config }
  let running = true

  const loop = async () => {
    while (running) {
      try {
        const n = await enrichOlasAgents(pool, fullConfig)
        if (n > 0) console.log(`[olas-enricher] Enriched ${n} Olas agents`)
      } catch (err) {
        console.error('[olas-enricher] Error:', (err as Error).message)
      }
      await new Promise((r) => setTimeout(r, fullConfig.intervalMs))
    }
  }

  loop()
  return { stop: () => { running = false } }
}

/**
 * Database-backed rate limiter using Neon.
 *
 * Replaces the previous in-memory Map which reset on every serverless cold
 * start, making it non-functional in production. This version persists counts
 * in the `rate_limits` table so limits are enforced consistently across all
 * concurrent serverless instances.
 *
 * Strategy: fixed 1-minute window keyed on (ip, window_start).
 * - INSERT … ON CONFLICT increments atomically — no race conditions.
 * - Opportunistic pruning deletes rows older than 2 minutes on ~5 % of calls
 *   so the table stays small without a cron job.
 */

import { neon } from '@neondatabase/serverless'

const WINDOW_MS  = 60_000 // 1 minute
const MAX_REQUESTS = 60   // 60 write ops per minute per IP
const PRUNE_PROBABILITY = 0.05

function getDb() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL environment variable is not set')
  return neon(url)
}

/** Truncate a timestamp down to the start of the current window bucket. */
function windowStart(now: number): string {
  return new Date(Math.floor(now / WINDOW_MS) * WINDOW_MS).toISOString()
}

export async function rateLimit(
  ip: string,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  const sql = getDb()
  const now = Date.now()
  const bucket = windowStart(now)

  // Atomic upsert: insert with count=1 or increment existing row.
  const rows = await sql`
    INSERT INTO rate_limits (ip, window_start, count)
    VALUES (${ip}, ${bucket}::timestamptz, 1)
    ON CONFLICT (ip, window_start)
    DO UPDATE SET count = rate_limits.count + 1
    RETURNING count
  `

  const count = (rows[0] as { count: number }).count

  // Opportunistically prune old rows (~5 % of requests) — fire-and-forget.
  if (Math.random() < PRUNE_PROBABILITY) {
    const cutoff = new Date(now - WINDOW_MS * 2).toISOString()
    sql`DELETE FROM rate_limits WHERE window_start < ${cutoff}::timestamptz`.catch(
      () => { /* non-critical */ },
    )
  }

  if (count > MAX_REQUESTS) {
    const windowEndMs = Math.ceil(now / WINDOW_MS) * WINDOW_MS
    return { allowed: false, retryAfterMs: windowEndMs - now }
  }

  return { allowed: true, retryAfterMs: 0 }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0].trim() ?? 'unknown'
}

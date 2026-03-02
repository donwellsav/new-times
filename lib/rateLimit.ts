/**
 * Simple in-memory rate limiter.
 * Limits write operations (POST, DELETE) per IP to prevent abuse.
 * Resets per serverless instance — adequate for single-user/small-team deployments.
 */

const WINDOW_MS = 60_000 // 1 minute sliding window
const MAX_REQUESTS = 60  // 60 write ops per minute per IP

interface RateLimitEntry {
  count: number
  resetAt: number
}

const store = new Map<string, RateLimitEntry>()

export function rateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const entry = store.get(ip)

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, retryAfterMs: 0 }
  }

  if (entry.count >= MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }

  entry.count++
  return { allowed: true, retryAfterMs: 0 }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  return forwarded?.split(',')[0].trim() ?? 'unknown'
}

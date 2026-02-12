// ============================================================
// Помощник — Rate Limiter (Upstash Redis Sliding Window)
// ============================================================
// Per-license-key rate limiting using Redis sorted sets.
// No extra npm packages — uses the same REST API as db.ts.
// ============================================================

import { redisCommand } from './db';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetInSeconds: number;
}

// Plan-based rate limits (requests per minute)
const RATE_LIMITS: Record<string, number> = {
  free: 5,        // 5 req/min
  starter: 15,    // 15 req/min
  pro: 30,        // 30 req/min
  business: 60,   // 60 req/min
};

const WINDOW_MS = 60_000; // 1 minute sliding window

/**
 * Check and consume a rate limit token for the given license key.
 * Uses Redis sorted set with timestamp scores for a sliding window.
 *
 * Key format: ratelimit:{licenseKey}
 * Each request adds a member with score = current timestamp.
 * Old entries (outside the window) are pruned on each check.
 */
export async function checkRateLimit(
  licenseKey: string,
  plan: string,
): Promise<RateLimitResult> {
  const limit = RATE_LIMITS[plan] ?? RATE_LIMITS.free;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const key = `ratelimit:${licenseKey}`;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`; // unique member

  try {
    // Pipeline: remove old entries, add new entry, count entries, set TTL
    // Using individual commands since we're on REST API

    // 1. Remove entries older than the window
    await redisCommand('ZREMRANGEBYSCORE', key, 0, windowStart);

    // 2. Count current entries in the window
    const count = await redisCommand('ZCARD', key);
    const currentCount = typeof count === 'number' ? count : parseInt(count) || 0;

    if (currentCount >= limit) {
      // Rate limited — find when the oldest entry expires
      const oldest = await redisCommand('ZRANGE', key, 0, 0, 'WITHSCORES');
      let resetIn = WINDOW_MS / 1000; // default: full window
      if (oldest && Array.isArray(oldest) && oldest.length >= 2) {
        const oldestScore = parseInt(oldest[1]) || now;
        resetIn = Math.max(1, Math.ceil((oldestScore + WINDOW_MS - now) / 1000));
      }

      return {
        allowed: false,
        remaining: 0,
        limit,
        resetInSeconds: resetIn,
      };
    }

    // 3. Add the new request
    await redisCommand('ZADD', key, now, member);

    // 4. Set TTL to auto-cleanup (window + buffer)
    await redisCommand('EXPIRE', key, Math.ceil(WINDOW_MS / 1000) + 10);

    return {
      allowed: true,
      remaining: Math.max(0, limit - currentCount - 1),
      limit,
      resetInSeconds: Math.ceil(WINDOW_MS / 1000),
    };
  } catch (error) {
    // If rate limiting fails (Redis down), allow the request
    // but log the error. Better to serve than to block.
    console.error('[RateLimit] Error checking rate limit:', error);
    return {
      allowed: true,
      remaining: limit,
      limit,
      resetInSeconds: Math.ceil(WINDOW_MS / 1000),
    };
  }
}

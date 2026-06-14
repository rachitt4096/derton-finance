type LoginRateLimitOptions = {
  windowMs: number
  maxAttempts: number
  blockMs: number
}

type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

type RateLimitBucket = {
  attempts: number[]
  blockedUntil: number
}

const normalizeIdentifier = (value: string) => value.trim().toUpperCase()

export class LoginRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>()

  constructor(private readonly options: LoginRateLimitOptions) {}

  consume(identifier: string, now = Date.now()): RateLimitResult {
    const key = normalizeIdentifier(identifier)
    const bucket = this.getBucket(key, now)

    if (bucket.blockedUntil > now) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: bucket.blockedUntil - now,
      }
    }

    bucket.attempts.push(now)
    const remaining = Math.max(0, this.options.maxAttempts - bucket.attempts.length)

    if (bucket.attempts.length >= this.options.maxAttempts) {
      bucket.blockedUntil = now + this.options.blockMs
      bucket.attempts = []
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: this.options.blockMs,
      }
    }

    return {
      allowed: true,
      remaining,
      retryAfterMs: 0,
    }
  }

  reset(identifier: string) {
    this.buckets.delete(normalizeIdentifier(identifier))
  }

  private getBucket(key: string, now: number) {
    const existing = this.buckets.get(key)
    if (!existing) {
      const created: RateLimitBucket = { attempts: [], blockedUntil: 0 }
      this.buckets.set(key, created)
      return created
    }

    if (existing.blockedUntil <= now) {
      existing.blockedUntil = 0
    }

    existing.attempts = existing.attempts.filter((attemptAt) => now - attemptAt < this.options.windowMs)

    if (existing.blockedUntil === 0 && existing.attempts.length === 0) {
      this.buckets.delete(key)
      const created: RateLimitBucket = { attempts: [], blockedUntil: 0 }
      this.buckets.set(key, created)
      return created
    }

    return existing
  }
}

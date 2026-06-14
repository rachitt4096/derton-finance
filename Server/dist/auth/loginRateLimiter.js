const normalizeIdentifier = (value) => value.trim().toUpperCase();
export class LoginRateLimiter {
    options;
    buckets = new Map();
    constructor(options) {
        this.options = options;
    }
    consume(identifier, now = Date.now()) {
        const key = normalizeIdentifier(identifier);
        const bucket = this.getBucket(key, now);
        if (bucket.blockedUntil > now) {
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: bucket.blockedUntil - now,
            };
        }
        bucket.attempts.push(now);
        const remaining = Math.max(0, this.options.maxAttempts - bucket.attempts.length);
        if (bucket.attempts.length >= this.options.maxAttempts) {
            bucket.blockedUntil = now + this.options.blockMs;
            bucket.attempts = [];
            return {
                allowed: false,
                remaining: 0,
                retryAfterMs: this.options.blockMs,
            };
        }
        return {
            allowed: true,
            remaining,
            retryAfterMs: 0,
        };
    }
    reset(identifier) {
        this.buckets.delete(normalizeIdentifier(identifier));
    }
    getBucket(key, now) {
        const existing = this.buckets.get(key);
        if (!existing) {
            const created = { attempts: [], blockedUntil: 0 };
            this.buckets.set(key, created);
            return created;
        }
        if (existing.blockedUntil <= now) {
            existing.blockedUntil = 0;
        }
        existing.attempts = existing.attempts.filter((attemptAt) => now - attemptAt < this.options.windowMs);
        if (existing.blockedUntil === 0 && existing.attempts.length === 0) {
            this.buckets.delete(key);
            const created = { attempts: [], blockedUntil: 0 };
            this.buckets.set(key, created);
            return created;
        }
        return existing;
    }
}

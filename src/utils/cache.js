/**
 * Response Cache - LRU cache for common JARVIS queries.
 *
 * Caches AI responses for frequently asked questions to:
 * 1. Reduce API calls (save money on Kimi/Gemini)
 * 2. Faster responses for common queries
 * 3. Consistent answers for pricing, policies, etc.
 *
 * Cache keys are normalized message hashes.
 * TTL-based expiry (default 15 minutes for dynamic, 1 hour for static).
 */

class ResponseCache {
  constructor(maxSize = 200) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  /**
   * Get cached response.
   * @param {string} key - Cache key (message text or normalized form)
   * @returns {object|null} Cached response or null
   */
  get(key) {
    const normalized = this._normalize(key);
    const entry = this.cache.get(normalized);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(normalized);
      this.stats.misses++;
      return null;
    }

    // Move to end (most recently used)
    this.cache.delete(normalized);
    this.cache.set(normalized, entry);
    this.stats.hits++;

    return entry.value;
  }

  /**
   * Set cached response.
   * @param {string} key - Cache key
   * @param {object} value - Response to cache
   * @param {number} ttlMs - Time to live in milliseconds (default 15 min)
   */
  set(key, value, ttlMs = 15 * 60 * 1000) {
    const normalized = this._normalize(key);

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(normalized)) {
      const oldest = this.cache.keys().next().value;
      this.cache.delete(oldest);
      this.stats.evictions++;
    }

    this.cache.set(normalized, {
      value,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    });
    this.stats.sets++;
  }

  /**
   * Check if response should be cached based on intent.
   * Static responses (pricing, policies) get longer TTL.
   */
  shouldCache(intent) {
    const staticIntents = ['pricing_inquiry', 'delivery', 'document_submit'];
    const dynamicIntents = ['booking_inquiry', 'general'];
    const neverCache = ['payment', 'complaint', 'emergency', 'cancellation'];

    if (neverCache.includes(intent)) return { cache: false };
    if (staticIntents.includes(intent)) return { cache: true, ttl: 60 * 60 * 1000 }; // 1 hour
    if (dynamicIntents.includes(intent)) return { cache: true, ttl: 5 * 60 * 1000 }; // 5 min
    return { cache: true, ttl: 15 * 60 * 1000 }; // 15 min default
  }

  /**
   * Invalidate cache entries matching a pattern.
   */
  invalidate(pattern) {
    const regex = new RegExp(pattern, 'i');
    let count = 0;
    for (const [key] of this.cache) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all cache.
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    return size;
  }

  /**
   * Normalize cache key - lowercase, remove extra spaces, strip punctuation.
   */
  _normalize(key) {
    if (!key) return '';
    return key
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? ((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100).toFixed(1)
      : '0.0';
    return {
      ...this.stats,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRate: `${hitRate}%`,
    };
  }
}

module.exports = new ResponseCache();

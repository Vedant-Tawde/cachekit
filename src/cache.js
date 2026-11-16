/**
 * @fileoverview High-performance in-memory cache engine with LRU eviction and TTL expiration.
 */

/**
 * @typedef {Object} CacheOptions
 * @property {number} [defaultTtl=0] Default time-to-live in milliseconds (0 = no expiration).
 * @property {number} [maxSize=Infinity] Maximum number of entries allowed in cache.
 * @property {number} [cleanupInterval=0] Optional periodic background cleanup interval in milliseconds (0 = disabled).
 */

/**
 * @typedef {Object} CacheStats
 * @property {number} hits Total number of cache hits.
 * @property {number} misses Total number of cache misses.
 * @property {number} sets Total number of set operations.
 * @property {number} evictions Total number of LRU capacity evictions.
 * @property {number} hitRate Ratio of hits to total lookups (0 to 1).
 * @property {number} size Current number of active (non-expired) entries.
 */

/**
 * @template K, V
 * Cache entry holding stored value and optional expiration timestamp.
 * @typedef {Object} CacheEntry
 * @property {V} value The stored value.
 * @property {number|null} expiresAt Expiration epoch timestamp in ms, or null if persistent.
 */

export class Cache {
  /** @type {Map<any, { value: any, expiresAt: number|null }>} */
  #store = new Map();

  /** @type {number} */
  #defaultTtl;

  /** @type {number} */
  #maxSize;

  /** @type {NodeJS.Timeout|null} */
  #cleanupTimer = null;

  /** @type {{ hits: number, misses: number, sets: number, evictions: number }} */
  #stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    evictions: 0
  };

  /**
   * Creates a new Cache instance.
   * @param {CacheOptions} [options={}] Configuration options.
   * @throws {TypeError|RangeError} If configuration values are invalid.
   */
  constructor(options = {}) {
    if (options !== null && typeof options !== 'object') {
      throw new TypeError('Cache options must be an object');
    }

    const { defaultTtl = 0, maxSize = Infinity, cleanupInterval = 0 } = options;

    if (typeof defaultTtl !== 'number' || Number.isNaN(defaultTtl)) {
      throw new TypeError('defaultTtl must be a valid number');
    }
    if (defaultTtl < 0) {
      throw new RangeError('defaultTtl must be a non-negative number');
    }

    if (typeof maxSize !== 'number' || Number.isNaN(maxSize)) {
      throw new TypeError('maxSize must be a valid number');
    }
    if (maxSize <= 0) {
      throw new RangeError('maxSize must be a positive number greater than 0');
    }
    if (Number.isFinite(maxSize) && !Number.isInteger(maxSize)) {
      throw new TypeError('maxSize must be an integer or Infinity');
    }

    if (typeof cleanupInterval !== 'number' || Number.isNaN(cleanupInterval)) {
      throw new TypeError('cleanupInterval must be a valid number');
    }
    if (cleanupInterval < 0) {
      throw new RangeError('cleanupInterval must be a non-negative number');
    }

    this.#defaultTtl = defaultTtl;
    this.#maxSize = maxSize;

    if (cleanupInterval > 0) {
      this.#cleanupTimer = setInterval(() => {
        this.prune();
      }, cleanupInterval);
      // Ensure the timer does not keep the Node.js event loop active
      if (this.#cleanupTimer.unref) {
        this.#cleanupTimer.unref();
      }
    }
  }

  /**
   * Determines if a cache entry is expired at the given timestamp.
   * @private
   * @param {{ expiresAt: number|null }} entry
   * @param {number} [now=Date.now()]
   * @returns {boolean}
   */
  #isExpired(entry, now = Date.now()) {
    return entry.expiresAt !== null && now >= entry.expiresAt;
  }

  /**
   * Sets a value in the cache with an optional TTL.
   * Updates LRU access order. If capacity is exceeded, evicts the least recently used entry.
   *
   * @param {any} key The key to store (any valid JS value except undefined).
   * @param {any} value The value to store.
   * @param {number} [ttl] Optional TTL in milliseconds. Overrides defaultTtl.
   * @returns {this} The Cache instance for method chaining.
   * @throws {TypeError|RangeError} If key or ttl is invalid.
   */
  set(key, value, ttl) {
    if (key === undefined) {
      throw new TypeError('Cache key must not be undefined');
    }

    let effectiveExpiresAt = null;
    const now = Date.now();

    if (ttl !== undefined) {
      if (typeof ttl !== 'number' || Number.isNaN(ttl)) {
        throw new TypeError('TTL must be a valid number');
      }
      if (ttl < 0) {
        throw new RangeError('TTL must be a non-negative number');
      }
      if (ttl === Infinity) {
        effectiveExpiresAt = null;
      } else {
        effectiveExpiresAt = now + ttl;
      }
    } else if (this.#defaultTtl > 0) {
      effectiveExpiresAt = now + this.#defaultTtl;
    }

    // If key already exists, delete it first to maintain LRU position (re-insert at the end)
    if (this.#store.has(key)) {
      this.#store.delete(key);
    } else if (this.#store.size >= this.#maxSize) {
      // First attempt to prune any expired entries to free capacity
      let evictedExpired = false;
      for (const [existingKey, entry] of this.#store.entries()) {
        if (this.#isExpired(entry, now)) {
          this.#store.delete(existingKey);
          evictedExpired = true;
          break; // Freed at least one slot
        }
      }

      // If still at capacity, evict the least recently used entry (the first entry in Map)
      if (!evictedExpired && this.#store.size >= this.#maxSize) {
        const lruKey = this.#store.keys().next().value;
        this.#store.delete(lruKey);
        this.#stats.evictions++;
      }
    }

    this.#store.set(key, {
      value,
      expiresAt: effectiveExpiresAt
    });

    this.#stats.sets++;
    return this;
  }

  /**
   * Retrieves a value from the cache.
   * Updates LRU access order on a cache hit. Lazily evicts expired entries.
   *
   * @param {any} key The key to retrieve.
   * @returns {any} The cached value, or undefined if missing or expired.
   * @throws {TypeError} If key is undefined.
   */
  get(key) {
    if (key === undefined) {
      throw new TypeError('Cache key must not be undefined');
    }

    const entry = this.#store.get(key);
    if (!entry) {
      this.#stats.misses++;
      return undefined;
    }

    const now = Date.now();
    if (this.#isExpired(entry, now)) {
      this.#store.delete(key);
      this.#stats.misses++;
      return undefined;
    }

    // Refresh LRU position by re-inserting at the end of the Map
    this.#store.delete(key);
    this.#store.set(key, entry);

    this.#stats.hits++;
    return entry.value;
  }

  /**
   * Checks whether a non-expired entry exists for the given key.
   * Does NOT alter LRU order or increment hit/miss statistics.
   *
   * @param {any} key The key to check.
   * @returns {boolean} True if key exists and is not expired, false otherwise.
   * @throws {TypeError} If key is undefined.
   */
  has(key) {
    if (key === undefined) {
      throw new TypeError('Cache key must not be undefined');
    }

    const entry = this.#store.get(key);
    if (!entry) {
      return false;
    }

    if (this.#isExpired(entry)) {
      this.#store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Deletes a key from the cache.
   *
   * @param {any} key The key to delete.
   * @returns {boolean} True if the key was deleted, false if it did not exist.
   * @throws {TypeError} If key is undefined.
   */
  delete(key) {
    if (key === undefined) {
      throw new TypeError('Cache key must not be undefined');
    }
    return this.#store.delete(key);
  }

  /**
   * Clears all entries from the cache. Does not reset operational statistics.
   * @returns {void}
   */
  clear() {
    this.#store.clear();
  }

  /**
   * Returns the count of currently active, non-expired entries in the cache.
   * Automatically prunes expired entries to guarantee an accurate count.
   *
   * @returns {number} Active entry count.
   */
  size() {
    this.prune();
    return this.#store.size;
  }

  /**
   * Scans and removes all expired entries from the cache.
   *
   * @returns {number} The number of expired entries pruned.
   */
  prune() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, entry] of this.#store.entries()) {
      if (this.#isExpired(entry, now)) {
        this.#store.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  /**
   * Returns an array of all active (non-expired) keys in LRU order (least recently used first).
   *
   * @returns {any[]} Array of keys.
   */
  keys() {
    this.prune();
    return Array.from(this.#store.keys());
  }

  /**
   * Returns an array of all active (non-expired) values.
   *
   * @returns {any[]} Array of values.
   */
  values() {
    this.prune();
    return Array.from(this.#store.values()).map((entry) => entry.value);
  }

  /**
   * Returns an array of [key, value] pairs for all active entries.
   *
   * @returns {Array<[any, any]>} Array of key-value pairs.
   */
  entries() {
    this.prune();
    return Array.from(this.#store.entries()).map(([k, entry]) => [k, entry.value]);
  }

  /**
   * Retrieves operational statistics for the cache.
   *
   * @returns {CacheStats}
   */
  getStats() {
    const totalRequests = this.#stats.hits + this.#stats.misses;
    const hitRate = totalRequests === 0 ? 0 : Number((this.#stats.hits / totalRequests).toFixed(4));

    return {
      hits: this.#stats.hits,
      misses: this.#stats.misses,
      sets: this.#stats.sets,
      evictions: this.#stats.evictions,
      hitRate,
      size: this.#store.size
    };
  }

  /**
   * Resets hit, miss, set, and eviction counters to zero.
   * @returns {void}
   */
  resetStats() {
    this.#stats.hits = 0;
    this.#stats.misses = 0;
    this.#stats.sets = 0;
    this.#stats.evictions = 0;
  }

  /**
   * Stops any active cleanup timers and clears all cached data.
   * Useful when disposing of a cache instance in long-lived or test environments.
   * @returns {void}
   */
  destroy() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
    this.#store.clear();
  }
}

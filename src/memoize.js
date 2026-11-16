/**
 * @fileoverview High-performance asynchronous function memoization with TTL and request deduplication.
 */

import { Cache } from './cache.js';
import { Deduper, defaultKeyGenerator } from './dedupe.js';

/**
 * @typedef {Object} MemoizeOptions
 * @property {Cache} [cache] Existing Cache instance to use.
 * @property {number} [ttl] Time-to-live in milliseconds for cached results.
 * @property {number} [maxSize] Maximum capacity if creating an internal cache.
 * @property {(...args: any[]) => any} [keyGenerator] Custom function to generate cache keys from arguments.
 * @property {boolean} [dedupe=true] Whether to deduplicate concurrent in-flight executions for identical arguments.
 */

/**
 * Memoizes an asynchronous function with LRU caching, TTL expiration, and concurrent request deduplication.
 * Resolved values are cached; rejected promises are never cached.
 *
 * @template {(...args: any[]) => Promise<any>} T
 * @param {T} fn The asynchronous function to memoize.
 * @param {MemoizeOptions} [options={}] Configuration options.
 * @returns {T & { cache: Cache, clear: () => void, delete: (...args: Parameters<T>) => boolean, has: (...args: Parameters<T>) => boolean, getStats: () => import('./cache.js').CacheStats }}
 * @throws {TypeError} If fn is not a function or options are invalid.
 */
export function memoize(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('First argument must be a function to memoize');
  }
  if (options !== null && typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }

  const {
    cache: providedCache,
    ttl,
    maxSize,
    keyGenerator = defaultKeyGenerator,
    dedupe: dedupeEnabled = true
  } = options;

  if (providedCache !== undefined && !(providedCache instanceof Cache)) {
    throw new TypeError('Provided cache must be an instance of Cache');
  }
  if (typeof keyGenerator !== 'function') {
    throw new TypeError('keyGenerator must be a function');
  }

  const cache =
    providedCache ||
    new Cache({
      defaultTtl: ttl ?? 0,
      maxSize: maxSize ?? Infinity
    });

  const deduper = dedupeEnabled ? new Deduper() : null;

  const memoizedFn = async function (...args) {
    const key = keyGenerator(...args);

    if (cache.has(key)) {
      return cache.get(key);
    }

    if (deduper) {
      return deduper.execute(key, async () => {
        // Double check cache in case a previous concurrent execution just populated it
        if (cache.has(key)) {
          return cache.get(key);
        }

        const result = await fn.apply(this, args);
        cache.set(key, result, ttl);
        return result;
      });
    }

    const result = await fn.apply(this, args);
    cache.set(key, result, ttl);
    return result;
  };

  memoizedFn.cache = cache;
  memoizedFn.clear = () => cache.clear();
  memoizedFn.delete = (...args) => cache.delete(keyGenerator(...args));
  memoizedFn.has = (...args) => cache.has(keyGenerator(...args));
  memoizedFn.getStats = () => cache.getStats();

  return /** @type {any} */ (memoizedFn);
}

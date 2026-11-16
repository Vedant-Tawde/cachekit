/**
 * @fileoverview Reusable Express response caching middleware with configurable TTL, LRU eviction, and HTTP headers.
 */

import { Cache } from './cache.js';

/**
 * @typedef {Object} CacheMiddlewareOptions
 * @property {Cache} [cache] Existing Cache instance to store responses in.
 * @property {number} [ttl] Time-to-live in milliseconds for cached responses.
 * @property {number} [maxSize] Maximum cache size if creating an internal Cache.
 * @property {string[]} [methods=['GET']] HTTP methods eligible for caching.
 * @property {number[]} [statusCodes=[200]] HTTP response status codes eligible for caching.
 * @property {(req: any) => string} [keyGenerator] Function to produce cache key from request.
 * @property {boolean|string} [cacheControl] Cache-Control header strategy. If true and ttl is provided, generates max-age.
 * @property {string} [headerName='X-Cache'] Header name to indicate cache status ('HIT' or 'MISS').
 * @property {(req: any) => boolean} [condition] Optional predicate to bypass cache if returning false.
 */

/**
 * Creates an Express middleware for caching HTTP responses.
 *
 * @param {CacheMiddlewareOptions} [options={}]
 * @returns {((req: any, res: any, next: (err?: any) => void) => void) & { cache: Cache }}
 */
export function createCacheMiddleware(options = {}) {
  if (options !== null && typeof options !== 'object') {
    throw new TypeError('Options must be an object');
  }

  const {
    cache: providedCache,
    ttl,
    maxSize,
    methods = ['GET'],
    statusCodes = [200],
    keyGenerator = (req) => req.originalUrl || req.url,
    cacheControl,
    headerName = 'X-Cache',
    condition = () => true
  } = options;

  if (providedCache !== undefined && !(providedCache instanceof Cache)) {
    throw new TypeError('Provided cache must be an instance of Cache');
  }
  if (!Array.isArray(methods)) {
    throw new TypeError('methods must be an array of HTTP method strings');
  }
  if (!Array.isArray(statusCodes)) {
    throw new TypeError('statusCodes must be an array of HTTP status numbers');
  }
  if (typeof keyGenerator !== 'function') {
    throw new TypeError('keyGenerator must be a function');
  }
  if (typeof condition !== 'function') {
    throw new TypeError('condition must be a function');
  }

  const normalizedMethods = new Set(methods.map((m) => String(m).toUpperCase()));
  const cache =
    providedCache ||
    new Cache({
      defaultTtl: ttl ?? 0,
      maxSize: maxSize ?? Infinity
    });

  let cacheControlHeader = null;
  if (typeof cacheControl === 'string') {
    cacheControlHeader = cacheControl;
  } else if (cacheControl === true && typeof ttl === 'number' && ttl > 0) {
    const maxAgeSeconds = Math.max(0, Math.floor(ttl / 1000));
    cacheControlHeader = `public, max-age=${maxAgeSeconds}`;
  }

  const middleware = function cacheMiddleware(req, res, next) {
    // Only handle specified HTTP methods
    if (!normalizedMethods.has(req.method?.toUpperCase())) {
      return next();
    }

    // Check optional custom condition
    try {
      if (!condition(req)) {
        return next();
      }
    } catch (err) {
      return next(err);
    }

    const key = keyGenerator(req);
    const cached = cache.get(key);

    if (cached) {
      res.setHeader(headerName, 'HIT');
      if (cacheControlHeader) {
        res.setHeader('Cache-Control', cacheControlHeader);
      }
      if (cached.headers) {
        for (const [name, value] of Object.entries(cached.headers)) {
          if (value !== undefined) {
            res.setHeader(name, value);
          }
        }
      }
      res.status(cached.statusCode || 200);
      return res.send(cached.body);
    }

    // Cache Miss
    res.setHeader(headerName, 'MISS');
    if (cacheControlHeader) {
      res.setHeader('Cache-Control', cacheControlHeader);
    }

    // Intercept response methods to cache on completion
    const originalSend = res.send.bind(res);
    const originalJson = res.json.bind(res);
    const originalEnd = res.end.bind(res);

    let capturedBody = null;

    res.send = function (body) {
      capturedBody = body;
      return originalSend(body);
    };

    res.json = function (body) {
      capturedBody = body;
      return originalJson(body);
    };

    res.end = function (chunk, encoding, callback) {
      if (chunk && capturedBody === null) {
        capturedBody = chunk;
      }

      // Avoid caching unsuccessful responses
      if (statusCodes.includes(res.statusCode) && capturedBody !== null) {
        const contentType = res.getHeader('content-type');
        cache.set(
          key,
          {
            body: capturedBody,
            statusCode: res.statusCode,
            headers: contentType ? { 'content-type': contentType } : {}
          },
          ttl
        );
      }

      return originalEnd(chunk, encoding, callback);
    };

    return next();
  };

  middleware.cache = cache;
  return middleware;
}

// Alias for convenience
export const cacheMiddleware = createCacheMiddleware;

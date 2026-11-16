/**
 * @fileoverview Main entry point for cachekit - lightweight, in-memory caching engine.
 */

export { Cache } from './cache.js';
export { memoize } from './memoize.js';
export { dedupe, createDeduper, Deduper, defaultKeyGenerator } from './dedupe.js';
export { createCacheMiddleware, cacheMiddleware } from './middleware.js';

import { Cache } from './cache.js';
export default Cache;

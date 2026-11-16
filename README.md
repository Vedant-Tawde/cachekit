# cachekit

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A lightweight, zero-dependency, in-memory caching engine for Node.js applications. Engineered with Least Recently Used (LRU) eviction, millisecond-precision Time-To-Live (TTL) expiration, asynchronous function memoization, concurrent request deduplication, operational statistics, and Express response caching middleware.

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Architecture & Concepts](#core-architecture--concepts)
  - [LRU Eviction](#lru-eviction)
  - [TTL Expiration & Lazy Deletion](#ttl-expiration--lazy-deletion)
  - [Request Deduplication](#request-deduplication)
- [API Reference](#api-reference)
  - [`Cache`](#cache)
  - [`memoize(fn, options)`](#memoizefn-options)
  - [`dedupe(fn, options)` & `Deduper`](#dedupefn-options--deduper)
  - [`createCacheMiddleware(options)`](#createcachemiddlewareoptions)
- [Comprehensive Examples](#comprehensive-examples)
  - [LRU & TTL In Action](#lru--ttl-in-action)
  - [Memoizing Database Calls](#memoizing-database-calls)
  - [Preventing Cache Stampede with Deduplication](#preventing-cache-stampede-with-deduplication)
  - [Express API Response Caching](#express-api-response-caching)
- [Operational Metrics & Statistics](#operational-metrics--statistics)
- [Error Handling & Edge Cases](#error-handling--edge-cases)
- [Testing](#testing)
- [Known Limitations](#known-limitations)
- [License](#license)

---

## Overview

High-throughput Node.js microservices and web APIs frequently face performance bottlenecks caused by redundant computational tasks, database queries, and third-party API lookups. Unmitigated bursts of identical requests can trigger **cache stampedes** (dog-piling) and exhaust system resources.

`cachekit` addresses these challenges through a unified, modular architecture:
1. **Predictable Memory Footprint:** Enforces strict capacity limits with an \(O(1)\) LRU eviction algorithm.
2. **Freshness Control:** Automatically retires stale entries via lazy expiration and optional background cleanup.
3. **Thundering Herd Defense:** Collapses multiple concurrent in-flight requests for identical keys into a single shared Promise.
4. **Seamless Web Integration:** Out-of-the-box Express middleware with configurable headers and bypass conditions.
5. **Zero External Dependencies:** Built entirely with modern ECMAScript standards and native Node.js APIs.

---

## Key Features

- **High-Performance In-Memory Store:** Native `Map`-based storage guaranteeing \(O(1)\) access, updates, and evictions.
- **Configurable LRU Eviction:** Keeps the most active items in cache and evicts least recently accessed entries when `maxSize` is reached.
- **Millisecond TTL Expiration:** Supports individual entry TTLs as well as cache-wide default TTLs.
- **Zero Memory Leaks:** Employs lazy eviction upon lookup, manual `prune()`, and optional unreferenced background timers.
- **Async Function Memoization:** Wraps async functions to cache resolved results without permanently retaining rejected errors.
- **Concurrent Request Deduplication:** Prevents duplicate in-flight async operations by sharing pending promises across callers.
- **Operational Metrics:** Tracks hits, misses, sets, evictions, and calculates real-time hit rates.
- **Express Middleware:** Plug-and-play HTTP response caching with HTTP `Cache-Control` and `X-Cache` header management. Express is an optional peer dependency.
- **Fully Typed JSDoc:** Clean autocompletion and type checking for modern editors.

---

## Requirements

- **Node.js**: `>= 18.0.0`
- **Module System**: ES Modules (`import` / `export`)

---

## Installation

```bash
npm install @vedant-tawde/cachekit
```

*Note: If using Express middleware, ensure Express is installed in your application (`npm install express`).*

---

## Quick Start

```javascript
import { Cache } from '@vedant-tawde/cachekit';

// Initialize a cache that holds up to 100 items with a default 1-minute TTL
const cache = new Cache({ maxSize: 100, defaultTtl: 60000 });

// Store an entry
cache.set('session:user_123', { userId: 123, role: 'admin' });

// Retrieve the entry
const session = cache.get('session:user_123');
console.log(session); // { userId: 123, role: 'admin' }

// Inspect cache metrics
console.log(cache.getStats());
// Output: { hits: 1, misses: 0, sets: 1, evictions: 0, hitRate: 1, size: 1 }
```

---

## Core Architecture & Concepts

### LRU Eviction

`cachekit` utilizes JavaScript's native `Map` property, which preserves element insertion order:
- When an entry is read via `get(key)` or updated via `set(key, ...)`, it is re-inserted at the end of the `Map`, marking it as the **Most Recently Used (MRU)**.
- The earliest element in the `Map` iterator (`map.keys().next().value`) represents the **Least Recently Used (LRU)** entry.
- When `cache.size >= maxSize`, the LRU entry is automatically evicted in \(O(1)\) time complexity.
- Before evicting a valid LRU entry, `cachekit` attempts to reclaim space by evicting any expired entries first.

### TTL Expiration & Lazy Deletion

Entries can be assigned a time-to-live (`ttl`) in milliseconds:
- **Lazy Eviction:** Expired entries are not swept continuously by default, avoiding unnecessary CPU cycles. When an expired entry is accessed via `get()` or `has()`, it is lazily deleted and recorded as a miss.
- **Accurate Sizing:** Calling `cache.size()` or `cache.prune()` sweeps and removes expired entries, guaranteeing that expired records are never counted.
- **Immediate Expiration:** Specifying `ttl: 0` expires the entry immediately.
- **Permanent Entries:** Setting `ttl: Infinity` or omitting TTL when `defaultTtl: 0` ensures the entry remains until explicitly evicted by LRU or `delete()`.
- **Optional Background Sweeper:** An optional `cleanupInterval` can be configured in the constructor to periodically purge expired entries. The internal timer calls `unref()`, preventing it from blocking the Node.js event loop during shutdown.

### Request Deduplication

When multiple asynchronous requests query the same resource simultaneously (e.g., 50 incoming HTTP requests requesting product details for `product-99` before the first database query resolves):
- Standard caching causes all 50 callers to query the database concurrently (a **cache stampede**).
- `cachekit` intercepts concurrent calls using `dedupe()` or `memoize()`. The first caller initiates the asynchronous task; all subsequent identical callers join and await the **same pending Promise**.
- Once the Promise settles, the result is delivered to all callers simultaneously and the pending reference is cleaned up.
- If the operation rejects, all callers receive the rejection and the failure is **never cached**, allowing subsequent calls to retry immediately.

---

## API Reference

### `Cache`

```javascript
import { Cache } from 'cachekit';

const cache = new Cache(options);
```

#### Constructor Options: `new Cache(options)`

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `defaultTtl` | `number` | `0` | Default expiration in milliseconds (`0` = no expiration). |
| `maxSize` | `number` | `Infinity` | Maximum number of active items allowed in cache. |
| `cleanupInterval` | `number` | `0` | Periodic cleanup interval in milliseconds (`0` = disabled). |

#### Instance Methods

##### `set(key, value, ttl)`
Stores a key-value pair.
- `key` *(any)*: Unique identifier. Any JavaScript primitive or object (except `undefined`).
- `value` *(any)*: Value to store (primitives, objects, `null`, `undefined`).
- `ttl` *(number, optional)*: TTL in milliseconds. Overrides `defaultTtl`. Set `Infinity` to make persistent.
- **Returns**: `this` (enables chaining).

##### `get(key)`
Retrieves a cached value.
- Refreshes the entry's position to MRU.
- If expired, lazily deletes the entry and returns `undefined`.
- **Returns**: Cached value or `undefined`.

##### `has(key)`
Checks whether a key exists and has not expired.
- Does not modify LRU order or hit/miss statistics.
- **Returns**: `boolean`.

##### `delete(key)`
Removes the specified key from the cache.
- **Returns**: `boolean` (`true` if deleted, `false` if not found).

##### `clear()`
Purges all entries from the cache. Operational statistics remain intact.

##### `size()`
Prunes expired entries and returns the count of active entries.
- **Returns**: `number`.

##### `prune()`
Actively scans and removes all expired entries.
- **Returns**: `number` (count of pruned entries).

##### `keys()`, `values()`, `entries()`
Returns arrays of active (non-expired) keys, values, or `[key, value]` pairs in LRU order.

##### `getStats()`
Returns a snapshot of performance metrics:
```javascript
{
  hits: 15,       // Total cache hits
  misses: 3,      // Total cache misses
  sets: 18,       // Total set operations
  evictions: 2,   // Entries evicted due to maxSize
  hitRate: 0.8333,// hits / (hits + misses)
  size: 16        // Current active entries
}
```

##### `resetStats()`
Resets `hits`, `misses`, `sets`, and `evictions` counters to `0`.

##### `destroy()`
Clears all entries and stops any background cleanup intervals.

---

### `memoize(fn, options)`

Wraps an asynchronous function with caching and concurrent deduplication.

```javascript
import { memoize } from 'cachekit';

const memoizedFetch = memoize(asyncFunction, options);
```

#### Options:
- `cache` *(Cache, optional)*: Custom `Cache` instance.
- `ttl` *(number, optional)*: Expiration time in milliseconds for cached results.
- `maxSize` *(number, optional)*: Maximum size if an internal cache is created.
- `keyGenerator` *(Function, optional)*: `(...args) => any`. Default serializes arguments.
- `dedupe` *(boolean, optional, default: `true`)*: Whether concurrent calls share the in-flight promise.

#### Attached Properties:
- `memoizedFetch.cache`: The underlying `Cache` instance.
- `memoizedFetch.clear()`: Clears the cache.
- `memoizedFetch.delete(...args)`: Removes a specific entry by arguments.
- `memoizedFetch.has(...args)`: Checks whether a result is cached.
- `memoizedFetch.getStats()`: Returns cache statistics.

---

### `dedupe(fn, options)` & `Deduper`

Wraps an async function with request deduplication without permanent caching.

```javascript
import { dedupe, Deduper } from 'cachekit';

const dedupedTask = dedupe(async (query) => {
  return await fetchExternalService(query);
});
```

#### `Deduper` Class:
```javascript
const deduper = new Deduper();
const result = await deduper.execute('myKey', async () => {
  return await expensiveTask();
});
console.log(deduper.inFlightCount); // Number of active in-flight requests
```

---

### `createCacheMiddleware(options)`

Creates an Express-compatible route middleware to cache HTTP responses.

```javascript
import { createCacheMiddleware } from 'cachekit';

app.get('/api/users', createCacheMiddleware({ ttl: 30000 }), (req, res) => {
  res.json(users);
});
```

#### Options:

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `cache` | `Cache` | Internal | Cache instance to store responses. |
| `ttl` | `number` | `0` | TTL in milliseconds. |
| `methods` | `string[]` | `['GET']` | HTTP methods eligible for caching. |
| `statusCodes` | `number[]` | `[200]` | HTTP status codes eligible for caching. |
| `keyGenerator` | `Function` | `req => req.originalUrl \|\| req.url` | Custom key generator function. |
| `cacheControl` | `boolean \| string` | `undefined` | Sets HTTP `Cache-Control` header (e.g. `true` sets `public, max-age=N`). |
| `headerName` | `string` | `'X-Cache'` | Header indicating `'HIT'` or `'MISS'`. |
| `condition` | `Function` | `() => true` | Predicate `(req) => boolean`. Returns `false` to bypass caching. |

---

## Comprehensive Examples

### LRU & TTL In Action

```javascript
import { Cache } from 'cachekit';

const cache = new Cache({ maxSize: 3, defaultTtl: 5000 });

cache.set('a', 1);
cache.set('b', 2);
cache.set('c', 3);

// Access 'a' to mark it as most recently used
cache.get('a');

// Adding 4th entry evicts 'b' (the least recently used)
cache.set('d', 4);

console.log(cache.has('b')); // false (evicted)
console.log(cache.has('a')); // true (preserved)
```

### Memoizing Database Calls

```javascript
import { memoize } from 'cachekit';

const fetchUser = memoize(
  async (userId) => {
    const user = await database.users.findById(userId);
    return user;
  },
  { ttl: 60000, maxSize: 500 }
);

// First call executes the database query
const user1 = await fetchUser(42);

// Subsequent call within 60s returns cached result instantly
const user2 = await fetchUser(42);

// Invalidate when user updates profile
fetchUser.delete(42);
```

### Preventing Cache Stampede with Deduplication

```javascript
import { dedupe } from 'cachekit';

const fetchFinancialRates = dedupe(async (currencyPair) => {
  // Expensive external REST call
  return await http.get(`https://api.finance.com/rates/${currencyPair}`);
});

// 100 simultaneous requests invoke the external API exactly once
const requests = Array.from({ length: 100 }, () => fetchFinancialRates('USD/EUR'));
const results = await Promise.all(requests);
```

### Express API Response Caching

```javascript
import express from 'express';
import { createCacheMiddleware, Cache } from 'cachekit';

const app = express();
const sharedCache = new Cache({ maxSize: 1000 });

// Cache GET requests for 10 seconds, set Cache-Control header
const apiCache = createCacheMiddleware({
  cache: sharedCache,
  ttl: 10000,
  cacheControl: true,
  // Bypass cache if Authorization header is present
  condition: (req) => !req.headers.authorization
});

app.get('/api/catalog', apiCache, async (req, res) => {
  const catalog = await loadHeavyCatalog();
  res.json(catalog);
});

// Cache stats endpoint for monitoring
app.get('/admin/cache-stats', (req, res) => {
  res.json(sharedCache.getStats());
});

app.listen(3000);
```

---

## Operational Metrics & Statistics

Monitor cache health via `cache.getStats()`:

$$\text{Hit Rate} = \frac{\text{Hits}}{\text{Hits} + \text{Misses}}$$

- **`hits`**: Number of requests successfully resolved from cache.
- **`misses`**: Number of requests where key was missing or expired.
- **`sets`**: Total insertions and updates.
- **`evictions`**: Total items pruned due to `maxSize` capacity constraints.
- **`hitRate`**: Real-time hit ratio between `0.0` and `1.0`.
- **`size`**: Current active non-expired entries.

---

## Error Handling & Edge Cases

`cachekit` is built with defensive programming standards:
- **Null & Undefined Values:** Caching `null`, `0`, `false`, `""` (empty string) or `undefined` is fully supported. `cache.has(key)` correctly returns `true`.
- **Zero TTL:** Passing `ttl: 0` expires the entry immediately.
- **Prototype Pollution Defense:** Keys are stored inside a native JavaScript `Map`, preventing object prototype pollution vulnerabilities (`__proto__`, `toString`, `constructor`).
- **Promise Rejections:** `memoize()` and `dedupe()` never permanently cache rejected Promises. Errors propagate cleanly to callers, and the in-flight lock is released in a `finally` block to allow immediate retries.
- **Unhandled Rejections:** Deduplication handles shared internal promises safely to prevent Node.js unhandled promise rejection warnings.
- **Input Validation:** Throws descriptive `TypeError` or `RangeError` on invalid keys, negative TTLs, or non-functional arguments.

---

## Testing

The test suite is written using the Node.js built-in test runner (`node:test`) and strict assertions (`node:assert/strict`).

Run the automated tests:

```bash
npm test
```

Run individual test suites:

```bash
node --test test/cache.test.js
node --test test/memoize.test.js
node --test test/dedupe.test.js
node --test test/middleware.test.js
```

Run example scripts:

```bash
npm run example:basic
npm run example:express
```

---

## Known Limitations

1. **Process-Local Memory:** `cachekit` operates purely in-memory within a single Node.js process. It does not share state across multi-process clusters or server instances. For distributed multi-server caching, consider a distributed cache like Redis or Memcached.
2. **Key Reference Equality for Non-Primitives:** When using raw objects as keys in `cache.set(obj, val)`, lookup uses strict reference equality (`Map` semantics) unless converted to a string or wrapped with a custom `keyGenerator`.
3. **Serialization Overhead:** Default `memoize` argument serialization uses `JSON.stringify()`. For massive argument payloads or circular references, a custom `keyGenerator` function should be provided.

---

## License

MIT © 2026

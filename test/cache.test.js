import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Cache } from '../src/cache.js';

describe('Cache Class', () => {
  let cache;

  beforeEach(() => {
    cache = new Cache();
  });

  describe('Basic Operations', () => {
    test('should set and get values correctly', () => {
      cache.set('greeting', 'hello world');
      assert.strictEqual(cache.get('greeting'), 'hello world');
    });

    test('should correctly report existence with has()', () => {
      assert.strictEqual(cache.has('missing'), false);
      cache.set('exists', true);
      assert.strictEqual(cache.has('exists'), true);
    });

    test('should delete keys and return true when deleted, false when not found', () => {
      cache.set('temp', 123);
      assert.strictEqual(cache.delete('temp'), true);
      assert.strictEqual(cache.delete('temp'), false);
      assert.strictEqual(cache.get('temp'), undefined);
      assert.strictEqual(cache.has('temp'), false);
    });

    test('should clear all entries', () => {
      cache.set('a', 1);
      cache.set('b', 2);
      cache.clear();
      assert.strictEqual(cache.size(), 0);
      assert.strictEqual(cache.get('a'), undefined);
      assert.strictEqual(cache.get('b'), undefined);
    });

    test('should accurately report size()', () => {
      assert.strictEqual(cache.size(), 0);
      cache.set('a', 1);
      cache.set('b', 2);
      assert.strictEqual(cache.size(), 2);
      cache.set('a', 100); // update existing key
      assert.strictEqual(cache.size(), 2);
    });

    test('should return keys, values, and entries', () => {
      cache.set('x', 10);
      cache.set('y', 20);
      assert.deepStrictEqual(cache.keys(), ['x', 'y']);
      assert.deepStrictEqual(cache.values(), [10, 20]);
      assert.deepStrictEqual(cache.entries(), [
        ['x', 10],
        ['y', 20]
      ]);
    });
  });

  describe('TTL Expiration', () => {
    test('should expire entries after individual TTL', async () => {
      cache.set('shortLived', 'temp', 50);
      assert.strictEqual(cache.get('shortLived'), 'temp');

      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.strictEqual(cache.get('shortLived'), undefined);
      assert.strictEqual(cache.has('shortLived'), false);
    });

    test('should use defaultTtl configured in constructor', async () => {
      const ttlCache = new Cache({ defaultTtl: 50 });
      ttlCache.set('defaultKey', 'expiresSoon');

      assert.strictEqual(ttlCache.get('defaultKey'), 'expiresSoon');
      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.strictEqual(ttlCache.get('defaultKey'), undefined);
    });

    test('should allow individual TTL to override defaultTtl', async () => {
      const ttlCache = new Cache({ defaultTtl: 50 });
      // Override default with longer TTL
      ttlCache.set('longer', 'survives', 200);

      await new Promise((resolve) => setTimeout(resolve, 70));
      assert.strictEqual(ttlCache.get('longer'), 'survives');
    });

    test('should allow explicit Infinity or null to persist indefinitely even if defaultTtl is set', async () => {
      const ttlCache = new Cache({ defaultTtl: 40 });
      ttlCache.set('persistent', 'stays', Infinity);

      await new Promise((resolve) => setTimeout(resolve, 60));
      assert.strictEqual(ttlCache.get('persistent'), 'stays');
    });

    test('should lazily evict expired entries on get and has', async () => {
      cache.set('k', 'v', 30);
      await new Promise((resolve) => setTimeout(resolve, 45));

      assert.strictEqual(cache.has('k'), false);
      assert.strictEqual(cache.get('k'), undefined);
      assert.strictEqual(cache.size(), 0);
    });

    test('prune() should sweep all expired entries and return count', async () => {
      cache.set('k1', 'v1', 30);
      cache.set('k2', 'v2', 30);
      cache.set('k3', 'v3', 500);

      await new Promise((resolve) => setTimeout(resolve, 45));
      const pruned = cache.prune();
      assert.strictEqual(pruned, 2);
      assert.strictEqual(cache.size(), 1);
      assert.strictEqual(cache.get('k3'), 'v3');
    });

    test('zero TTL should expire immediately', () => {
      cache.set('zeroTtl', 'immediate', 0);
      assert.strictEqual(cache.get('zeroTtl'), undefined);
      assert.strictEqual(cache.has('zeroTtl'), false);
      assert.strictEqual(cache.size(), 0);
    });
  });

  describe('LRU Eviction', () => {
    test('should evict the least recently used item when maxSize is exceeded', () => {
      const lruCache = new Cache({ maxSize: 3 });
      lruCache.set('a', 1);
      lruCache.set('b', 2);
      lruCache.set('c', 3);

      assert.strictEqual(lruCache.size(), 3);

      // Adding 4th item evicts 'a'
      lruCache.set('d', 4);
      assert.strictEqual(lruCache.size(), 3);
      assert.strictEqual(lruCache.get('a'), undefined);
      assert.strictEqual(lruCache.get('b'), 2);
      assert.strictEqual(lruCache.get('c'), 3);
      assert.strictEqual(lruCache.get('d'), 4);
    });

    test('accessing an item with get() updates its LRU position', () => {
      const lruCache = new Cache({ maxSize: 3 });
      lruCache.set('a', 1);
      lruCache.set('b', 2);
      lruCache.set('c', 3);

      // Access 'a' to make it most recently used
      assert.strictEqual(lruCache.get('a'), 1);

      // Adding 'd' should now evict 'b' (the oldest unaccessed item)
      lruCache.set('d', 4);
      assert.strictEqual(lruCache.get('b'), undefined); // Evicted!
      assert.strictEqual(lruCache.get('a'), 1); // Preserved!
      assert.strictEqual(lruCache.get('c'), 3);
      assert.strictEqual(lruCache.get('d'), 4);
    });

    test('updating an existing key updates its LRU position without increasing size', () => {
      const lruCache = new Cache({ maxSize: 3 });
      lruCache.set('a', 1);
      lruCache.set('b', 2);
      lruCache.set('c', 3);

      // Update 'a'
      lruCache.set('a', 10);
      assert.strictEqual(lruCache.size(), 3);

      // Adding 'd' should now evict 'b'
      lruCache.set('d', 4);
      assert.strictEqual(lruCache.get('b'), undefined);
      assert.strictEqual(lruCache.get('a'), 10);
    });

    test('should evict expired entries first before evicting valid LRU entries', async () => {
      const lruCache = new Cache({ maxSize: 2 });
      lruCache.set('a', 1, 30); // Expiring soon
      lruCache.set('b', 2, 500); // Stays longer

      await new Promise((resolve) => setTimeout(resolve, 45));

      // 'a' is expired. Adding 'c' should evict 'a' and preserve 'b'
      lruCache.set('c', 3);
      assert.strictEqual(lruCache.get('a'), undefined);
      assert.strictEqual(lruCache.get('b'), 2);
      assert.strictEqual(lruCache.get('c'), 3);
    });
  });

  describe('Cache Statistics', () => {
    test('should accurately calculate hits, misses, sets, evictions and hitRate', () => {
      const statsCache = new Cache({ maxSize: 2 });

      assert.deepStrictEqual(statsCache.getStats(), {
        hits: 0,
        misses: 0,
        sets: 0,
        evictions: 0,
        hitRate: 0,
        size: 0
      });

      statsCache.set('a', 1); // sets = 1
      statsCache.set('b', 2); // sets = 2

      statsCache.get('a'); // hit = 1
      statsCache.get('b'); // hit = 2
      statsCache.get('missing'); // miss = 1

      let stats = statsCache.getStats();
      assert.strictEqual(stats.hits, 2);
      assert.strictEqual(stats.misses, 1);
      assert.strictEqual(stats.sets, 2);
      assert.strictEqual(stats.evictions, 0);
      // hitRate: 2 / 3 = 0.6667
      assert.strictEqual(stats.hitRate, 0.6667);

      // Cause an eviction
      statsCache.set('c', 3);
      stats = statsCache.getStats();
      assert.strictEqual(stats.evictions, 1);
      assert.strictEqual(stats.sets, 3);
    });

    test('resetStats() resets all metric counters', () => {
      cache.set('a', 1);
      cache.get('a');
      cache.get('missing');

      cache.resetStats();
      const stats = cache.getStats();
      assert.strictEqual(stats.hits, 0);
      assert.strictEqual(stats.misses, 0);
      assert.strictEqual(stats.sets, 0);
      assert.strictEqual(stats.evictions, 0);
      assert.strictEqual(stats.hitRate, 0);
      // Data remains intact
      assert.strictEqual(cache.size(), 1);
      assert.strictEqual(cache.get('a'), 1);
    });
  });

  describe('Edge Cases and Input Validation', () => {
    test('should properly store null and undefined values', () => {
      cache.set('nullKey', null);
      cache.set('undefinedKey', undefined);

      assert.strictEqual(cache.has('nullKey'), true);
      assert.strictEqual(cache.get('nullKey'), null);

      assert.strictEqual(cache.has('undefinedKey'), true);
      assert.strictEqual(cache.get('undefinedKey'), undefined);
    });

    test('should handle empty string keys and values', () => {
      cache.set('', '');
      assert.strictEqual(cache.has(''), true);
      assert.strictEqual(cache.get(''), '');
    });

    test('should support non-string keys: numbers, symbols, objects', () => {
      const objKey = { id: 1 };
      const symKey = Symbol('test');
      const numKey = 42;

      cache.set(objKey, 'objValue');
      cache.set(symKey, 'symValue');
      cache.set(numKey, 'numValue');

      assert.strictEqual(cache.get(objKey), 'objValue');
      assert.strictEqual(cache.get(symKey), 'symValue');
      assert.strictEqual(cache.get(numKey), 'numValue');
    });

    test('should throw TypeError when setting or getting undefined key', () => {
      assert.throws(() => cache.set(undefined, 'val'), TypeError);
      assert.throws(() => cache.get(undefined), TypeError);
      assert.throws(() => cache.has(undefined), TypeError);
      assert.throws(() => cache.delete(undefined), TypeError);
    });

    test('should throw RangeError or TypeError on invalid TTL', () => {
      assert.throws(() => cache.set('k', 'v', -10), RangeError);
      assert.throws(() => cache.set('k', 'v', NaN), TypeError);
      assert.throws(() => cache.set('k', 'v', '100'), TypeError);
    });

    test('should validate constructor options', () => {
      assert.throws(() => new Cache('not an object'), TypeError);
      assert.throws(() => new Cache({ defaultTtl: -5 }), RangeError);
      assert.throws(() => new Cache({ defaultTtl: 'fast' }), TypeError);
      assert.throws(() => new Cache({ defaultTtl: NaN }), TypeError);
      assert.throws(() => new Cache({ maxSize: 0 }), RangeError);
      assert.throws(() => new Cache({ maxSize: -1 }), RangeError);
      assert.throws(() => new Cache({ maxSize: 'huge' }), TypeError);
      assert.throws(() => new Cache({ maxSize: NaN }), TypeError);
      assert.throws(() => new Cache({ maxSize: 1.5 }), TypeError);
      assert.throws(() => new Cache({ cleanupInterval: -1 }), RangeError);
      assert.throws(() => new Cache({ cleanupInterval: 'invalid' }), TypeError);
      assert.throws(() => new Cache({ cleanupInterval: NaN }), TypeError);
    });

    test('cleanup timer can be stopped with destroy()', () => {
      const activeCache = new Cache({ cleanupInterval: 1000 });
      activeCache.set('a', 1);
      activeCache.destroy();
      assert.strictEqual(activeCache.size(), 0);
    });

    test('cleanup timer automatically sweeps expired entries periodically', async () => {
      const activeCache = new Cache({ cleanupInterval: 30 });
      activeCache.set('temp1', 'val1', 20);
      activeCache.set('temp2', 'val2', 20);
      activeCache.set('permanent', 'stays');

      // Wait for timer to tick and prune expired entries
      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.strictEqual(activeCache.has('temp1'), false);
      assert.strictEqual(activeCache.has('temp2'), false);
      assert.strictEqual(activeCache.has('permanent'), true);
      activeCache.destroy();
    });
  });
});

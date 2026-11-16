import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { memoize } from '../src/memoize.js';
import { Cache } from '../src/cache.js';

describe('Async Memoization', () => {
  test('should cache resolved results and avoid duplicate executions', async () => {
    let callCount = 0;
    const computeSquare = async (n) => {
      callCount++;
      return n * n;
    };

    const memoizedSquare = memoize(computeSquare);

    const res1 = await memoizedSquare(5);
    const res2 = await memoizedSquare(5);
    const res3 = await memoizedSquare(5);

    assert.strictEqual(callCount, 1);
    assert.strictEqual(res1, 25);
    assert.strictEqual(res2, 25);
    assert.strictEqual(res3, 25);

    // Different argument invokes underlying function
    const res4 = await memoizedSquare(6);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(res4, 36);
  });

  test('should respect TTL expiration and re-fetch after expiry', async () => {
    let count = 0;
    const fetchTime = async () => {
      count++;
      return { timestamp: Date.now(), count };
    };

    const memoized = memoize(fetchTime, { ttl: 50 });

    const first = await memoized();
    const second = await memoized();
    assert.strictEqual(count, 1);
    assert.strictEqual(first.count, second.count);

    // Wait for TTL to expire
    await new Promise((resolve) => setTimeout(resolve, 70));

    const third = await memoized();
    assert.strictEqual(count, 2);
    assert.strictEqual(third.count, 2);
  });

  test('should deduplicate concurrent requests for the same arguments', async () => {
    let networkCalls = 0;
    const slowApiCall = async (query) => {
      networkCalls++;
      await new Promise((resolve) => setTimeout(resolve, 40));
      return `Result for ${query}`;
    };

    const memoizedApi = memoize(slowApiCall);

    // Fire 5 identical requests concurrently
    const results = await Promise.all([
      memoizedApi('books'),
      memoizedApi('books'),
      memoizedApi('books'),
      memoizedApi('books'),
      memoizedApi('books')
    ]);

    assert.strictEqual(networkCalls, 1);
    results.forEach((res) => {
      assert.strictEqual(res, 'Result for books');
    });
  });

  test('should NOT permanently cache rejected promises', async () => {
    let attempts = 0;
    const unstableService = async (id) => {
      attempts++;
      if (attempts === 1) {
        throw new Error('Database connection failed');
      }
      return `data-${id}`;
    };

    const memoizedService = memoize(unstableService);

    // First attempt fails
    await assert.rejects(() => memoizedService(10), {
      message: 'Database connection failed'
    });
    assert.strictEqual(attempts, 1);

    // Ensure it was NOT cached
    assert.strictEqual(memoizedService.has(10), false);

    // Second attempt should run again and succeed
    const successResult = await memoizedService(10);
    assert.strictEqual(attempts, 2);
    assert.strictEqual(successResult, 'data-10');

    // Third call hits cache
    const cachedResult = await memoizedService(10);
    assert.strictEqual(attempts, 2);
    assert.strictEqual(cachedResult, 'data-10');
  });

  test('should support using an external Cache instance', async () => {
    const customCache = new Cache({ defaultTtl: 1000, maxSize: 5 });
    let runs = 0;

    const fn = memoize(
      async (x) => {
        runs++;
        return x * 2;
      },
      { cache: customCache }
    );

    await fn(10);
    assert.strictEqual(runs, 1);
    assert.strictEqual(customCache.get('10'), 20);
    assert.strictEqual(fn.cache, customCache);
  });

  test('should support custom keyGenerator', async () => {
    let executions = 0;
    const getUser = async (user) => {
      executions++;
      return user.name;
    };

    const memoized = memoize(getUser, {
      keyGenerator: (user) => user.id
    });

    const res1 = await memoized({ id: 1, name: 'Alice', age: 25 });
    const res2 = await memoized({ id: 1, name: 'Alice', age: 26 }); // age differs but id same

    assert.strictEqual(executions, 1);
    assert.strictEqual(res1, 'Alice');
    assert.strictEqual(res2, 'Alice');
  });

  test('should support cache deletion, clear, and stats lookup', async () => {
    const fn = memoize(async (n) => n + 1);

    await fn(5);
    assert.strictEqual(fn.has(5), true);

    const stats = fn.getStats();
    assert.strictEqual(stats.sets, 1);

    // Invalidate single item
    assert.strictEqual(fn.delete(5), true);
    assert.strictEqual(fn.has(5), false);

    await fn(10);
    await fn(20);
    assert.strictEqual(fn.cache.size(), 2);

    fn.clear();
    assert.strictEqual(fn.cache.size(), 0);
  });

  test('should validate input arguments and options', () => {
    assert.throws(() => memoize(null), TypeError);
    assert.throws(() => memoize(() => {}, 'invalid-options'), TypeError);
    assert.throws(() => memoize(() => {}, { cache: {} }), TypeError);
    assert.throws(() => memoize(() => {}, { keyGenerator: 'invalid' }), TypeError);
  });

  test('should support memoization with dedupe disabled', async () => {
    let callCount = 0;
    const task = async (val) => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return val * 10;
    };

    const memoized = memoize(task, { dedupe: false });

    // When dedupe: false, concurrent calls execute independently
    const [r1, r2] = await Promise.all([memoized(5), memoized(5)]);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(r1, 50);
    assert.strictEqual(r2, 50);

    // Subsequent call hits cache
    const r3 = await memoized(5);
    assert.strictEqual(callCount, 2);
    assert.strictEqual(r3, 50);
  });
});

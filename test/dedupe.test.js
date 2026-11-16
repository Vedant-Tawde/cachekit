import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, Deduper, createDeduper, defaultKeyGenerator } from '../src/dedupe.js';

describe('Request Deduplication', () => {
  describe('Deduper Class', () => {
    test('createDeduper() factory should return a Deduper instance', () => {
      const d = createDeduper();
      assert.ok(d instanceof Deduper);
    });

    test('should share pending promise among concurrent calls for the same key', async () => {
      const deduper = new Deduper();
      let executionCount = 0;

      const task = async () => {
        executionCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'success';
      };

      const [res1, res2, res3] = await Promise.all([
        deduper.execute('task1', task),
        deduper.execute('task1', task),
        deduper.execute('task1', task)
      ]);

      assert.strictEqual(executionCount, 1);
      assert.strictEqual(res1, 'success');
      assert.strictEqual(res2, 'success');
      assert.strictEqual(res3, 'success');
      assert.strictEqual(deduper.inFlightCount, 0);
    });

    test('should execute separate operations for different keys', async () => {
      const deduper = new Deduper();
      let count = 0;

      const task = async (val) => {
        count++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return val;
      };

      const [resA, resB] = await Promise.all([
        deduper.execute('keyA', () => task('A')),
        deduper.execute('keyB', () => task('B'))
      ]);

      assert.strictEqual(count, 2);
      assert.strictEqual(resA, 'A');
      assert.strictEqual(resB, 'B');
    });

    test('should clean up in-flight requests on rejection and allow retries', async () => {
      const deduper = new Deduper();
      let callCount = 0;

      const failingTask = async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (callCount === 1) {
          throw new Error('Network failure');
        }
        return 'recovered';
      };

      // Two concurrent calls failing
      const [res1, res2] = await Promise.allSettled([
        deduper.execute('retryKey', failingTask),
        deduper.execute('retryKey', failingTask)
      ]);

      assert.strictEqual(callCount, 1);
      assert.strictEqual(res1.status, 'rejected');
      assert.strictEqual(res2.status, 'rejected');
      assert.strictEqual(res1.reason.message, 'Network failure');
      assert.strictEqual(res2.reason.message, 'Network failure');
      assert.strictEqual(deduper.inFlightCount, 0);

      // Subsequent call should retry and succeed
      const retryResult = await deduper.execute('retryKey', failingTask);
      assert.strictEqual(callCount, 2);
      assert.strictEqual(retryResult, 'recovered');
    });

    test('should throw TypeError when key is undefined or fn is not a function', async () => {
      const deduper = new Deduper();
      await assert.rejects(() => deduper.execute(undefined, async () => {}), TypeError);
      await assert.rejects(() => deduper.execute('k', null), TypeError);
      assert.throws(() => deduper.isInFlight(undefined), TypeError);
    });

    test('clear() should empty in-flight map', () => {
      const deduper = new Deduper();
      deduper.execute('task', () => new Promise(() => {})); // pending forever
      assert.strictEqual(deduper.inFlightCount, 1);
      deduper.clear();
      assert.strictEqual(deduper.inFlightCount, 0);
    });
  });

  describe('dedupe() Function Wrapper', () => {
    test('should wrap an async function and deduplicate concurrent identical calls', async () => {
      let fetchCount = 0;
      const fetchUserData = async (userId) => {
        fetchCount++;
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { id: userId, name: `User ${userId}` };
      };

      const dedupedFetch = dedupe(fetchUserData);

      // Concurrent calls with identical argument
      const [u1, u2, u3] = await Promise.all([
        dedupedFetch('user-42'),
        dedupedFetch('user-42'),
        dedupedFetch('user-42')
      ]);

      assert.strictEqual(fetchCount, 1);
      assert.deepStrictEqual(u1, { id: 'user-42', name: 'User user-42' });
      assert.deepStrictEqual(u2, { id: 'user-42', name: 'User user-42' });
      assert.deepStrictEqual(u3, { id: 'user-42', name: 'User user-42' });

      // Sequential call after completion should run again
      const u4 = await dedupedFetch('user-42');
      assert.strictEqual(fetchCount, 2);
      assert.deepStrictEqual(u4, { id: 'user-42', name: 'User user-42' });
    });

    test('should expose inFlightCount and isInFlight()', async () => {
      const slowFn = dedupe(async (id) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return id;
      });

      assert.strictEqual(slowFn.inFlightCount, 0);
      assert.strictEqual(slowFn.isInFlight('item-1'), false);

      const promise = slowFn('item-1');
      assert.strictEqual(slowFn.inFlightCount, 1);
      assert.strictEqual(slowFn.isInFlight('item-1'), true);

      await promise;
      assert.strictEqual(slowFn.inFlightCount, 0);
      assert.strictEqual(slowFn.isInFlight('item-1'), false);
    });

    test('should support custom keyGenerator', async () => {
      let executions = 0;
      const query = async (filter) => {
        executions++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return filter.role;
      };

      // Generate key based only on role property
      const deduped = dedupe(query, {
        keyGenerator: (filter) => filter.role
      });

      const [r1, r2] = await Promise.all([
        deduped({ role: 'admin', page: 1 }),
        deduped({ role: 'admin', page: 2 })
      ]);

      assert.strictEqual(executions, 1);
      assert.strictEqual(r1, 'admin');
      assert.strictEqual(r2, 'admin');
    });

    test('should throw TypeError if argument is not a function', () => {
      assert.throws(() => dedupe('notAFunction'), TypeError);
      assert.throws(() => dedupe(() => {}, { keyGenerator: 'notAFunction' }), TypeError);
    });

    test('dedupedFn.clear() should clear active in-flight tracking', () => {
      const slow = dedupe(() => new Promise(() => {}));
      slow();
      assert.strictEqual(slow.inFlightCount, 1);
      slow.clear();
      assert.strictEqual(slow.inFlightCount, 0);
    });

    test('defaultKeyGenerator should handle empty args, primitives, and circular objects', () => {
      assert.strictEqual(defaultKeyGenerator(), '__empty__');
      assert.strictEqual(defaultKeyGenerator('test'), 'test');
      assert.strictEqual(defaultKeyGenerator(123), '123');

      // Circular structure fallback to String(args)
      const circular = {};
      circular.self = circular;
      const key = defaultKeyGenerator(circular);
      assert.ok(typeof key === 'string');
    });
  });
});

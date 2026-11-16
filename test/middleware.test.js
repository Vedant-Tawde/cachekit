import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCacheMiddleware } from '../src/middleware.js';

describe('Express Middleware Integration', () => {
  let app;
  let server;
  let baseUrl;
  let hitsCounter = 0;

  before(async () => {
    app = express();
    app.use(express.json());

    // Route 1: Standard cached route with 100ms TTL
    const cacheMw1 = createCacheMiddleware({
      ttl: 100,
      cacheControl: true
    });

    app.get('/api/data', cacheMw1, (req, res) => {
      hitsCounter++;
      res.json({ message: 'fresh data', count: hitsCounter });
    });

    // Route 2: Custom key and custom Cache-Control
    const cacheMw2 = createCacheMiddleware({
      ttl: 500,
      cacheControl: 'public, max-age=300, must-revalidate',
      keyGenerator: (req) => `${req.baseUrl || ''}${req.path}?tag=${req.query.tag || ''}`
    });

    let tagHits = 0;
    app.get('/api/tagged', cacheMw2, (req, res) => {
      tagHits++;
      res.json({ tag: req.query.tag, counter: tagHits });
    });

    // Route 3: Error route to verify failure caching is avoided
    let errorCalls = 0;
    const errorMw = createCacheMiddleware({ ttl: 500 });
    app.get('/api/error', errorMw, (req, res) => {
      errorCalls++;
      res.status(500).json({ error: 'Server Failure', call: errorCalls });
    });

    // Route 4: POST route to verify only GET is cached by default
    let postCalls = 0;
    const postMw = createCacheMiddleware();
    app.post('/api/action', postMw, (req, res) => {
      postCalls++;
      res.json({ status: 'created', call: postCalls });
    });

    // Route 5: Conditional cache bypass
    const conditionalMw = createCacheMiddleware({
      ttl: 500,
      condition: (req) => {
        if (req.headers['x-fail-condition']) {
          throw new Error('Condition failure');
        }
        return req.headers['x-bypass-cache'] !== 'true';
      }
    });
    let condCalls = 0;
    app.get('/api/conditional', conditionalMw, (req, res) => {
      condCalls++;
      res.json({ value: 'hello', call: condCalls });
    });

    // Route 6: Direct res.end chunk without res.send
    const endMw = createCacheMiddleware({ ttl: 500 });
    let endCalls = 0;
    app.get('/api/raw-end', endMw, (req, res) => {
      endCalls++;
      res.setHeader('Content-Type', 'text/plain');
      res.end(`raw payload ${endCalls}`);
    });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('should return MISS on first request and HIT on subsequent request', async () => {
    // 1st request -> MISS
    const res1 = await fetch(`${baseUrl}/api/data`);
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('x-cache'), 'MISS');
    assert.strictEqual(res1.headers.get('cache-control'), 'public, max-age=0');
    assert.strictEqual(data1.count, 1);

    // 2nd request -> HIT
    const res2 = await fetch(`${baseUrl}/api/data`);
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('x-cache'), 'HIT');
    assert.strictEqual(data2.count, 1); // Served from cache!
  });

  test('should expire cached response after TTL', async () => {
    // Wait for TTL (100ms) to elapse
    await new Promise((resolve) => setTimeout(resolve, 130));

    const res = await fetch(`${baseUrl}/api/data`);
    const data = await res.json();
    assert.strictEqual(res.headers.get('x-cache'), 'MISS');
    assert.strictEqual(data.count, 2); // Re-executed handler!
  });

  test('should support custom keyGenerator and custom Cache-Control header', async () => {
    const resA1 = await fetch(`${baseUrl}/api/tagged?tag=apple`);
    const dataA1 = await resA1.json();
    assert.strictEqual(resA1.headers.get('x-cache'), 'MISS');
    assert.strictEqual(resA1.headers.get('cache-control'), 'public, max-age=300, must-revalidate');
    assert.strictEqual(dataA1.tag, 'apple');

    const resB1 = await fetch(`${baseUrl}/api/tagged?tag=banana`);
    const dataB1 = await resB1.json();
    assert.strictEqual(resB1.headers.get('x-cache'), 'MISS');
    assert.strictEqual(dataB1.tag, 'banana');

    // Apple again should hit cache
    const resA2 = await fetch(`${baseUrl}/api/tagged?tag=apple`);
    const dataA2 = await resA2.json();
    assert.strictEqual(resA2.headers.get('x-cache'), 'HIT');
    assert.strictEqual(dataA2.counter, dataA1.counter);
  });

  test('should avoid caching unsuccessful responses (non-200 status codes)', async () => {
    const res1 = await fetch(`${baseUrl}/api/error`);
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 500);
    assert.strictEqual(data1.call, 1);

    // Second call should NOT be cached
    const res2 = await fetch(`${baseUrl}/api/error`);
    const data2 = await res2.json();
    assert.strictEqual(res2.status, 500);
    assert.strictEqual(data2.call, 2);
  });

  test('should not cache POST requests by default', async () => {
    const res1 = await fetch(`${baseUrl}/api/action`, { method: 'POST' });
    const data1 = await res1.json();
    assert.strictEqual(data1.call, 1);
    assert.strictEqual(res1.headers.get('x-cache'), null);

    const res2 = await fetch(`${baseUrl}/api/action`, { method: 'POST' });
    const data2 = await res2.json();
    assert.strictEqual(data2.call, 2);
    assert.strictEqual(res2.headers.get('x-cache'), null);
  });

  test('should bypass cache when condition returns false', async () => {
    const res1 = await fetch(`${baseUrl}/api/conditional`);
    assert.strictEqual(res1.headers.get('x-cache'), 'MISS');

    // With bypass header
    const res2 = await fetch(`${baseUrl}/api/conditional`, {
      headers: { 'x-bypass-cache': 'true' }
    });
    // Bypassed middleware, no X-Cache header
    assert.strictEqual(res2.headers.get('x-cache'), null);
  });

  test('should handle condition throwing an error by calling next(err)', async () => {
    const res = await fetch(`${baseUrl}/api/conditional`, {
      headers: { 'x-fail-condition': 'true' }
    });
    assert.strictEqual(res.status, 500);
  });

  test('should correctly cache responses generated via res.end(chunk)', async () => {
    const res1 = await fetch(`${baseUrl}/api/raw-end`);
    const text1 = await res1.text();
    assert.strictEqual(res1.headers.get('x-cache'), 'MISS');
    assert.strictEqual(text1, 'raw payload 1');

    const res2 = await fetch(`${baseUrl}/api/raw-end`);
    const text2 = await res2.text();
    assert.strictEqual(res2.headers.get('x-cache'), 'HIT');
    assert.strictEqual(text2, 'raw payload 1');
  });

  test('should validate middleware options', () => {
    assert.throws(() => createCacheMiddleware('invalid'), TypeError);
    assert.throws(() => createCacheMiddleware({ cache: {} }), TypeError);
    assert.throws(() => createCacheMiddleware({ methods: 'GET' }), TypeError);
    assert.throws(() => createCacheMiddleware({ statusCodes: 200 }), TypeError);
    assert.throws(() => createCacheMiddleware({ keyGenerator: 'invalid' }), TypeError);
    assert.throws(() => createCacheMiddleware({ condition: 'invalid' }), TypeError);
  });
});

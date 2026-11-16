/**
 * @fileoverview Express middleware example using cachekit.
 */

import express from 'express';
import { createCacheMiddleware, Cache } from '../src/index.js';

const app = express();
const port = 3000;

// Shared cache instance for inspection
const sharedCache = new Cache({ maxSize: 100 });

// Response caching middleware: 5-second TTL with automatic Cache-Control header
const responseCache = createCacheMiddleware({
  cache: sharedCache,
  ttl: 5000,
  cacheControl: true
});

let computedCount = 0;

// Heavy computational or database-backed endpoint
app.get('/api/analytics', responseCache, async (req, res) => {
  computedCount++;
  console.log(`[Server] Generating expensive analytics payload... (count=${computedCount})`);
  // Simulate delay
  await new Promise((r) => setTimeout(r, 100));

  res.json({
    report: 'Quarterly Sales',
    generatedAt: new Date().toISOString(),
    executionCount: computedCount
  });
});

// Endpoint to view live cache stats
app.get('/cache/stats', (req, res) => {
  res.json(sharedCache.getStats());
});

// If run directly via node, start the server and run a quick demo
if (process.argv[1]?.endsWith('express-example.js')) {
  const server = app.listen(port, async () => {
    console.log(`Express cachekit demo running at http://localhost:${port}`);
    console.log('\n--- Running Automated Demonstration ---');

    const baseUrl = `http://localhost:${port}`;

    // Request 1: Cache Miss
    const r1 = await fetch(`${baseUrl}/api/analytics`);
    const data1 = await r1.json();
    console.log('Request 1 X-Cache:', r1.headers.get('x-cache'), '| body:', data1);

    // Request 2: Cache Hit
    const r2 = await fetch(`${baseUrl}/api/analytics`);
    const data2 = await r2.json();
    console.log('Request 2 X-Cache:', r2.headers.get('x-cache'), '| body:', data2);

    // Stats
    const statsRes = await fetch(`${baseUrl}/cache/stats`);
    console.log('Current Cache Stats:', await statsRes.json());

    console.log('\nAutomated demonstration finished. Closing server.');
    server.close();
  });
}

export default app;

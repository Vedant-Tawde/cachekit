/**
 * @fileoverview Basic usage example for cachekit demonstrating Cache, memoize, and dedupe.
 */

import { Cache, memoize, dedupe } from '../src/index.js';

async function main() {
  console.log('=== 1. Basic In-Memory Caching & LRU Eviction ===');
  // Create cache with maxSize = 3 and default TTL of 1000ms
  const cache = new Cache({ maxSize: 3, defaultTtl: 1000 });

  cache.set('user:1', { name: 'Alice', role: 'admin' });
  cache.set('user:2', { name: 'Bob', role: 'editor' });
  cache.set('user:3', { name: 'Charlie', role: 'viewer' });

  console.log('Initial cache size:', cache.size()); // 3
  console.log('Get user:1:', cache.get('user:1')); // Alice (now user:1 is MRU)

  // Adding 4th item evicts the least recently used ('user:2')
  cache.set('user:4', { name: 'Diana', role: 'contributor' });
  console.log('Has user:2 (evicted)?:', cache.has('user:2')); // false
  console.log('Has user:1 (preserved)?:', cache.has('user:1')); // true

  console.log('Stats:', cache.getStats());

  console.log('\n=== 2. Asynchronous Function Memoization ===');
  let dbQueries = 0;
  const fetchProductFromDb = async (productId) => {
    dbQueries++;
    console.log(`  -> [DB Query] Fetching product #${productId} from simulated DB...`);
    await new Promise((r) => setTimeout(r, 100));
    return { id: productId, name: `Widget ${productId}`, price: 19.99 };
  };

  const getProduct = memoize(fetchProductFromDb, { ttl: 2000 });

  console.log('First call (cache miss):');
  const p1 = await getProduct(101);
  console.log('Result:', p1);

  console.log('Second call (cache hit):');
  const p2 = await getProduct(101);
  console.log('Result:', p2);
  console.log('Total database queries performed:', dbQueries); // 1

  console.log('\n=== 3. Concurrent Request Deduplication ===');
  let externalApiCalls = 0;
  const fetchExchangeRate = async (pair) => {
    externalApiCalls++;
    console.log(`  -> [External API] Calling financial service for ${pair}...`);
    await new Promise((r) => setTimeout(r, 150));
    return { pair, rate: 1.08, fetchedAt: new Date().toISOString() };
  };

  const getRateDeduped = dedupe(fetchExchangeRate);

  console.log('Dispatching 3 identical requests concurrently...');
  const [r1, r2, r3] = await Promise.all([
    getRateDeduped('EUR/USD'),
    getRateDeduped('EUR/USD'),
    getRateDeduped('EUR/USD')
  ]);

  console.log('Result r1:', r1);
  console.log('Result r2:', r2);
  console.log('Total external API calls made:', externalApiCalls); // 1

  cache.destroy();
}

main().catch(console.error);

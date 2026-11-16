/**
 * @fileoverview Concurrency request deduplication utility to avoid duplicate in-flight async operations.
 */

/**
 * Default serialization key generator for function arguments.
 * @param {...any} args
 * @returns {string}
 */
export function defaultKeyGenerator(...args) {
  if (args.length === 0) {
    return '__empty__';
  }
  if (args.length === 1 && (typeof args[0] === 'string' || typeof args[0] === 'number')) {
    return String(args[0]);
  }
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/**
 * Manages concurrent asynchronous executions by key, ensuring only one operation is active per key.
 */
export class Deduper {
  /** @type {Map<any, Promise<any>>} */
  #inFlight = new Map();

  /**
   * Executes an asynchronous task or attaches to an ongoing in-flight task with the same key.
   *
   * @template T
   * @param {any} key Unique identifier for the deduplicated task.
   * @param {() => Promise<T>|T} fn Task factory function.
   * @returns {Promise<T>} Result of the task.
   * @throws {TypeError} If key is undefined or fn is not a function.
   */
  async execute(key, fn) {
    if (key === undefined) {
      throw new TypeError('Deduplication key must not be undefined');
    }
    if (typeof fn !== 'function') {
      throw new TypeError('Task must be a function');
    }

    const existingPromise = this.#inFlight.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      try {
        return await fn();
      } finally {
        this.#inFlight.delete(key);
      }
    })();

    // Attach a no-op rejection handler to the internal reference to prevent
    // spurious Node.js unhandledRejection events before consumers attach their catch handlers.
    promise.catch(() => {});

    this.#inFlight.set(key, promise);
    return promise;
  }

  /**
   * Returns the count of currently in-flight deduplicated operations.
   * @type {number}
   */
  get inFlightCount() {
    return this.#inFlight.size;
  }

  /**
   * Checks if an operation with the given key is currently running.
   * @param {any} key
   * @returns {boolean}
   */
  isInFlight(key) {
    if (key === undefined) {
      throw new TypeError('Deduplication key must not be undefined');
    }
    return this.#inFlight.has(key);
  }

  /**
   * Clears all tracking references.
   * Note: Active background promises will still complete their execution.
   * @returns {void}
   */
  clear() {
    this.#inFlight.clear();
  }
}

/**
 * Creates a new Deduper instance.
 * @returns {Deduper}
 */
export function createDeduper() {
  return new Deduper();
}

/**
 * Wraps an asynchronous function with request deduplication.
 * Concurrent invocations with identical generated keys will share a single in-flight Promise.
 *
 * @template {(...args: any[]) => Promise<any>} T
 * @param {T} fn The async function to wrap.
 * @param {Object} [options={}]
 * @param {(...args: Parameters<T>) => any} [options.keyGenerator=defaultKeyGenerator]
 * @returns {T & { deduper: Deduper, inFlightCount: number, isInFlight: (key: any) => boolean, clear: () => void }}
 */
export function dedupe(fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('Expected first argument to be a function');
  }

  const { keyGenerator = defaultKeyGenerator } = options;
  if (typeof keyGenerator !== 'function') {
    throw new TypeError('keyGenerator must be a function');
  }

  const deduper = new Deduper();

  const dedupedFn = function (...args) {
    const key = keyGenerator(...args);
    return deduper.execute(key, () => fn.apply(this, args));
  };

  dedupedFn.deduper = deduper;
  Object.defineProperty(dedupedFn, 'inFlightCount', {
    get() {
      return deduper.inFlightCount;
    },
    enumerable: true
  });
  dedupedFn.isInFlight = (key) => deduper.isInFlight(key);
  dedupedFn.clear = () => deduper.clear();

  return /** @type {any} */ (dedupedFn);
}

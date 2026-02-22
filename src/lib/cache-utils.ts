/**
 * Generic cache factory — replaces copy-pasted CacheEntry patterns.
 * Usage: const cache = createCache<MyType>(50, 5 * 60 * 1000);
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
}

export interface Cache<T> {
  get(key: string): T | null;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): void;
  clear(): void;
  size(): number;
}

export function createCache<T>(maxSize: number, ttlMs: number): Cache<T> {
  const store = new Map<string, CacheEntry<T>>();

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.timestamp > ttlMs) {
        store.delete(key);
      }
    }
  }

  return {
    get(key: string): T | null {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.timestamp > ttlMs) {
        store.delete(key);
        return null;
      }
      // Promote to most-recently-used (true LRU): delete + re-insert
      store.delete(key);
      store.set(key, entry);
      return entry.value;
    },

    set(key: string, value: T): void {
      if (store.size >= maxSize) {
        // Evict expired first
        evictExpired();
        // If still at capacity, evict oldest
        if (store.size >= maxSize) {
          const oldest = store.keys().next().value;
          if (oldest !== undefined) store.delete(oldest);
        }
      }
      store.set(key, { value, timestamp: Date.now() });
    },

    has(key: string): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (Date.now() - entry.timestamp > ttlMs) {
        store.delete(key);
        return false;
      }
      return true;
    },

    delete(key: string): void {
      store.delete(key);
    },

    clear(): void {
      store.clear();
    },

    size(): number {
      evictExpired();
      return store.size;
    },
  };
}

/** Normalize a cache key: lowercase, trim, collapse whitespace, NFKC normalize */
export function normalizeCacheKey(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // strip zero-width chars
    .replace(/\s+/g, ' ');
}

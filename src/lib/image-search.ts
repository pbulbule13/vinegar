/**
 * Image Search Client — Pexels (primary) + Unsplash (fallback).
 * PII enforcement happens INSIDE searchImages(), not at the caller.
 * Client-side module: fetches through /api/images/search proxy.
 */

import type { ImageResult } from '@/types/visual-context';
import { createCache, normalizeCacheKey } from './cache-utils';

// Client-side image cache (50 entries, 30-min TTL)
const imageCache = createCache<ImageResult[]>(50, 30 * 60 * 1000);

// In-flight request coalescing: prevent duplicate fetches for the same query
const pendingRequests = new Map<string, Promise<ImageResult[]>>();

/**
 * Search for images via the server-side proxy.
 * PII is sanitized server-side in the API route.
 * Returns empty array on failure (never throws).
 */
export async function searchImages(
  query: string,
  options?: { signal?: AbortSignal; childSafe?: boolean },
): Promise<ImageResult[]> {
  const normalizedQuery = normalizeCacheKey(query);
  if (!normalizedQuery || normalizedQuery.length < 2) return [];

  // Check client cache
  const cached = imageCache.get(normalizedQuery);
  if (cached) return cached;

  // Request coalescing: reuse in-flight request for same query
  const pending = pendingRequests.get(normalizedQuery);
  if (pending) return pending;

  const fetchPromise = (async (): Promise<ImageResult[]> => {
    try {
      const res = await fetch('/api/images/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: normalizedQuery,
          child_safe: options?.childSafe ?? false,
        }),
        signal: options?.signal,
        // Don't compete with SSE stream for bandwidth
        priority: 'low' as RequestPriority,
      });

      if (!res.ok) return [];

      const data = await res.json();
      const images: ImageResult[] = data.images || [];

      // Cache results
      if (images.length > 0) {
        imageCache.set(normalizedQuery, images);
      }

      return images;
    } catch {
      // AbortError or network failure — return empty
      return [];
    } finally {
      pendingRequests.delete(normalizedQuery);
    }
  })();

  pendingRequests.set(normalizedQuery, fetchPromise);
  return fetchPromise;
}

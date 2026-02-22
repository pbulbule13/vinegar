/**
 * Server-side image search API.
 * Pexels (primary, 200 req/hr) + Unsplash (fallback, 50 req/hr).
 * API keys NEVER leave the server.
 */

import { imageSearchSchema } from '@/lib/validators';
import { sanitizeForExternal } from '@/lib/pii-redactor';
import { createCache, normalizeCacheKey } from '@/lib/cache-utils';
import type { ImageResult } from '@/types/visual-context';

// Server-side cache (100 entries, 30-min TTL)
const serverCache = createCache<ImageResult[]>(100, 30 * 60 * 1000);

// Rate limit tracking
let pexelsBlockedUntil = 0;

async function searchPexels(query: string, childSafe: boolean): Promise<ImageResult[]> {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) return [];
  if (Date.now() < pexelsBlockedUntil) return []; // Rate limited, skip

  try {
    const params = new URLSearchParams({
      query,
      per_page: '3',
      size: 'medium',
    });

    const res = await fetch(`https://api.pexels.com/v1/search?${params}`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(8000),
    });

    if (res.status === 429) {
      // Rate limited — block for 1 hour
      pexelsBlockedUntil = Date.now() + 60 * 60 * 1000;
      return [];
    }
    if (!res.ok) return [];

    const data = await res.json();
    const photos = data.photos as Array<{
      id: number;
      src: { medium: string; small: string };
      alt: string;
      photographer: string;
      photographer_url: string;
    }>;

    return photos.map(photo => ({
      url: photo.src.medium,
      thumbnail: photo.src.small,
      alt: photo.alt || query,
      credit: photo.photographer,
      creditUrl: photo.photographer_url,
    }));
  } catch {
    return [];
  }
}

async function searchUnsplash(query: string): Promise<ImageResult[]> {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];

  try {
    const params = new URLSearchParams({
      query,
      per_page: '3',
      w: '400',
      content_filter: 'high',
    });

    const res = await fetch(`https://api.unsplash.com/search/photos?${params}`, {
      headers: { Authorization: `Client-ID ${accessKey}` },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const results = data.results as Array<{
      id: string;
      urls: { regular: string; small: string; thumb: string };
      alt_description: string | null;
      user: { name: string; links: { html: string } };
    }>;

    return results.map(photo => ({
      url: `${photo.urls.small}&w=400&q=75&fm=webp`,
      thumbnail: photo.urls.thumb,
      alt: photo.alt_description || query,
      credit: photo.user.name,
      creditUrl: `${photo.user.links.html}?utm_source=vinegar&utm_medium=referral`,
    }));
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = imageSearchSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 });
    }

    const { query: rawQuery, child_safe } = parsed.data;

    // PII sanitization — enforced server-side
    const query = sanitizeForExternal(rawQuery);
    if (!query || query.trim().length < 2) {
      return Response.json({ images: [] }); // Query was entirely PII
    }

    // Check server cache
    const cacheKey = normalizeCacheKey(query);
    const cached = serverCache.get(cacheKey);
    if (cached) {
      return Response.json({ images: cached, source: 'cache' });
    }

    // Try Pexels first (200 req/hr), then Unsplash fallback (50 req/hr)
    let images = await searchPexels(query, child_safe);
    let source = 'pexels';

    if (images.length === 0) {
      images = await searchUnsplash(query);
      source = 'unsplash';
    }

    // Cache results
    if (images.length > 0) {
      serverCache.set(cacheKey, images);
    }

    return Response.json({ images, source });
  } catch {
    return Response.json({ error: 'Search failed' }, { status: 500 });
  }
}

/**
 * Deals Tools - Grocery Store Deal Search
 * Uses DuckDuckGo web search (free, no API key) to find deals.
 * Reuses the proven searchDuckDuckGo() from search-tools.ts.
 */

import { registerTool } from './tool-executor';
import { searchDuckDuckGo } from './search-tools';
import { getSetting } from './db';
import { sanitizeForExternal } from './pii-redactor';

const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours (deals don't change frequently)

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

const dealsCache = new Map<string, CacheEntry>();

function getCached(key: string): unknown | null {
  const entry = dealsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    dealsCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: unknown): void {
  if (dealsCache.size > 30) {
    const oldest = Array.from(dealsCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) dealsCache.delete(oldest[0]);
  }
  dealsCache.set(key, { data, timestamp: Date.now() });
}

// ─── check_deals ───

registerTool('check_deals', 'Check grocery store deals and offers. Use for "deals", "sale", "offer", or "what\'s on sale" requests.', async (args) => {
  const { store, item, zip_code } = args as { store?: string; item?: string; zip_code?: string };

  if (!store && !item) {
    return { success: false, error: 'Specify a store name, item name, or both. Example: store: "Safeway", item: "chicken"' };
  }

  const zip = (typeof zip_code === 'string' && zip_code.trim()) ? zip_code.trim() : (getSetting('home_zip') || '');

  // Build a targeted search query
  const queryParts: string[] = [];
  if (item) queryParts.push(item);
  if (store) queryParts.push(store);
  queryParts.push('deals sale weekly ad');
  if (zip) queryParts.push(zip);
  queryParts.push('2026');

  const cacheKey = `deals:${(store || '').toLowerCase()}:${(item || '').toLowerCase()}:${zip}`;
  const cached = getCached(cacheKey);
  if (cached) return { success: true, data: cached };

  // Strip PII before sending to external search (privacy) - only when cache misses
  const searchQuery = sanitizeForExternal(queryParts.join(' '));

  try {
    const results = await searchDuckDuckGo(searchQuery);

    if (results.length === 0) {
      // Try a simpler query
      const simpleQuery = sanitizeForExternal(`${item || ''} ${store || ''} deals this week`.trim());
      const retryResults = await searchDuckDuckGo(simpleQuery);
      if (retryResults.length === 0) {
        return {
          success: true,
          data: { store, item, results: [] },
          message: `No deals found for ${item ? `"${item}"` : 'items'}${store ? ` at ${store}` : ''}. Try checking the store's website directly or broadening your search.`,
        };
      }
      results.push(...retryResults);
    }

    const topResults = results.slice(0, 5).map(r => ({
      title: r.title,
      snippet: r.snippet,
      url: r.url,
    }));

    const result = {
      store: store || 'any',
      item: item || 'any',
      zip: zip || 'not specified',
      count: topResults.length,
      deals: topResults,
    };

    setCache(cacheKey, result);

    const summary = topResults.map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}`).join('\n');

    return {
      success: true,
      data: result,
      message: `Found ${topResults.length} deal results for ${item ? `"${item}"` : 'items'}${store ? ` at ${store}` : ''}:\n${summary}`,
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Deal search failed' };
  }
});

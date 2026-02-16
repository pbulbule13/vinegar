/**
 * Web Search Tool - DuckDuckGo Integration
 * Free web search with no API key required.
 * Uses DuckDuckGo Instant Answer API + HTML search fallback.
 * Privacy-first: DuckDuckGo doesn't track searches.
 */

import { registerTool } from './tool-executor';

const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESULTS = 5;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// ─── DuckDuckGo Instant Answer API (fast, structured) ───

async function queryInstantAnswer(query: string): Promise<{ abstract: string; source: string; url: string } | null> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;

    const data = await res.json();

    // Check for abstract (Wikipedia-style answer)
    if (data.Abstract) {
      return { abstract: data.Abstract, source: data.AbstractSource || 'DuckDuckGo', url: data.AbstractURL || '' };
    }

    // Check for answer (computation, facts)
    if (data.Answer) {
      return { abstract: data.Answer, source: 'DuckDuckGo', url: '' };
    }

    return null;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ─── DuckDuckGo HTML Search (full web results) ───

async function searchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Vinegar Home Assistant/1.0',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) return [];

    const html = await res.text();
    const results: SearchResult[] = [];

    // Parse search results from DuckDuckGo HTML
    // Results are in <div class="result"> blocks
    const resultBlocks = html.match(/<div class="links_main[\s\S]*?<\/div>\s*<\/div>/g) || [];

    for (const block of resultBlocks.slice(0, MAX_RESULTS)) {
      // Extract title and URL from <a class="result__a" href="...">title</a>
      const linkMatch = block.match(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/);
      // Extract snippet from <a class="result__snippet"...>snippet</a>
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);

      if (linkMatch) {
        const rawUrl = linkMatch[1];
        const title = linkMatch[2].replace(/<[^>]*>/g, '').trim();
        const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

        // DuckDuckGo wraps URLs in a redirect - extract actual URL
        let actualUrl = rawUrl;
        const uddgMatch = rawUrl.match(/uddg=([^&]*)/);
        if (uddgMatch) actualUrl = decodeURIComponent(uddgMatch[1]);

        if (title && actualUrl) {
          results.push({ title, url: actualUrl, snippet });
        }
      }
    }

    return results;
  } catch {
    clearTimeout(timeout);
    return [];
  }
}

// ─── Register web_search tool ───

registerTool('web_search', 'Search the web for information. Use for current events, facts, how-to questions, or anything not in memory.', async (args) => {
  const { query } = args as { query?: string };

  if (!query || typeof query !== 'string' || !query.trim()) {
    return { success: false, error: 'Search query required' };
  }

  const searchQuery = query.trim();

  // Try instant answer first (fast, structured)
  const instant = await queryInstantAnswer(searchQuery);

  // Also get web results for more context
  const webResults = await searchDuckDuckGo(searchQuery);

  if (!instant && webResults.length === 0) {
    return {
      success: false,
      error: 'No results found. Try rephrasing your search query.',
    };
  }

  const data: Record<string, unknown> = {};

  if (instant) {
    data.instant_answer = instant.abstract;
    data.source = instant.source;
    data.source_url = instant.url;
  }

  if (webResults.length > 0) {
    data.web_results = webResults;
  }

  // Build a human-readable summary
  let message = '';
  if (instant) {
    message = `${instant.abstract} (Source: ${instant.source})`;
  }
  if (webResults.length > 0) {
    const topResults = webResults.slice(0, 3).map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join('\n');
    message += message ? `\n\nWeb results:\n${topResults}` : `Web results:\n${topResults}`;
  }

  return { success: true, data, message };
});

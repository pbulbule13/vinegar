/**
 * Visual Context Detector — Two-tier detection system.
 * Tier 1: Client-side regex (instant, from shared topic-classifier patterns)
 * Tier 2: LLM [visual:] hint extraction (accurate, parsed from response)
 */

import type { VisualContext, CardType, ImageResult } from '@/types/visual-context';
import { toConfidence } from '@/types/visual-context';

// ── Tier 1: Instant keyword detection ──

interface DetectionPattern {
  cardType: CardType;
  pattern: RegExp;
  keywordExtractor: (match: RegExpMatchArray, message: string) => string;
  confidence: number;
}

const DETECTION_PATTERNS: DetectionPattern[] = [
  {
    cardType: 'weather',
    pattern: /\b(weather|temperature|rain|snow|sunny|cloudy|forecast|storm)\b/i,
    keywordExtractor: (_match, msg) => {
      // Try to extract location: "weather in X" or "weather for X"
      const locMatch = msg.match(/(?:weather|forecast|temperature)\s+(?:in|for|at)\s+(.+?)(?:\?|$)/i);
      return locMatch ? `weather ${locMatch[1].trim()}` : 'weather';
    },
    confidence: 0.7,
  },
  {
    cardType: 'place',
    pattern: /\b(restaurant|cafe|coffee|store|shop|nearby|near me|closest|find.*(?:place|spot)|directions|navigate)\b/i,
    keywordExtractor: (_match, msg) => {
      // Extract the place query: "find Italian restaurant" → "Italian restaurant"
      const placeMatch = msg.match(/(?:find|show|search|look for|where.*is|nearest|closest|nearby)\s+(.+?)(?:\?|$|\bnear\b|\bin\b)/i);
      return placeMatch ? placeMatch[1].trim() : msg.replace(/\b(find|show|search|can you|please|the|a|an)\b/gi, '').trim();
    },
    confidence: 0.7,
  },
  {
    cardType: 'recipe',
    pattern: /\b(recipe|cook|bake|ingredient|dish|cuisine|prepare|make.*food|how.*make|what.*cook)\b/i,
    keywordExtractor: (_match, msg) => {
      const recipeMatch = msg.match(/(?:recipe|cook|bake|make|prepare)\s+(?:for|of|some)?\s*(.+?)(?:\?|$)/i);
      return recipeMatch ? `${recipeMatch[1].trim()} food` : msg.replace(/\b(recipe|how|do|i|to|you|can|please|the|a)\b/gi, '').trim() + ' food';
    },
    confidence: 0.6,
  },
  {
    cardType: 'traffic',
    pattern: /\b(traffic|commute|drive|route|eta|how long.*get|travel time|congestion)\b/i,
    keywordExtractor: (_match, msg) => {
      const destMatch = msg.match(/(?:to|towards|from.*to)\s+(.+?)(?:\?|$)/i);
      return destMatch ? `road ${destMatch[1].trim()}` : 'traffic road';
    },
    confidence: 0.5,
  },
  {
    cardType: 'image-only',
    pattern: /\b(show me|what.*look like|picture of|photo of|image of|what is|what are)\b/i,
    keywordExtractor: (_match, msg) => {
      const showMatch = msg.match(/(?:show me|what does?|picture of|photo of|image of|what is|what are)\s+(.+?)(?:\s+look like)?(?:\?|$)/i);
      return showMatch ? showMatch[1].trim() : msg.replace(/\b(show|me|what|does|look|like|picture|photo|image|of|is|are|the|a|an)\b/gi, '').trim();
    },
    confidence: 0.8,
  },
];

/**
 * Tier 1: Detect visual context from user message using regex patterns.
 * Returns null if no visual topic detected.
 */
export function detectVisualContext(userMessage: string): { cardType: CardType; query: string; confidence: number; keywords: string[] } | null {
  const cleanedMsg = userMessage.trim();
  if (!cleanedMsg || cleanedMsg.length < 3) return null;

  for (const { cardType, pattern, keywordExtractor, confidence } of DETECTION_PATTERNS) {
    const match = cleanedMsg.match(pattern);
    if (match) {
      const query = keywordExtractor(match, cleanedMsg);
      if (!query || query.length < 2) continue;
      return {
        cardType,
        query,
        confidence: toConfidence(confidence),
        keywords: match.slice(1).filter(Boolean),
      };
    }
  }

  return null;
}

// ── Tier 2: LLM visual hint extraction ──

const VISUAL_HINT_REGEX = /\[visual:\s*(.+?)\]/i;

/**
 * Tier 2: Extract [visual: query] hint from LLM response.
 * Returns null if no hint found.
 */
export function extractVisualHint(llmResponse: string): string | null {
  // Strip tool_call blocks to avoid false positives
  const cleaned = llmResponse.replace(/```tool_call[\s\S]*?```/g, '');
  const match = cleaned.match(VISUAL_HINT_REGEX);
  return match ? match[1].trim() : null;
}

/**
 * Strip [visual: ...] hints from response before displaying to user.
 */
export function stripVisualHint(llmResponse: string): string {
  return llmResponse.replace(/\[visual:\s*.+?\]/gi, '').trim();
}

// ── Tool result → VisualContext builder ──

/**
 * Build a VisualContext from a tool result.
 * Maps tool data to the correct discriminated union variant.
 */
export function buildContextFromToolResult(
  toolName: string,
  result: { success: boolean; data?: unknown; message?: string },
  images: readonly ImageResult[] = [],
): VisualContext | null {
  if (!result.success || !result.data) return null;
  const data = result.data as Record<string, unknown>;

  switch (toolName) {
    case 'get_weather':
    case 'get_forecast': {
      const weather = data.weather as Record<string, unknown> | undefined ?? data;
      return {
        cardType: 'weather',
        query: `weather ${weather.location || ''}`,
        confidence: toConfidence(0.95),
        extractedKeywords: ['weather'],
        images,
        toolData: {
          temperature: Number(weather.temperature || weather.temp || 0),
          condition: String(weather.condition || weather.description || ''),
          humidity: Number(weather.humidity || 0),
          location: String(weather.location || weather.city || ''),
        },
      };
    }
    case 'find_nearby': {
      const places = (data.places as Array<Record<string, unknown>>) || [];
      const first = places[0];
      if (!first) return null;
      return {
        cardType: 'place',
        query: String(data.query || first.name || ''),
        confidence: toConfidence(0.9),
        extractedKeywords: ['nearby', 'place'],
        images,
        toolData: {
          name: String(first.name || ''),
          address: String(first.address || first.vicinity || ''),
          rating: first.rating ? Number(first.rating) : undefined,
        },
      };
    }
    case 'suggest_recipe': {
      return {
        cardType: 'recipe',
        query: String(data.name || data.recipe || 'recipe'),
        confidence: toConfidence(0.9),
        extractedKeywords: ['recipe'],
        images,
        toolData: {
          recipeName: String(data.name || data.recipe || ''),
          ingredients: Array.isArray(data.ingredients) ? data.ingredients.map(String) : [],
          prepTime: data.prep_time ? String(data.prep_time) : undefined,
        },
      };
    }
    case 'get_traffic': {
      return {
        cardType: 'traffic',
        query: `traffic ${data.route || ''}`,
        confidence: toConfidence(0.9),
        extractedKeywords: ['traffic'],
        images,
        toolData: {
          durationMinutes: Number(data.duration_minutes || data.duration || 0),
          distanceMiles: Number(data.distance_miles || data.distance || 0),
          route: String(data.route || data.summary || ''),
        },
      };
    }
    case 'web_search': {
      const webResults = (data.web_results as Array<{ title: string; url: string; snippet: string }>) || [];
      if (webResults.length === 0 && !data.instant_answer) return null;
      return {
        cardType: 'web-search',
        query: String(data.query || result.message?.slice(0, 50) || 'search'),
        confidence: toConfidence(0.95),
        extractedKeywords: [],
        images,
        toolData: {
          results: webResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
          instantAnswer: data.instant_answer ? String(data.instant_answer) : undefined,
          source: data.source ? String(data.source) : undefined,
          sourceUrl: data.source_url ? String(data.source_url) : undefined,
        },
      };
    }
    case 'show_visual': {
      const cardType = (data.card_type as string) || 'image-only';
      return {
        cardType: cardType as CardType,
        query: String(data.query || ''),
        confidence: toConfidence(0.95),
        extractedKeywords: [],
        images,
        toolData: undefined,
      } as VisualContext;
    }
    default:
      return null;
  }
}

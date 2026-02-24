/**
 * Visual Context Panel — Type System
 * Discriminated union keyed on cardType for type-safe card rendering.
 */

import type { ToolResult } from '@/lib/tool-executor';

// ── Base ──

interface VisualContextBase {
  readonly query: string;
  readonly confidence: number; // clamped [0,1]
  readonly extractedKeywords: readonly string[];
  readonly images: readonly ImageResult[];
}

// ── Card-specific types (discriminated on cardType) ──

interface WeatherVisualContext extends VisualContextBase {
  readonly cardType: 'weather';
  readonly toolData: { temperature: number; condition: string; humidity: number; location: string };
}

interface PlaceVisualContext extends VisualContextBase {
  readonly cardType: 'place';
  readonly toolData: { name: string; address: string; rating?: number };
}

interface RecipeVisualContext extends VisualContextBase {
  readonly cardType: 'recipe';
  readonly toolData: { recipeName: string; ingredients: readonly string[]; prepTime?: string };
}

interface TrafficVisualContext extends VisualContextBase {
  readonly cardType: 'traffic';
  readonly toolData: { durationMinutes: number; distanceMiles: number; route: string };
}

interface ImageOnlyVisualContext extends VisualContextBase {
  readonly cardType: 'image-only';
  readonly toolData?: undefined;
}

export interface WebSearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

interface WebSearchVisualContext extends VisualContextBase {
  readonly cardType: 'web-search';
  readonly toolData: { results: readonly WebSearchResult[]; instantAnswer?: string; source?: string; sourceUrl?: string };
}

export type VisualContext =
  | WeatherVisualContext
  | PlaceVisualContext
  | RecipeVisualContext
  | TrafficVisualContext
  | ImageOnlyVisualContext
  | WebSearchVisualContext;

export type CardType = VisualContext['cardType'];

// ── Image Result ──

export interface ImageResult {
  readonly url: string;
  readonly thumbnail: string;
  readonly alt: string;
  readonly credit?: string;
  readonly creditUrl?: string;
}

// ── Error Type ──

export type VisualContextErrorCode =
  | 'FETCH_FAILED'
  | 'IMAGE_SEARCH_FAILED'
  | 'DETECTION_TIMEOUT';

export interface VisualContextError {
  readonly code: VisualContextErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

// ── Tool Name Constraint ──

export type VisualToolName =
  | 'get_weather'
  | 'get_forecast'
  | 'find_nearby'
  | 'get_traffic'
  | 'suggest_recipe'
  | 'web_search'
  | 'show_visual';

// ── Hook Types ──

export interface UseVisualContextOptions {
  onContextChange?: (context: VisualContext | null) => void;
  onError?: (error: VisualContextError) => void;
  debounceMs?: number;
}

export interface UseVisualContextReturn {
  readonly context: VisualContext | null;
  readonly isLoading: boolean;
  readonly error: VisualContextError | null;
  readonly updateFromMessage: (userMsg: string) => void;
  readonly updateFromResponse: (aiResponse: string) => void;
  readonly updateFromToolResult: (toolName: VisualToolName, result: ToolResult) => void;
  readonly searchWeb: (query: string) => void;
  readonly clear: () => void;
}

// ── Helpers ──

export function toConfidence(value: number): number {
  return Math.max(0, Math.min(1, value));
}

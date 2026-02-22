---
title: Live Visual Context Panel
type: feat
date: 2026-02-22
deepened: 2026-02-22
---

## Enhancement Summary

**Deepened on:** 2026-02-22
**Agents used:** 13 (architecture-strategist, security-sentinel, performance-oracle, kieran-typescript-reviewer, julik-frontend-races-reviewer, code-simplicity-reviewer, pattern-recognition-specialist, agent-native-reviewer, best-practices-researcher, framework-docs-researcher, frontend-design, gap-analysis-learnings, security-learnings)

### Key Improvements from Research

1. **Agent-native parity** — Add `show_visual` tool so the LLM can explicitly trigger images/cards (0/10 capabilities were agent-accessible in original plan)
2. **Type-safe discriminated union** — Replace `toolData?: unknown` with narrowed types per card, enabling exhaustive switch/case rendering
3. **Two-tier detection** — Client-side regex (instant) + LLM `[visual:]` hints (accurate), covering both speed and nuance
4. **Security hardening** — SSRF-safe proxy (query-only, no URL param), child-safe content filtering, XSS-safe credit rendering
5. **Performance** — Append `w=400&q=75&fm=webp` to image URLs (5MB → 25KB), split page.tsx with React.memo boundaries, dual-layer cache
6. **Simplified cards** — Single `ContextCard` wrapper + per-type mapping functions instead of 6 separate component files
7. **Race condition prevention** — AbortController per conversation turn, request coalescing, rate-limit-aware API fallback
8. **Mobile UX** — Bottom sheet (60vh) instead of full overlay, preserving chat visibility
9. **Accessibility** — `<aside role="complementary">`, `aria-live="polite"` for updates, skip navigation, `prefers-reduced-motion`

### New Considerations Discovered
- Streaming route doesn't execute tools → rich cards only work in voice mode unless `show_visual` is added
- Voice path (`useBrowserVoice`) has no conduit for tool results to reach visual panel — needs `onToolResult` callback
- `page.tsx` is 747 lines with 12+ state variables — must extract components before adding visual panel
- Pexels has 4x higher free rate limit (200/hr) than Unsplash (50/hr) — consider as primary
- Tool-call JSON in streamed responses will false-positive the topic detector — must strip `tool_call` blocks

---

# Live Visual Context Panel

## Overview

Add a split-screen visual context panel to Vinegar that shows relevant images and info cards based on what the user is talking about. Chat stays on the left; a live visual panel on the right updates in real-time as topics are detected from both user messages and AI responses.

**Examples:**
- User mentions a restaurant → panel shows restaurant image + place info card (rating, address, hours)
- User asks about "clove" → panel shows a photo of clove + food info card
- User asks about weather → panel shows weather visualization card
- User discusses a recipe → panel shows food images + recipe card with ingredients
- User says "show me what turmeric looks like" → LLM invokes `show_visual` tool → panel shows turmeric image

## Problem Statement / Motivation

Vinegar is currently a text-only chat interface. When users discuss visual topics (food, places, recipes, weather), they have to imagine what's being described. A live visual panel transforms the assistant from a text chatbot into an immersive, context-aware experience — closer to how a human conversation partner would pull up photos on their phone to show you.

## Proposed Solution

### Architecture: Two-Tier Detection + Image API + Agent Tool

```
User Message ──┬──► /api/chat/stream (LLM) ──► Chat Panel (left)
               │         │
               │         ├──► LLM calls show_visual tool ──► Visual Panel (right)
               │         └──► [visual: query] hint in response ──►─┘
               │                                                    │
               └──► Tier 1: detectVisualContext() (instant regex) ──┘
```

**Two-tier detection approach:**
- **Tier 1 (instant, client-side):** Regex keyword matching on user message, same pattern as `buildMemoryContext()`. Shows images before the LLM responds.
- **Tier 2 (accurate, LLM-driven):** `show_visual` tool the LLM can invoke explicitly + `[visual: query]` hints in responses. Catches nuanced cases regex misses.

**Image source:** Pexels API (primary, 200 req/hr free) with Unsplash fallback (50 req/hr). PII-sanitized via `sanitizeForExternal()` enforced inside `searchImages()`.

### Layout

```
Desktop (lg+):
┌─────────────────────────────────────────────────────┐
│  Header (logo, wake word, [eye toggle], settings)   │
├──────────────────────────┬──────────────────────────┤
│   Chat Column (flex-1)   │  Visual Panel (w-80/w-96)│
│   max-w-2xl mx-auto      │  bg-charcoal/80          │
│                          │  backdrop-blur-xl         │
│   [Messages]             │  border-l border-steel    │
│                          │  sticky top-0 h-screen    │
│   [Input]                │                          │
├──────────────────────────┴──────────────────────────┤

Tablet (md-lg): Right-edge slide drawer (300ms cubic-bezier)
Mobile (<md):   Bottom sheet at 60vh with drag handle + peek state
```

- **Desktop (lg+):** Side-by-side. `w-80` (320px) on `lg`, `w-96` (384px) on `xl`. Chat remains `max-w-2xl` centered.
- **Tablet (md):** Panel as right-edge slide drawer with `cubic-bezier(0.32, 0.72, 0, 1)` easing (iOS sheet curve). Scrim backdrop on open.
- **Mobile (<md):** Bottom sheet at 60vh, NOT full overlay. Collapsed state shows 3.5rem strip with drag handle and amber "Context available" pulse. Chat remains visible above.

**Why bottom sheet over overlay:** Chat stays visible, thumb-accessible drag handle, progressive disclosure, "context available" peek indicator.

## Technical Approach

### Phase 0: Prerequisites (Before Phase 1)

These must be completed first. They are mechanical refactors that reduce risk for the main feature.

**P0-1: Extract components from `page.tsx`**

`page.tsx` is 747 lines with 12+ state variables and 6 hooks. Adding visual panel inline would push it past 900 lines. Extract:

```
src/app/page.tsx              — Layout shell, hook orchestration (<400 lines)
src/components/chat-column.tsx — Messages list, SSE streaming reader
src/components/input-area.tsx  — Text input, model picker, send button
src/components/header-bar.tsx  — Logo, wake word, notifications, speaker badge, panel toggle
```

Each component behind `React.memo()` to prevent cross-component re-renders. This is critical for performance: SSE streaming updates should only re-render `ChatColumn`, not the visual panel.

**P0-2: Extract shared `src/lib/topic-classifier.ts`**

Keyword patterns currently exist in `buildMemoryContext()` (llm-middleware.ts) and the streaming route's minimal version. The visual panel needs the same patterns. Extract once, import everywhere — prevents a 3rd copy.

**P0-3: Extract shared `src/lib/cache-utils.ts`**

The `CacheEntry` + `getCached()`/`setCache()` pattern is copy-pasted across 4 files (llm-middleware, weather-tools, location-tools, deals-tools). Extract a `createCache<T>(maxSize, ttlMs)` factory so image-search.ts doesn't become the 5th copy.

### Topic Detection Engine

**File:** `src/lib/visual-context-detector.ts`

Two-tier detection with pre-compiled regex (shared from `topic-classifier.ts`):

```typescript
// Tier 1: Instant client-side regex detection
function detectVisualContext(
  userMessage: string,
  recentToolResults?: ToolResult[]
): VisualContext | null;

// Tier 2: Extract LLM visual hint from response
function extractVisualHint(llmResponse: string): string | null;
function stripVisualHint(llmResponse: string): string;
```

**Detection runs at exactly 2 points** (not on every SSE chunk):
1. Immediately on user message submission
2. Once on AI response completion (when `[DONE]` event received)

**Must strip tool-call blocks** from streamed responses before regex matching to prevent false positives:
```typescript
const cleaned = text.replace(/```tool_call[\s\S]*?```/g, '');
```

### Type System (Discriminated Union)

**File:** `src/types/visual-context.ts`

```typescript
// ── Base ──
interface VisualContextBase {
  readonly query: string;
  readonly confidence: number; // clamped [0,1] via toConfidence()
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

export type VisualContext =
  | WeatherVisualContext | PlaceVisualContext | RecipeVisualContext
  | TrafficVisualContext | ImageOnlyVisualContext;

// ── Image Result ──
export interface ImageResult {
  readonly url: string;
  readonly thumbnail: string;
  readonly alt: string;
  readonly credit?: string;    // optional (not all sources require it)
  readonly creditUrl?: string;
}

// ── Error Type ──
export type VisualContextErrorCode =
  | 'FETCH_FAILED' | 'IMAGE_SEARCH_FAILED' | 'DETECTION_TIMEOUT';

export interface VisualContextError {
  readonly code: VisualContextErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

// ── Tool Name Constraint ──
export type VisualToolName =
  | 'get_weather' | 'get_forecast' | 'find_nearby'
  | 'get_traffic' | 'suggest_recipe' | 'web_search' | 'show_visual';

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
  readonly clear: () => void;
}
```

### Image Fetching

**File:** `src/lib/image-search.ts`

**API choice: Pexels primary (200 req/hr), Unsplash fallback (50 req/hr)**

Research found Pexels has 4x the free-tier rate limit and automatic production approval. Unsplash serves as fallback.

```typescript
// PII enforcement happens INSIDE searchImages, not at the caller
async function searchImages(rawQuery: string): Promise<ImageResult[]> {
  const query = sanitizeForExternal(rawQuery);
  if (!query?.trim()) return []; // entire query was PII
  // ... check caches, then fetch
}
```

**Image size optimization (CRITICAL):** Unsplash default images are 5-15MB. Always request small sizes:
- Pexels: use `src.medium` (350px wide) — ideal for sidebar
- Unsplash: append `&w=400&q=75&fm=webp` — reduces to ~25KB
- Fetch with `per_page=1` — single best result, not arrays
- Fetch with `priority: 'low'` — don't compete with SSE stream

**Rate-limit-aware fallback:**
```typescript
let pexelsBlocked = false;
let pexelsBlockedUntil = 0;
// When Pexels returns 429, set pexelsBlocked=true with hourly reset
// Subsequent queries go straight to Unsplash without 2-3s timeout
```

**Dual-layer caching:**
1. **Server-side** in `/api/images/search` (100 entries, 30-min TTL) — prevents redundant API calls across all clients
2. **Client-side** in `useVisualContext` (50 entries, 30-min TTL) — prevents redundant proxy fetches during topic switching

Cache keys: `query.toLowerCase().trim()` + NFKC Unicode normalization + strip zero-width characters.

### Image Search & Proxy Routes

**File:** `src/app/api/images/search/route.ts` — Server-side image search (holds API keys)

```typescript
// POST /api/images/search { query: string }
// - Validates with Zod schema
// - Runs sanitizeForExternal() on query
// - Checks server-side cache
// - Calls Pexels (primary) or Unsplash (fallback)
// - Returns ImageResult[]
// - API keys NEVER leave the server (no NEXT_PUBLIC_ prefix)
```

**File:** `src/app/api/images/proxy/route.ts` — Image proxy (SSRF-hardened)

```typescript
// GET /api/images/proxy?url=<encoded-url>
// Security (CRITICAL):
//   - Strict HTTPS-only hostname allowlist: images.pexels.com, images.unsplash.com
//   - No URL construction from user input — only proxy URLs returned by /search
//   - redirect: 'error' on fetch (prevent SSRF via redirects)
//   - Content-Type validation: must be image/*
//   - Max response size: 5MB
//   - No credentials/cookies forwarded
//   - X-Content-Type-Options: nosniff
// Caching:
//   - Cache-Control: public, max-age=86400, stale-while-revalidate=604800
// Child safety:
//   - Pexels content_filter=high when active speaker is child or unknown
```

Both routes get Zod validation schemas in `src/lib/validators.ts`. Both covered by existing auth middleware at `/api/*`.

### `show_visual` Tool (Agent-Native Parity)

**File:** `src/lib/tool-executor.ts` (modify)

Register a new tool so the LLM can explicitly trigger visuals:

```typescript
registerTool('show_visual',
  'Show an image or info card in the visual context panel',
  async (args) => {
    const { query, card_type } = args;
    const sanitized = sanitizeForExternal(query);
    const images = await searchImages(sanitized);
    return { success: true, data: { query: sanitized, card_type, images }, message: `Showing: ${query}` };
  }
);
```

**File:** `src/lib/vinegar-context.ts` (modify) — Add to system prompt:
```
VISUAL: You can show images and info cards in the side panel using show_visual({query, card_type}).
Use when user asks "show me", "what does X look like", or when a visual would enhance the response.
Card types: weather, place, recipe, traffic, image-only.
```

**File:** `src/lib/llm-middleware.ts` (modify) — Add `show_visual` to `getToolInstructions()`.

### Visual Context Panel Component

**File:** `src/components/context-panel/context-panel.tsx`

Wrapped in `ErrorBoundary` for resilience. Uses `<aside role="complementary" aria-label="Visual context">`.

**States:** Empty, Loading, Active, Error (3 states, not 5 — stale state removed per simplicity review)

**Card design system:** Each card gets a 2px left accent bar by type:
- Weather: `#38bdf8` (sky-400)
- Places: `#a78bfa` (violet-400)
- Recipe: `#F59E0B` (vinegar-gold)
- Traffic: `#fb923c` (orange-400)
- Generic: `#64748b` (slate-500)

**Shared card wrapper** (`context-card.tsx`) + per-type mapping functions (~5 lines each), NOT 6 separate component files. One `ContextCard` component with `title`, `fields: {label, value}[]`, and optional `hero: {icon, value}` prop.

**Image handling:**
- Aspect ratio: 16:10 desktop, 2:1 mobile
- Loading: amber-tinted skeleton shimmer (matching app's warm accent)
- Error: graceful hide (card without image is still useful)
- Credit: `text-[8px]` over `from-black/60` gradient with `text-shadow`
- Decode off-thread: `img.decode()` before DOM insertion (no jank)

**Animations:**
- Card entry: 200ms fade+slide, 60ms stagger per card
- Content swap: 200ms cross-fade keyed on context
- Panel arrival: 1.2s amber border flash (echoes orb's speaking glow)
- All transitions: `motion-safe:` prefix for `prefers-reduced-motion`

**Empty state:** Spinning dashed ring (reuses `ring-spin` keyframe) + example prompts ("What is the weather?", "Find cafes nearby", "Recipe for dal") that fill chat input on click.

### React Hook

**File:** `src/hooks/useVisualContext.ts`

```typescript
function useVisualContext(options?: UseVisualContextOptions): UseVisualContextReturn
```

Follows existing hook pattern: accepts `UseVisualContextOptions` with `onContextChange`, `onError`, `debounceMs` callbacks. Returns `UseVisualContextReturn` interface.

**Race condition prevention:**
- `AbortController` per image fetch, cancelled on new detection
- `conversationTurnRef` tracks current turn — stale turns ignored
- Request coalescing: pending requests tracked in a `Map<string, Promise>` to prevent cache stampede
- All debounce timers tracked via refs, cleared on unmount

**Integration with voice path:** Add `onToolResult` callback to `useBrowserVoice` options so voice-mode tool results reach the visual panel. Without this, voice conversations (the primary use case on Android) would never show rich cards.

**`useDeferredValue` for non-blocking updates:** Panel state updates wrapped in `useDeferredValue` so they never block chat input or SSE streaming.

### Data Flow (End-to-End)

```
1. User types: "What's a good Italian restaurant nearby?"

2. page.tsx → handleSendText()
   ├── Abort previous SSE stream (conversationTurnRef++)
   ├── fetch("/api/chat/stream", { signal }) → starts SSE stream
   └── visualContext.updateFromMessage("What's a good Italian restaurant nearby?")
       └── Tier 1: detectVisualContext() → { cardType: 'place', query: 'Italian restaurant' }
           └── POST /api/images/search { query: 'Italian restaurant' }
               └── Panel shows: restaurant image + loading card

3. SSE stream completes with [DONE]:
   └── Tier 2: extractVisualHint(fullResponse) → confirms/refines query
       └── Panel stays on restaurant display (no flicker)

4a. Voice path — LLM calls find_nearby tool:
    └── onToolResult('find_nearby', { places: [...] })
        └── Panel upgrades: image + PlaceCard with names, ratings

4b. Text path — LLM calls show_visual tool (if streaming tool exec added):
    └── show_visual result → updateFromToolResult('show_visual', result)
        └── Panel shows explicit LLM-chosen image

5. Visual panel state injected into next LLM context:
   └── [Visual Panel: place card for Italian restaurants near Fremont]
```

### Implementation Phases

#### Phase 1: Foundation — Layout + Detection + Images + Agent Tool

**Prerequisites (P0):**
- [x] Extract `ChatColumn`, `InputArea`, `HeaderBar` from `page.tsx` with `React.memo()`
- [x] Create `src/lib/topic-classifier.ts` — shared keyword patterns
- [x] Create `src/lib/cache-utils.ts` — `createCache<T>(maxSize, ttlMs)` factory

**Core tasks:**
- [x] Create `src/types/visual-context.ts` — discriminated union types
- [x] Create `src/lib/visual-context-detector.ts` — Tier 1 regex + Tier 2 `[visual:]` extraction
- [x] Create `src/lib/image-search.ts` — Pexels primary, Unsplash fallback, PII enforcement inside `searchImages()`
- [x] Create `src/app/api/images/search/route.ts` — server-side search with cache (Zod validated)
- [x] Create `src/app/api/images/proxy/route.ts` — SSRF-hardened proxy (domain allowlist, HTTPS-only, 5MB cap)
- [x] Add Zod schemas to `src/lib/validators.ts` — `imageSearchSchema`, `imageProxySchema`
- [x] Create `src/hooks/useVisualContext.ts` — hook with `UseVisualContextOptions`, AbortController, request coalescing
- [x] Create `src/components/context-panel/context-panel.tsx` — panel shell (empty/loading/active/error), wrapped in ErrorBoundary
- [x] Create `src/components/context-panel/context-card.tsx` — shared card wrapper with type-colored accent bar
- [x] Create `src/components/context-panel/context-image.tsx` — image with loading/error/credit states
- [x] Modify `src/app/page.tsx` — split-screen layout, hook integration, toggle button in header
- [x] Register `show_visual` tool in `src/lib/tool-executor.ts`
- [x] Update system prompt in `src/lib/vinegar-context.ts` — VISUAL section
- [x] Update `getToolInstructions()` in `src/lib/llm-middleware.ts` + `stream/route.ts`
- [ ] Add `.env.local` entries: `PEXELS_API_KEY`, `UNSPLASH_ACCESS_KEY`

**Acceptance criteria:**
- [ ] Desktop: chat left, visual panel right (no layout shift)
- [ ] Mobile: bottom sheet with peek indicator
- [ ] Typing "clove" shows a photo of clove
- [ ] LLM can invoke `show_visual` to display any image
- [ ] "hello" shows empty state with example prompts
- [ ] Image queries PII-sanitized (test with "find restaurant near John Smith's house on 123 Main St")
- [ ] Images load via proxy (no CSP violations, no SSRF possible)
- [ ] Panel transitions smooth, no chat jank during SSE streaming
- [ ] Child-safe content filter active when speaker is child/unknown
- [ ] Auth middleware covers `/api/images/*` routes

#### Phase 2: Rich Info Cards + Voice Integration

**Tasks:**
- [x] Add per-type card rendering in `context-card.tsx` (weather hero, place stars, recipe chips, traffic badge)
- [x] Add `onToolResult` callback to `useBrowserVoice` — voice path tool results reach visual panel
- [ ] Inject current visual panel state into `buildMemoryContext()` — `[Visual Panel: ...]`
- [x] Add tablet slide-out drawer (md breakpoint)
- [x] Add mobile bottom sheet with drag handle

**Acceptance criteria:**
- [ ] "What's the weather?" in voice mode → WeatherCard with real data + sky image
- [ ] "Find nearby restaurants" → PlaceCard with ratings + restaurant image
- [ ] LLM says "as you can see in the panel" when visuals are displayed
- [ ] Cards use design tokens (charcoal bg, type-colored accent bars, vinegar-gold highlights)
- [ ] Responsive at all breakpoints (320px to 1920px)

#### Phase 3: Polish + Android Testing

**Tasks:**
- [x] Add amber-tinted skeleton shimmer loading states
- [x] Add card entry animation (200ms fade+slide, 60ms stagger)
- [ ] Add panel arrival flash (1.2s amber border glow)
- [ ] Add noise texture overlay on panel background (1.5% opacity)
- [ ] Add data-driven ambient tint (2% opacity, 1000ms transition)
- [x] Add `prefers-reduced-motion` support via `motion-safe:` prefix
- [ ] Add skip navigation link for keyboard users
- [x] Add `aria-live="polite"` announcements for screen readers
- [ ] Test on Android APK via Capacitor WebView
- [x] Verify photographer credit/attribution displayed (API ToS)

## Alternative Approaches Considered

### Server-Side Context Extraction (Rejected)
Enhance the SSE protocol to emit `{"type":"context"}` events. **Rejected:** Adds latency, requires streaming route changes, client-side Tier 1 is instant.

### AI Image Generation (Rejected for MVP)
Use Gemini/DALL-E for on-the-fly images. **Rejected:** Slow (2-5s), costly, real photos are better for "what does X look like."

### Embedded Google Maps (Deferred)
Interactive maps for location queries. **Deferred:** Requires paid API key, large JS bundle. Static images via proxy sufficient.

### Unsplash as Primary API (Reconsidered)
Original plan used Unsplash primary (50 req/hr). **Changed to Pexels primary (200 req/hr)** based on research. 4x higher free tier, simpler attribution, automatic production approval. Unsplash retained as fallback.

### 6 Separate Card Components (Simplified)
Original plan had 6 files in `context-cards/`. **Simplified to 1 shared `ContextCard`** with per-type mapping functions (~5 lines each). The structural differences between cards (label:value pairs) don't justify separate files.

### `remotePatterns` Instead of Proxy (Rejected)
Simplicity review suggested `next/image` with `remotePatterns` to avoid the proxy. **Rejected:** CDN hostnames can change, API keys must stay server-side, proxy enables server-side caching and content filtering, SSRF protection is cleaner at the proxy layer.

## Acceptance Criteria

### Functional Requirements
- [ ] Visual panel appears on desktop (lg+) as right sidebar
- [ ] Panel shows relevant image when user discusses food, places, weather, recipes
- [ ] LLM can explicitly trigger visuals via `show_visual` tool
- [ ] Info cards show structured data when tool results are available
- [ ] Panel updates in real-time as conversation progresses
- [ ] PII is stripped from all image search queries (enforced in `searchImages()`)
- [ ] Empty/loading/error states handled gracefully
- [ ] Mobile: bottom sheet with peek indicator, not full overlay
- [ ] Child-safe content filtering when active speaker is child or unknown

### Non-Functional Requirements
- [ ] `detectVisualContext()` execution: < 1ms
- [ ] Image fetch to first paint: < 1.5s
- [ ] Image fetch on cache hit: < 5ms
- [ ] SSE token-to-render latency during image fetch: < 50ms P95
- [ ] Cumulative Layout Shift (CLS): 0
- [ ] Pexels API calls per hour: < 80 (40% of 200/hr quota)
- [ ] Client memory increase: < 5MB
- [ ] Works in Capacitor Android WebView

### Quality Gates
- [ ] All image queries PII-sanitized (test: name + address in message)
- [ ] CSP not weakened (images served via own proxy)
- [ ] No memory leaks (AbortControllers, timers, observers cleaned up on unmount)
- [ ] No SSRF possible (proxy rejects non-allowlisted hosts, private IPs, non-HTTPS)
- [ ] XSS-safe credit rendering (validate `https:` scheme on all URLs from API responses)
- [ ] Responsive at all breakpoints (320px to 1920px)
- [ ] WCAG AA contrast ratios on all informational text
- [ ] `prefers-reduced-motion` respected
- [ ] Pexels/Unsplash attribution displayed per API ToS

## Dependencies & Prerequisites

| Dependency | Type | Status | Notes |
|-----------|------|--------|-------|
| Pexels API key | External | Need to obtain | Free: 200 req/hr, register at pexels.com/api |
| Unsplash API key | External | Need to obtain | Free: 50 req/hr (fallback), register at unsplash.com/developers |
| `sanitizeForExternal()` | Internal | Exists | In `src/lib/pii-redactor.ts` — enforce inside `searchImages()` |
| `isUrlSafe()` | Internal | Exists | In `src/lib/tool-executor.ts` — reuse in image proxy |
| Streaming chat | Internal | Exists | `/api/chat/stream` — no changes needed |
| Tool executor | Internal | Exists | Add `show_visual` tool registration |
| `zustand` | Internal | Installed | Already in package.json — consider for unified message store |

## Risk Analysis & Mitigation

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **SSRF via image proxy** | CRITICAL | Medium | Strict hostname allowlist, HTTPS-only, `redirect: 'error'`, Content-Type validation, no private IPs |
| **PII leakage to image APIs** | CRITICAL | Medium | `sanitizeForExternal()` enforced inside `searchImages()`, not at caller. Enhanced to strip location clauses. |
| **Inappropriate content for minors** | HIGH | Low | Pexels `content_filter=high`, query blocklist, child-safe mode integration |
| **XSS via image metadata** | HIGH | Low | Validate `https:` scheme on credit URLs, strip HTML from text, `rel="noopener noreferrer"` |
| **Rate limit exhaustion** | HIGH | Medium | Dual-layer cache, rate-limit-aware fallback, daily budget tracking in `usage_logs` |
| **page.tsx complexity explosion** | HIGH | Certain | Extract components in Phase 0 before adding visual panel |
| **Panel re-renders block chat** | MEDIUM | Medium | `React.memo()` boundaries, `useDeferredValue`, `startTransition` |
| **Race conditions (rapid topics)** | MEDIUM | Medium | AbortController per turn, request coalescing, debounce |
| **Voice path missing tool results** | MEDIUM | Certain | Add `onToolResult` callback to `useBrowserVoice` |
| **Android WebView performance** | LOW | Low | Image size optimization (w=400), lazy loading, test on Capacitor |

## New Files

```
src/types/visual-context.ts                    — Discriminated union types
src/lib/topic-classifier.ts                    — Shared keyword patterns (extracted from buildMemoryContext)
src/lib/cache-utils.ts                         — createCache<T> factory (extracted from 4 duplicates)
src/lib/visual-context-detector.ts             — Tier 1 regex + Tier 2 [visual:] extraction
src/lib/image-search.ts                        — Pexels/Unsplash client with PII enforcement
src/app/api/images/search/route.ts             — Server-side image search (holds API keys)
src/app/api/images/proxy/route.ts              — SSRF-hardened image proxy
src/hooks/useVisualContext.ts                   — React hook with options/callbacks pattern
src/components/chat-column.tsx                  — Extracted from page.tsx (Phase 0)
src/components/input-area.tsx                   — Extracted from page.tsx (Phase 0)
src/components/header-bar.tsx                   — Extracted from page.tsx (Phase 0)
src/components/context-panel/
  ├── context-panel.tsx                         — Panel shell (layout, states, ErrorBoundary)
  ├── context-card.tsx                          — Shared card wrapper (accent bar, fields, hero)
  └── context-image.tsx                         — Image with loading/error/credit
```

## Modified Files

```
src/app/page.tsx              — Layout: single-column → split-screen + extract components
src/lib/tool-executor.ts      — Register show_visual tool
src/lib/vinegar-context.ts    — Add VISUAL section to system prompt
src/lib/llm-middleware.ts     — Add show_visual to getToolInstructions(), inject [Visual Panel] context
src/app/api/chat/stream/route.ts — Add show_visual to getToolInstructions()
src/hooks/useBrowserVoice.ts  — Add onToolResult callback for voice-path tool data
src/lib/validators.ts         — Add imageSearchSchema, imageProxySchema
next.config.js                — No CSP changes needed (proxy is same-origin)
.env.local                    — Add PEXELS_API_KEY, UNSPLASH_ACCESS_KEY
```

## References & Research

### Internal References
- Keyword detection: `src/lib/llm-middleware.ts:143-234` (`buildMemoryContext()` regex patterns)
- PII sanitization: `src/lib/pii-redactor.ts:145-161` (`sanitizeForExternal()`)
- SSRF protection: `src/lib/tool-executor.ts:84-97` (`isUrlSafe()`)
- Widget card pattern: `src/components/dashboard/calendar-widget.tsx:77`
- Tool result shapes: `src/lib/tool-executor.ts` (weather, nearby, recipe, traffic data)
- Streaming client: `src/app/page.tsx:309-393` (SSE reader pattern)
- Design tokens: `tailwind.config.ts` (charcoal, steel-dark, vinegar-gold)
- Language detection pattern: `src/lib/language-detector.ts` (client-side regex, same architecture)
- Existing cache pattern: `src/lib/llm-middleware.ts:27-68` (Map + getCached/setCache)

### External References
- [Pexels API Docs](https://www.pexels.com/api/documentation/) — 200 req/hr, medium image size for sidebar
- [Unsplash API Docs](https://unsplash.com/documentation) — 50 req/hr demo, `w=400&q=75&fm=webp` for sizing
- [Next.js Image Component](https://nextjs.org/docs/app/api-reference/components/image) — `remotePatterns`, custom loader
- [Next.js Route Handlers](https://nextjs.org/docs/app/getting-started/route-handlers) — binary response, streaming
- [React useDeferredValue](https://react.dev/reference/react/useDeferredValue) — non-blocking panel updates
- [WAI-ARIA Complementary Role](https://developer.mozilla.org/docs/Web/Accessibility/ARIA/Reference/Roles) — `<aside role="complementary">`

### Institutional Learnings Applied
- **Gap Analysis** (`docs/solutions/project-improvements/`): Dual-path divergence warning, streaming tool-call gap, SSRF fix with `isUrlSafe()`
- **Security Fixes** (`docs/solutions/security-issues/`): Structured URL parsing (not string matching), PII enforcement at function boundary, cache key normalization
- **V2 Review Findings**: Timer/ref cleanup discipline, debounce settings (2-3s), memory leak prevention patterns

### Known Constraints
- Streaming route doesn't execute tools — rich cards only via voice path or `show_visual` tool (text path)
- Android mic is exclusive — visual context fetch must not interfere with STT pipeline
- TTS duration estimation is heuristic — don't sync visual transitions to speech timing
- `useDeferredValue` `initialValue` parameter not available in React 18.2.0 (React 19 only)
- `remotePatterns` URL shorthand syntax not available in Next.js 14.1.0 (use object syntax)

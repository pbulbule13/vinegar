---
title: "feat: Add Location-Aware Features - Traffic, Nearby Places, Store Deals, Holidays"
type: feat
date: 2026-02-16
status: ready
consolidates:
  - 2026-02-15-real-world-skills-plan.md (Phases 2-5)
  - 2026-02-15-vinegar-capabilities-upgrade-brainstorm.md (Tier 2-3 features)
---

# feat: Add Location-Aware Features - Traffic, Nearby Places, Store Deals, Holidays

## Overview

Add the remaining real-world API integrations to Vinegar, bringing the tool count from 23 to **27 tools** and completing the planned feature set. These features make Vinegar a truly useful daily driver by answering: "How's traffic?", "Find restaurants near me", "Deals on chicken at Safeway?", and auto-populating US holidays.

## Problem Statement / Motivation

Vinegar's core household tools (calendar, grocery, tasks, etc.) are 100% complete but it still can't answer common real-world questions:
- **Traffic/Commute**: "How's my drive to work?" - No Google Maps integration
- **Nearby Places**: "South Indian food near me?" - No Google Places integration
- **Store Deals**: "Any deals on chicken at Safeway?" - No deal aggregator
- **Holidays**: Calendar has a `source='holiday'` field but zero holiday events populated
- **Location Settings**: No stored home/work/favorite locations to power location-aware features

## Proposed Solution

Add 4 new tools following the established pattern (see `weather-tools.ts`):
1. `get_traffic` - Google Maps Directions API (commute/ETA)
2. `find_nearby` - Google Maps Places API (restaurants, stores, etc.)
3. `check_deals` - DuckDuckGo web search for store deals (free, no API key)
4. Auto-populate US holidays into calendar_events table

Plus a **location settings** foundation and **PWA icon** fix.

## Technical Approach

### Architecture

All new tools follow the existing patterns:
- `registerTool()` in a new `src/lib/location-tools.ts` file
- API keys via env vars (GOOGLE_MAPS_API_KEY)
- 30-min caching with Map + TTL (same as weather-tools.ts)
- AbortController timeouts (8-10s)
- Registered in `src/lib/init.ts`
- Tool schemas added to `tool-executor.ts:getToolSchemas()`

```
┌─────────────────────────────────────────────────┐
│  src/lib/location-tools.ts (NEW)                │
│  ├── Location settings helpers                  │
│  ├── get_traffic tool (Google Directions API)   │
│  └── find_nearby tool (Google Places API)       │
├─────────────────────────────────────────────────┤
│  src/lib/deals-tools.ts (NEW)                   │
│  └── check_deals tool (DuckDuckGo search)       │
├─────────────────────────────────────────────────┤
│  src/lib/db.ts (MODIFY - migration v7)          │
│  └── Populate US 2026 holidays in calendar      │
├─────────────────────────────────────────────────┤
│  src/lib/init.ts (MODIFY)                       │
│  └── require('./location-tools')                │
│  └── require('./deals-tools')                   │
├─────────────────────────────────────────────────┤
│  src/lib/tool-executor.ts (MODIFY)              │
│  └── Add 4 new tool schemas to getToolSchemas() │
├─────────────────────────────────────────────────┤
│  src/lib/vinegar-context.ts (MODIFY)            │
│  └── Add TRAFFIC/NEARBY/DEALS instructions      │
├─────────────────────────────────────────────────┤
│  .env.example (MODIFY)                          │
│  └── Add GOOGLE_MAPS_API_KEY                    │
├─────────────────────────────────────────────────┤
│  public/icon-192.png, icon-512.png (NEW)        │
│  └── Generated PWA icons                        │
└─────────────────────────────────────────────────┘
```

### Implementation Phases

#### Phase 1: Location Settings Foundation

**Files:** `src/lib/db.ts` (migration v7)

Add default location settings to the settings table via a new migration:

```sql
-- Migration v7: Location settings + US Holidays
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_location', 'Fremont, CA'),
  ('work_location', ''),
  ('home_zip', ''),
  ('google_maps_api_key', ''),
  ('favorite_locations', '[]');

-- Populate 2026 US Federal Holidays into calendar_events
INSERT OR IGNORE INTO calendar_events (id, title, start_time, end_time, all_day, source)
VALUES
  ('hol-2026-presidents', "Presidents' Day", strftime('%s', '2026-02-16'), strftime('%s', '2026-02-17'), 1, 'holiday'),
  ('hol-2026-memorial', 'Memorial Day', strftime('%s', '2026-05-25'), strftime('%s', '2026-05-26'), 1, 'holiday'),
  ('hol-2026-independence', 'Independence Day', strftime('%s', '2026-07-04'), strftime('%s', '2026-07-05'), 1, 'holiday'),
  ('hol-2026-labor', 'Labor Day', strftime('%s', '2026-09-07'), strftime('%s', '2026-09-08'), 1, 'holiday'),
  ('hol-2026-columbus', 'Columbus Day', strftime('%s', '2026-10-12'), strftime('%s', '2026-10-13'), 1, 'holiday'),
  ('hol-2026-veterans', "Veterans Day", strftime('%s', '2026-11-11'), strftime('%s', '2026-11-12'), 1, 'holiday'),
  ('hol-2026-thanksgiving', 'Thanksgiving', strftime('%s', '2026-11-26'), strftime('%s', '2026-11-27'), 1, 'holiday'),
  ('hol-2026-christmas', 'Christmas Day', strftime('%s', '2026-12-25'), strftime('%s', '2026-12-26'), 1, 'holiday');
```

**Helper functions:**
```typescript
// src/lib/location-tools.ts
function getLocationSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return (row as { value: string })?.value || '';
}
```

- **Tasks:** Add migration, add helper functions
- **Success criteria:** `home_location` and holidays queryable from DB
- **Estimated effort:** 30 min

#### Phase 2: Traffic/Commute Tool (Google Maps Directions API)

**File:** `src/lib/location-tools.ts`

**API:** Google Maps Directions API
- **Free tier:** $200/month credit = ~40,000 free requests/month
- **Endpoint:** `https://maps.googleapis.com/maps/api/directions/json`
- **Parameters:** origin, destination, departure_time=now, traffic_model=best_guess

**Tool: `get_traffic`**
```typescript
registerTool('get_traffic', 'Check traffic and commute time to a destination', async (args) => {
  const { from, to } = args;
  // Default: home_location -> work_location from settings
  // Returns: duration, duration_in_traffic, distance, route summary, traffic status
});
```

**Features:**
- Default origin = home_location from settings
- Default destination = work_location from settings
- Returns: normal duration, traffic duration, delay, distance, route summary
- 15-min cache per origin-destination pair
- Graceful degradation: if no API key, return error message with setup instructions

**Handles:**
- "How's the traffic to work?" -> home -> work
- "How long to get to Safeway?" -> home -> Safeway
- "ETA to Lake Tahoe?" -> home -> Lake Tahoe

- **Tasks:** Implement get_traffic with cache, test with API key
- **Success criteria:** Returns ETA with traffic for home->work
- **Estimated effort:** 1 hr

#### Phase 3: Nearby Places Tool (Google Maps Places API)

**File:** `src/lib/location-tools.ts`

**API:** Google Maps Places API (Text Search)
- **Free tier:** Included in $200/month Maps credit
- **Endpoint:** `https://maps.googleapis.com/maps/api/place/textsearch/json`
- **Parameters:** query, location (lat,lng), radius (meters), type

**Tool: `find_nearby`**
```typescript
registerTool('find_nearby', 'Find restaurants, stores, or places nearby', async (args) => {
  const { query, type, radius_miles = 5 } = args;
  // Geocode home_location first (cache result), then search nearby
  // Returns: up to 5 results with name, address, rating, open_now, distance
});
```

**Geocoding approach:**
- First call: geocode home_location -> lat/lng (cache permanently in settings as `home_lat`, `home_lng`)
- Subsequent calls: use cached lat/lng
- Alternative `near` param: geocode any location on the fly (with cache)

**Features:**
- Types: restaurant, grocery_or_supermarket, gas_station, pharmacy, etc.
- Returns: name, address, rating, open status, price level
- Sorted by rating (default) or distance
- 30-min cache per query+location pair

**Handles:**
- "South Indian food near me" -> Places search: "South Indian restaurant"
- "Closest gas station" -> type=gas_station, sorted by distance
- "Best pizza places nearby" -> type=restaurant, query=pizza

- **Tasks:** Implement find_nearby with geocoding cache
- **Success criteria:** Returns rated list of nearby restaurants
- **Estimated effort:** 1.5 hrs

#### Phase 4: Store Deals Tool (DuckDuckGo Search)

**File:** `src/lib/deals-tools.ts`

**Approach: Web search (free, no API key needed)**

Rather than depending on the Flipp API (which is unofficial and may break), use DuckDuckGo web search to find deals - the same proven approach as `web_search` but with deal-specific queries.

**Tool: `check_deals`**
```typescript
registerTool('check_deals', 'Check grocery store deals and offers', async (args) => {
  const { store, item, zip_code } = args;
  // Constructs query: "{item} deals at {store} {zip_code} this week"
  // Uses DuckDuckGo HTML search (same as search-tools.ts)
  // Returns: top 5 results with title, snippet, url
});
```

**Features:**
- Default zip from `home_zip` setting
- Query construction: "{item} sale {store} {zip} weekly ad 2026"
- Reuses searchDuckDuckGo() from search-tools.ts (extract and export it)
- No API key needed
- 2-hour cache per store+item combination (deals don't change frequently)

**Handles:**
- "Any deals on chicken at Safeway?" -> search Safeway chicken deals
- "What's on sale at Costco?" -> search Costco weekly deals
- "Cheapest milk near me" -> search milk deals {zip}

- **Tasks:** Implement check_deals, export shared search function
- **Success criteria:** Returns relevant deal snippets for store+item
- **Estimated effort:** 45 min

#### Phase 5: Integration & Polish

**Files to modify:**

1. **`src/lib/init.ts`** - Add `require('./location-tools')` and `require('./deals-tools')`
2. **`src/lib/tool-executor.ts`** - Add 4 new tool schemas to `getToolSchemas()`
3. **`src/lib/vinegar-context.ts`** - Add instructions for new tools
4. **`.env.example`** - Add GOOGLE_MAPS_API_KEY, HOME_LOCATION, WORK_LOCATION
5. **`src/lib/briefing-tools.ts`** - Add traffic to morning briefing (if API key present)
6. **PWA Icons** - Generate and add `public/icon-192.png` and `public/icon-512.png`

**System prompt additions:**
```
TRAFFIC: Use get_traffic when asked about commute, traffic, or ETA. Defaults to home->work.
NEARBY: Use find_nearby for "near me", "closest", "best [place] nearby" requests.
DEALS: Use check_deals for "deals", "sale", "offer" at a store. Default zip from settings.
```

**Briefing enhancement:**
```typescript
// In get_briefing tool, after weather section:
if (getLocationSetting('google_maps_api_key')) {
  const traffic = await executeTool('get_traffic', {});
  if (traffic.success) sections.push(`Commute: ${traffic.message}`);
}
```

- **Tasks:** Wire everything together, test build
- **Success criteria:** `npm run build` passes, all 27 tools visible in schema
- **Estimated effort:** 1 hr

## Acceptance Criteria

### Functional Requirements

- [ ] Migration v7 runs on startup, populates location settings + 8 US holidays
- [ ] `get_traffic` returns ETA with traffic between two locations (or defaults to home->work)
- [ ] `find_nearby` returns up to 5 nearby places with name, address, rating
- [ ] `check_deals` returns deal snippets for a store+item combination
- [ ] Holidays appear in `get_calendar` results and morning briefing
- [ ] Morning briefing includes traffic when Google Maps API key is configured
- [ ] All tools work via text chat tool-calling protocol
- [ ] Tool schemas in `getToolSchemas()` for LLM awareness
- [ ] System prompt updated with new tool instructions

### Non-Functional Requirements

- [ ] All API calls have 8-10s AbortController timeout
- [ ] 15-30 min caching on API results (configurable per tool)
- [ ] Graceful degradation: tools return helpful error if API key missing
- [ ] No new npm dependencies needed (uses built-in fetch)
- [ ] `npm run build` passes with zero errors
- [ ] PWA icons present for installability

### Quality Gates

- [ ] Follows existing patterns (weather-tools.ts, search-tools.ts)
- [ ] No hardcoded API keys
- [ ] SSRF-safe: only Google APIs and DuckDuckGo called
- [ ] Error messages guide user to fix (e.g., "Add GOOGLE_MAPS_API_KEY to .env.local")

## Dependencies & Prerequisites

- **Google Maps API Key**: User must create at Google Cloud Console and add to `.env.local`
  - Enable: Directions API, Places API, Geocoding API
  - Free tier: $200/month credit (~40K requests)
- **No other prerequisites**: DuckDuckGo deals search needs no key

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| No Google Maps API key | HIGH | Graceful error: "Add GOOGLE_MAPS_API_KEY to .env.local" |
| Google API rate limits | LOW | 40K free requests/month, home use won't exceed |
| DuckDuckGo blocks deal searches | LOW | Fallback: use web_search tool directly |
| Holiday dates wrong | LOW | Double-check federal holiday calendar |
| Geocoding fails for home_location | MEDIUM | Allow direct lat/lng in settings |

## New Tools Summary

| # | Tool | Description | API | API Key Required |
|---|------|-------------|-----|-----------------|
| 24 | `get_traffic` | Commute time with real-time traffic | Google Directions | Yes |
| 25 | `find_nearby` | Find restaurants/stores/places | Google Places | Yes |
| 26 | `check_deals` | Grocery store deals & offers | DuckDuckGo | No |
| 27 | (holiday migration) | Auto-populate US holidays | None | No |

## Files Summary

### New Files (2)
```
src/lib/location-tools.ts    - get_traffic + find_nearby + location helpers
src/lib/deals-tools.ts       - check_deals (DuckDuckGo deal search)
public/icon-192.png           - PWA icon 192x192
public/icon-512.png           - PWA icon 512x512
```

### Modified Files (6)
```
src/lib/db.ts                 - Migration v7 (location settings + holidays)
src/lib/init.ts               - Register new tool modules
src/lib/tool-executor.ts      - Add 3 new tool schemas
src/lib/vinegar-context.ts    - Add new tool instructions
src/lib/briefing-tools.ts     - Add traffic to morning briefing
src/lib/search-tools.ts       - Export searchDuckDuckGo for reuse
.env.example                  - Add GOOGLE_MAPS_API_KEY vars
```

## References & Research

### Internal References
- Tool registration pattern: `src/lib/weather-tools.ts:76-117`
- Cache pattern: `src/lib/weather-tools.ts:9-45`
- Web search pattern: `src/lib/search-tools.ts:52-101`
- Init registration: `src/lib/init.ts:13-24`
- Schema registration: `src/lib/tool-executor.ts:516-849`
- DB migrations: `src/lib/db.ts:48+`

### External References
- Google Maps Directions API: https://developers.google.com/maps/documentation/directions
- Google Maps Places API: https://developers.google.com/maps/documentation/places/web-service
- Google Maps pricing: https://mapsplatform.google.com/pricing/
- DuckDuckGo API: https://api.duckduckgo.com/

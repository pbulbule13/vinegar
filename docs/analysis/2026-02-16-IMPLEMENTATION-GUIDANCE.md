# Implementation Guidance: Location-Traffic-Deals Tools
**For**: Developers implementing the feature
**Date**: 2026-02-16

---

## Critical Clarifications to Resolve

### 1. Location Settings Initialization

**Question**: How should users configure home/work locations?

**Option A: Safe Default (Recommended)**
```sql
-- Migration v7: Don't hardcode location, let user set it
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_location', ''),          -- Empty until user sets
  ('work_location', ''),
  ('home_zip', ''),
  ('favorite_locations', '[]');

-- When settings are empty, tools detect and return helpful error
```

**Option B: Hardcoded Default (Current Plan)**
```sql
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_location', 'Fremont, CA'),  -- ← BAD: wrong for other users
  ...
```

**Recommendation**: Use Option A + helpful error messages.

**Code Example**:
```typescript
// src/lib/location-tools.ts
function getLocationSetting(key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return (row as { value: string })?.value || '';
}

async function getHomeCoordinates(): Promise<{lat: number; lng: number}> {
  const homeLat = getLocationSetting('home_lat');
  const homeLng = getLocationSetting('home_lng');

  // Cache hit
  if (homeLat && homeLng) {
    return { lat: parseFloat(homeLat), lng: parseFloat(homeLng) };
  }

  // Cache miss - must geocode
  const homeLocation = getLocationSetting('home_location');
  if (!homeLocation) {
    throw new Error('Please configure your home_location in settings');
  }

  // Geocode and cache in settings table
  const {lat, lng} = await geocodeLocation(homeLocation);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('home_lat', String(lat));
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('home_lng', String(lng));

  return {lat, lng};
}
```

---

### 2. Geocoding Cache Persistence

**Question**: Where to cache geocoding results?

**Option A: Settings Table (Recommended)**
```typescript
// Save permanently
db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
  .run(`geo_${locationHash}`, JSON.stringify({lat, lng, timestamp: Date.now()}));

// Retrieve
const cached = db.prepare('SELECT value FROM settings WHERE key = ?')
  .get(`geo_${locationHash}`);
const {lat, lng, timestamp} = JSON.parse(cached.value);
if (Date.now() - timestamp < 30 * 24 * 60 * 60 * 1000) { // 30 days
  return {lat, lng};
}
```

**Option B: In-Memory Map (Current Pattern)**
```typescript
// Lost on server restart, but faster
const geocodeCache = new Map<string, {lat: number; lng: number; timestamp: number}>();
```

**Recommendation**: Use hybrid:
- In-memory cache for performance (30-min TTL)
- Settings table backup for persistence
- On startup, load frequently-used geocodes from settings into memory

**Code Example**:
```typescript
const geocodeCache = new Map<string, {lat: number; lng: number; timestamp: number}>();
const GEOCODE_TTL_MS = 30 * 60 * 1000; // 30 min in-memory
const GEOCODE_TTL_DAYS = 30; // Settings persistence

function getCachedGeocoding(location: string): {lat: number; lng: number} | null {
  // Check in-memory first
  const cached = geocodeCache.get(location.toLowerCase());
  if (cached && Date.now() - cached.timestamp < GEOCODE_TTL_MS) {
    return {lat: cached.lat, lng: cached.lng};
  }

  // Check settings table (persistent cache)
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?')
      .get(`geo_${hashLocation(location)}`) as {value: string} | undefined;
    if (!row) return null;

    const {lat, lng, timestamp} = JSON.parse(row.value);
    if (Date.now() - timestamp > GEOCODE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      return null; // Expired
    }

    // Repopulate in-memory cache
    geocodeCache.set(location.toLowerCase(), {lat, lng, timestamp: Date.now()});
    return {lat, lng};
  } catch {
    return null;
  }
}

function setGeocodingCache(location: string, lat: number, lng: number): void {
  // In-memory
  geocodeCache.set(location.toLowerCase(), {lat, lng, timestamp: Date.now()});

  // Persistent
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(
      `geo_${hashLocation(location)}`,
      JSON.stringify({lat, lng, timestamp: Date.now()})
    );
}

function hashLocation(location: string): string {
  return require('crypto').createHash('md5').update(location.toLowerCase()).digest('hex');
}
```

---

### 3. Google Maps API Error Handling

**Question**: How to handle all error cases?

**Code Pattern** (from weather-tools.ts, improved):
```typescript
async function googleMapsRequest(endpoint: string, params: Record<string, string>): Promise<unknown> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  // Missing key
  if (!apiKey) {
    throw new Error('Add GOOGLE_MAPS_API_KEY to .env.local. Get one at https://console.cloud.google.com');
  }

  const url = new URL(`https://maps.googleapis.com/maps/api/${endpoint}`);
  url.searchParams.set('key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url.toString(), {signal: controller.signal});
    clearTimeout(timeout);

    // Handle HTTP errors
    if (res.status === 403) {
      throw new Error('Invalid Google Maps API key. Check GOOGLE_MAPS_API_KEY in .env.local');
    }
    if (res.status === 429) {
      throw new Error('Google Maps rate limit exceeded. Try again in a few minutes.');
    }
    if (res.status === 400) {
      const data = await res.json().catch(() => ({}));
      throw new Error(`Invalid request: ${data.error_message || 'unknown'}`);
    }
    if (res.status >= 500) {
      throw new Error('Google Maps service temporarily unavailable. Try again in a few minutes.');
    }
    if (!res.ok) {
      throw new Error(`Google Maps error (${res.status})`);
    }

    const data = await res.json();

    // Check for API-level errors
    if (data.status && data.status !== 'OK') {
      if (data.status === 'ZERO_RESULTS') {
        throw new Error('Location not found. Try a different address.');
      }
      if (data.status === 'OVER_QUERY_LIMIT') {
        throw new Error('Daily quota exceeded. Try tomorrow.');
      }
      if (data.status === 'REQUEST_DENIED') {
        throw new Error('API key permissions issue. Check Google Cloud Console.');
      }
      throw new Error(`Google Maps error: ${data.status}`);
    }

    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Google Maps request timed out (8s). Check your network.');
    }
    throw err;
  }
}

// Usage in get_traffic
registerTool('get_traffic', '...', async (args) => {
  try {
    const from = (args.from as string) || getLocationSetting('home_location');
    const to = (args.to as string) || getLocationSetting('work_location');

    if (!from) return {success: false, error: 'Please set home_location in settings'};
    if (!to) return {success: false, error: 'Please set work_location in settings'};

    const data = await googleMapsRequest('directions/json', {
      origin: from,
      destination: to,
      departure_time: 'now',
      traffic_model: 'best_guess',
    });

    // Extract results
    return {success: true, data, message: '...'};
  } catch (err) {
    return {success: false, error: err instanceof Error ? err.message : 'Traffic lookup failed'};
  }
});
```

---

### 4. Tool Schemas in tool-executor.ts

**Add to getToolSchemas()** (around line 516):

```typescript
// Around line 516 in tool-executor.ts, add after existing weather schemas:

{
  name: 'get_traffic',
  description: 'Check traffic and commute time to a destination',
  input_schema: {
    type: 'object',
    properties: {
      from: {
        type: 'string',
        description: 'Origin address. Defaults to home_location from settings.',
      },
      to: {
        type: 'string',
        description: 'Destination address. Defaults to work_location from settings.',
      },
    },
    required: [], // Both optional (use defaults)
  },
},
{
  name: 'find_nearby',
  description: 'Find restaurants, stores, or places nearby',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (e.g., "pizza", "gas station")',
      },
      type: {
        type: 'string',
        enum: [
          'restaurant',
          'grocery_or_supermarket',
          'gas_station',
          'pharmacy',
          'cafe',
          'bar',
          'shopping_mall',
          'park',
          'hospital',
          'movie_theater',
          'gym',
        ],
        description: 'Type of place to search for. Optional; if omitted, uses query alone.',
      },
      radius_miles: {
        type: 'number',
        description: 'Search radius in miles (default: 5, range: 1-50)',
        minimum: 1,
        maximum: 50,
      },
      near: {
        type: 'string',
        description: 'Location to search near (e.g., "Union Square, SF"). Defaults to home_location.',
      },
    },
    required: ['query'], // query is required
  },
},
{
  name: 'check_deals',
  description: 'Check grocery store deals and offers',
  input_schema: {
    type: 'object',
    properties: {
      item: {
        type: 'string',
        description: 'Item to search for deals on (e.g., "chicken", "milk")',
      },
      store: {
        type: 'string',
        description: 'Store name (e.g., "Safeway", "Costco"). Required.',
      },
      zip_code: {
        type: 'string',
        description: 'ZIP code for local deals. Defaults to home_zip from settings.',
      },
    },
    required: ['item', 'store'], // item and store required
  },
},
```

---

### 5. Check Deals Implementation Strategy

**Current Approach (Fragile)**:
```typescript
const results = await searchDuckDuckGo(`${item} sale ${store} ${zip} weekly ad`);
```

**Issues**: HTML parsing breaks if DuckDuckGo changes; no validation that results are from requested store.

**Better Approach**:
```typescript
registerTool('check_deals', '...', async (args) => {
  const {item, store, zip_code} = args as {item?: string; store?: string; zip_code?: string};

  if (!item || !store) {
    return {success: false, error: 'Item and store are required'};
  }

  const zip = (zip_code as string) || getLocationSetting('home_zip');

  // Construct query with multiple fallback approaches
  const queries = [
    // Primary: store weekly ad
    `${store} weekly ad ${item} ${zip}`,
    // Secondary: generic deal search
    `${item} deals ${store} this week`,
    // Fallback: just web search
    `${item} sale ${store}`,
  ];

  for (const query of queries) {
    try {
      const results = await searchDuckDuckGo(query);
      if (results.length > 0) {
        return {
          success: true,
          data: {results, store, item},
          message: `Found ${results.length} results for ${item} at ${store}`,
        };
      }
    } catch {
      // Try next query
    }
  }

  // No results found - suggest store website
  return {
    success: false,
    error: `No deals found for ${item} at ${store}. Try visiting ${store}.com directly.`,
  };
});
```

**Alternative (More Robust)**:
If budget allows, consider:
- Flipp API (unofficial but better structured)
- Direct store website scraping (e.g., Safeway API, Costco deals page)
- Manual integration for top 5 stores (Safeway, Target, Costco, Walmart, Kroger)

---

### 6. Holiday Migration v7 - Complete List

**Recommended**:
```sql
-- Migration v7: Location settings + Complete US holidays
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('home_location', ''),
  ('work_location', ''),
  ('home_zip', ''),
  ('google_maps_api_key', ''),
  ('favorite_locations', '[]');

-- 2026 US Federal & Major Holidays
INSERT OR IGNORE INTO calendar_events (id, title, start_time, end_time, all_day, source) VALUES
  -- Federal Holidays (all-day)
  ('hol-2026-mlk', "MLK Jr. Day", strftime('%s', '2026-01-19'), strftime('%s', '2026-01-20'), 1, 'holiday'),
  ('hol-2026-presidents', "Presidents' Day", strftime('%s', '2026-02-16'), strftime('%s', '2026-02-17'), 1, 'holiday'),
  ('hol-2026-memorial', 'Memorial Day', strftime('%s', '2026-05-25'), strftime('%s', '2026-05-26'), 1, 'holiday'),
  ('hol-2026-independence', 'Independence Day', strftime('%s', '2026-07-04'), strftime('%s', '2026-07-05'), 1, 'holiday'),
  ('hol-2026-labor', 'Labor Day', strftime('%s', '2026-09-07'), strftime('%s', '2026-09-08'), 1, 'holiday'),
  ('hol-2026-columbus', 'Columbus Day', strftime('%s', '2026-10-12'), strftime('%s', '2026-10-13'), 1, 'holiday'),
  ('hol-2026-veterans', 'Veterans Day', strftime('%s', '2026-11-11'), strftime('%s', '2026-11-12'), 1, 'holiday'),
  ('hol-2026-thanksgiving', 'Thanksgiving', strftime('%s', '2026-11-26'), strftime('%s', '2026-11-27'), 1, 'holiday'),
  ('hol-2026-christmas', 'Christmas Day', strftime('%s', '2026-12-25'), strftime('%s', '2026-12-26'), 1, 'holiday'),
  -- Major Holidays (family-relevant)
  ('hol-2026-easter', 'Easter', strftime('%s', '2026-04-05'), strftime('%s', '2026-04-06'), 1, 'holiday'),
  ('hol-2026-mothers', "Mother's Day", strftime('%s', '2026-05-10'), strftime('%s', '2026-05-11'), 1, 'holiday'),
  ('hol-2026-fathers', "Father's Day", strftime('%s', '2026-06-21'), strftime('%s', '2026-06-22'), 1, 'holiday');
```

---

## Implementation Checklist

### Phase 1: Foundations
- [ ] Migration v7 in db.ts (settings + holidays)
- [ ] getLocationSetting() helper exported
- [ ] geocodeCache + getCachedGeocoding() + setGeocodingCache()
- [ ] googleMapsRequest() with error handling

### Phase 2: Core Tools
- [ ] location-tools.ts (get_traffic, find_nearby)
- [ ] deals-tools.ts (check_deals with fallback queries)
- [ ] Tool schemas in tool-executor.ts
- [ ] Tool registration in init.ts

### Phase 3: Integration
- [ ] System prompt additions (vinegar-context.ts)
- [ ] Briefing integration (briefing-tools.ts) with timeout
- [ ] .env.example updates
- [ ] searchDuckDuckGo() export from search-tools.ts

### Phase 4: Polish
- [ ] PWA icons (public/icon-192.png, public/icon-512.png)
- [ ] npm run build passes
- [ ] Test tool calls manually
- [ ] Error messages verified

---

## Testing Checklist

- [ ] get_traffic with no config → helpful error
- [ ] get_traffic home→work (configured) → ETA, traffic, distance
- [ ] find_nearby with nearby restaurant → name, address, rating
- [ ] find_nearby with invalid location → helpful error
- [ ] check_deals Safeway chicken → deal snippets
- [ ] check_deals invalid store → fallback suggestion
- [ ] Briefing includes traffic and holidays
- [ ] Tool schemas visible in LLM context
- [ ] All API errors have user-friendly messages
- [ ] No API key leaks in logs/errors
- [ ] Geocoding cache persists across restart (if settings-based)

---

## Files to Create/Modify

**New**:
- `/src/lib/location-tools.ts` (500 lines estimated)
- `/src/lib/deals-tools.ts` (200 lines estimated)
- `/public/icon-192.png` (asset)
- `/public/icon-512.png` (asset)

**Modify**:
- `/src/lib/db.ts` (+50 lines: migration v7)
- `/src/lib/init.ts` (+2 lines: require('./location-tools') and require('./deals-tools'))
- `/src/lib/tool-executor.ts` (+80 lines: 3 tool schemas)
- `/src/lib/vinegar-context.ts` (+5 lines: traffic/nearby/deals instructions)
- `/src/lib/briefing-tools.ts` (+15 lines: traffic integration)
- `/src/lib/search-tools.ts` (export searchDuckDuckGo function, ~2 lines)
- `/.env.example` (+3 lines: GOOGLE_MAPS_API_KEY comment)

---

## References

**Existing Patterns to Follow**:
- Caching: `src/lib/weather-tools.ts:9-45`
- Error Handling: `src/lib/weather-tools.ts:47-72`
- Tool Registration: `src/lib/weather-tools.ts:76-117`
- Web Search: `src/lib/search-tools.ts:52-101`
- Briefing Integration: `src/lib/briefing-tools.ts`
- Tool Schemas: `src/lib/tool-executor.ts:516-849`

---

## Estimated Timeline

| Task | Hours | Notes |
|------|-------|-------|
| Answer clarifications | 1-2 | Biggest time investment upfront |
| Implement location-tools.ts | 2 | Error handling is key |
| Implement deals-tools.ts | 1 | Simpler than location tools |
| Integrate (schemas, prompt, briefing) | 1.5 | Wiring everything together |
| Testing & bug fixes | 1.5 | Error cases, edge cases |
| **Total** | **7-8 hours** | **With clarifications** |

**Without clarifications**: 4-5 hours coding, but 3-5 hours rework/debugging later.

---

## Known Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Google API key leaked | Never log full key; rotate regularly; use separate key for dev/prod |
| Geocoding quota exhausted | Monitor API calls; cache aggressively; add alert at 80% quota |
| DuckDuckGo parsing breaks | Use multiple query fallbacks; detect parsing failures; suggest store website |
| Home location is PII | Don't expose in logs; encrypt at rest (v2); never send to untrusted services |
| Briefing timeout | Set hard timeout (3-5s); skip traffic if slow; don't block other briefing sections |
| User moves homes | Cache invalidation: clear geo_* settings when home_location changes |


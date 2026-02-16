# Vinegar - Real-World Skills & API Integration Plan

## Date: 2026-02-15
## Status: PLANNED

## Test Results: Current Capabilities vs Real-World Scenarios

| Scenario | Works? | Tool Used | What's Missing |
|----------|--------|-----------|---------------|
| Add grocery items when something runs out | YES | manage_grocery (x2) | Nothing - fully working |
| Help kid understand spaceships | YES | None (LLM knowledge) | Nothing - LLM handles educational Qs |
| Weekend calendar events | YES | get_calendar | Nothing - checks calendar correctly |
| Help with weight loss tips | PARTIAL | None | LLM refuses health advice (too cautious). Fix system prompt. |
| Show token usage / money spent | NO | None | LLM doesn't know about usage_logs table. Add a `get_usage` tool. |
| Holiday / long weekend info | NO | None | No holiday calendar. Need US holiday data + awareness. |
| Traffic / ETA to work | NO | None | Need Google Maps Directions API or similar. |
| Safeway deals on chicken | NO | None | Need store deals API or web scraping. |
| Weather / rain at Lake Tahoe | NO | None | Need weather API (OpenWeatherMap or similar). |

## Phase 1: Quick Wins (No new APIs needed)

### 1.1 Fix System Prompt for Health/General Advice
The LLM refuses health questions because the prompt is too restrictive. Update `vinegar-context.ts` to allow general wellness advice while disclaiming it's not medical advice.

```
Change: "I am a home assistant designed to help with tasks"
To: "I am a knowledgeable family assistant. I can help with general questions,
    including health tips, educational topics, cooking, and life advice.
    For medical concerns, I recommend consulting a doctor."
```

### 1.2 Add `get_usage` Tool
Wire up a tool that queries the `usage_logs` table so the LLM can report token/cost usage.

```typescript
registerTool('get_usage', 'Get token usage and cost summary', (args) => {
  const { period = 'today' } = args;
  // Query usage_logs table for today/week/month
  // Return: total tokens, model breakdown, estimated cost
});
```

### 1.3 Add US Holiday Awareness
Add a static holiday list to the system context so the LLM knows about upcoming US holidays.

```typescript
const US_HOLIDAYS_2026 = [
  { date: '2026-01-01', name: "New Year's Day" },
  { date: '2026-01-19', name: 'Martin Luther King Jr. Day' },
  { date: '2026-02-16', name: "Presidents' Day" },
  { date: '2026-05-25', name: 'Memorial Day' },
  { date: '2026-07-04', name: 'Independence Day' },
  { date: '2026-09-07', name: 'Labor Day' },
  { date: '2026-10-12', name: 'Columbus Day' },
  { date: '2026-11-11', name: "Veterans Day" },
  { date: '2026-11-26', name: 'Thanksgiving' },
  { date: '2026-12-25', name: 'Christmas Day' },
];
// Inject upcoming holidays into memory context when calendar keywords detected
```

### 1.4 Improve Token Usage Tracking with Cost Estimation
The `usage_logs` table already tracks tokens. Add a cost estimation:
- Euri free tier: $0 (but track tokens for budget awareness)
- Display: "Today: 15,234 tokens across 12 conversations (gemini-2.5-flash)"

## Phase 2: Weather Integration (Free API)

### 2.1 OpenWeatherMap Integration
**API**: OpenWeatherMap free tier (1,000 calls/day, current + 5-day forecast)
**Cost**: Free

**Implementation:**
1. Add `OPENWEATHER_API_KEY` to `.env.local`
2. Create `src/lib/weather.ts` with:
   - `getCurrentWeather(location: string)`
   - `getForecast(location: string, days: number)`
   - `getSkiConditions(resort: string)` (temperature + precipitation)
3. Register `get_weather` tool:
   ```typescript
   registerTool('get_weather', 'Get weather forecast', async (args) => {
     const { location, days = 1 } = args;
     // Call OpenWeatherMap API
     // Return: temperature, conditions, precipitation, wind
   });
   ```
4. Store home location in settings table for "weather here" queries
5. Support specific locations: "weather in Lake Tahoe", "rain in San Francisco"

**Handles these scenarios:**
- "When is there going to be heavy rain at Lake Tahoe?" → 5-day forecast
- "Do I need an umbrella today?" → Current conditions
- "What's the ski conditions at Tahoe this weekend?" → Snow/temperature forecast

### 2.2 Location Settings
Add to family settings:
- `home_location` (city/zip) - for "weather here" queries
- `work_location` (address) - for traffic/commute queries
- `favorite_locations` (JSON array) - Lake Tahoe, etc.

## Phase 3: Traffic & Commute (Google Maps API)

### 3.1 Google Maps Directions API
**API**: Google Maps Directions API
**Cost**: $5 per 1,000 requests (first $200/month free = 40,000 free requests)

**Implementation:**
1. Add `GOOGLE_MAPS_API_KEY` to `.env.local`
2. Create `src/lib/maps.ts`:
   - `getCommute(origin: string, destination: string)` - returns ETA, distance, traffic conditions
   - `getTrafficConditions(route: string)` - returns delay info
3. Register `get_traffic` tool:
   ```typescript
   registerTool('get_traffic', 'Check traffic and commute time', async (args) => {
     const { from, to } = args;
     // Default: home_location → work_location
     // Returns: duration, duration_in_traffic, distance, route summary
   });
   ```

**Handles these scenarios:**
- "How's the traffic on my way to work?" → Uses stored home/work locations
- "How long to get to Safeway?" → Uses Google Maps with current traffic
- "What's my ETA if I leave now?" → Real-time traffic calculation

### 3.2 Google Places API (Nearby Search)
**API**: Google Places API
**Cost**: Included in Maps API credit

**Implementation:**
- `findNearby(query: string, location: string)` - restaurants, stores, etc.
- Register `find_nearby` tool for "South Indian food near me" type queries

## Phase 4: Store Deals & Shopping (Web Scraping)

### 4.1 Safeway/Grocery Store Deals
**Challenge**: No official public API for most grocery stores.

**Approach A: Flipp API (aggregator)**
- Flipp aggregates weekly flyers from Safeway, Walmart, Target, etc.
- Unofficial API available at `https://backflipp.wishabi.com/flipp/items/search`
- Free to use, returns current deals by store and item

**Approach B: SerpAPI for Google Shopping**
- Search "Safeway cooked chicken deals [zip code]"
- $50/month for 5,000 searches

**Approach C: Web Scraper Skill**
- Create a `web_scraper` skill targeting Safeway's weekly ad page
- Parse HTML for deals matching the requested item
- Limited by site changes, but free

**Recommended: Approach A (Flipp)**
```typescript
registerTool('check_deals', 'Check grocery store deals and offers', async (args) => {
  const { store, item, zip_code } = args;
  // Query Flipp API for current deals
  // Filter by store (Safeway, Walmart, etc.) and item keyword
  // Return: item name, sale price, regular price, valid dates
});
```

**Handles these scenarios:**
- "Is there an offer on cooked chicken at Safeway?" → Flipp search
- "What's on sale at Costco this week?" → Weekly flyer items
- "Find the cheapest milk near me" → Cross-store price comparison

### 4.2 Nearby Restaurant Search
Uses Google Places API from Phase 3:
```typescript
registerTool('find_restaurant', 'Find restaurants nearby', async (args) => {
  const { cuisine, location } = args;
  // Google Places API: type=restaurant, keyword=cuisine
  // Returns: name, address, rating, price_level, distance
});
```

**Handles:**
- "Where can I get South Indian food nearby?" → Google Places search
- "Best pizza places within 10 minutes" → Places + distance matrix

## Phase 5: Self-Learning Skill System

### 5.1 Auto-Skill Creation
When the user asks for something that requires an API the system doesn't have, the LLM should:
1. Recognize the gap
2. Suggest creating a skill
3. Auto-create it with user confirmation

**Example flow:**
```
User: "Check if there's a sale on chicken at Safeway"
Vinegar: "I don't have a Safeway deals checker yet. Would you like me to
         create a skill for that? I'll need your zip code."
User: "Yes, my zip is 94538"
Vinegar: [Calls manage_skill to create a 'safeway_deals' web_scraper skill]
         "Done! Next time you ask about Safeway deals, I'll check automatically."
```

### 5.2 Skill Memory
When a skill is used successfully, log the pattern so the LLM learns:
- "Last time you asked about Safeway, I used the deals checker skill"
- Skills get better trigger matching over time based on usage patterns

## Implementation Priority

| Priority | Feature | Effort | APIs Needed | Cost |
|----------|---------|--------|-------------|------|
| 1 | Fix system prompt for health advice | 15 min | None | Free |
| 2 | Add get_usage tool | 30 min | None | Free |
| 3 | Add US holiday awareness | 30 min | None | Free |
| 4 | Weather integration | 2 hrs | OpenWeatherMap | Free |
| 5 | Location settings (home/work) | 1 hr | None | Free |
| 6 | Traffic/commute | 2 hrs | Google Maps | Free (first $200/mo) |
| 7 | Nearby restaurants/places | 1 hr | Google Places | Free (incl. in Maps) |
| 8 | Store deals (Flipp) | 2 hrs | Flipp (unofficial) | Free |
| 9 | Self-learning skill creation | 3 hrs | None | Free |

## API Keys Needed

| Service | Free Tier | Sign Up |
|---------|-----------|---------|
| OpenWeatherMap | 1,000 calls/day | https://openweathermap.org/api |
| Google Maps Platform | $200/month credit (~40K requests) | https://console.cloud.google.com |
| Flipp (unofficial) | Unlimited (unofficial) | No signup needed |

## Settings to Add

```sql
-- New settings for location-aware features
INSERT INTO settings (key, value) VALUES
  ('home_location', ''),        -- "Fremont, CA" or zip code
  ('work_location', ''),        -- work address
  ('home_zip', ''),             -- for store deals
  ('openweather_api_key', ''),  -- weather API key
  ('google_maps_api_key', '');  -- maps API key
```

## New Tools Summary

| Tool | Description | API | Phase |
|------|-------------|-----|-------|
| `get_usage` | Token usage & cost summary | Local DB | 1 |
| `get_weather` | Weather forecast any location | OpenWeatherMap | 2 |
| `get_traffic` | Commute time with real-time traffic | Google Maps | 3 |
| `find_nearby` | Find restaurants/stores/places | Google Places | 3 |
| `check_deals` | Grocery store deals & offers | Flipp | 4 |
| `find_restaurant` | Find restaurants by cuisine | Google Places | 3 |

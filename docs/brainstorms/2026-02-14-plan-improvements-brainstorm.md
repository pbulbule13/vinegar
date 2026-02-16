---
title: "Plan Improvements - Comprehensive Gap Analysis & New Features"
date: 2026-02-14
status: complete
parent: 2026-02-14-family-home-assistant-brainstorm.md
---

# Plan Improvements - Comprehensive Gap Analysis & New Features

This document captures ALL improvements, gaps, and new features identified during deep review of the existing plan, codebase analysis, and user feedback. These should be folded into the implementation plan.

---

## NEW FEATURE: Extensible Skill/Plugin System (User Requested)

### What the User Wants
> "I want it to be extendable so that if I need to add a new skill I should be easily able to add it. Like find kids' school free food menu so that this app can tell me what food is being served in the school so I can decide to make food at home or not. All such skills should be able to add easily via voice control, so I can add any skill which will stay and can be used whenever required."

### Design: Voice-Programmable Skills Engine

**Concept:** Users can teach Jarvis new skills by describing them in natural language. Skills persist in the database and become available as tools for voice and text.

**Skill Types:**

| Type | Description | Example |
|------|-------------|---------|
| **Web Scraper** | Fetch and parse a web page on demand | "Check school lunch menu from [URL]" |
| **API Caller** | Call an external API and interpret results | "Get weather from OpenWeatherMap" |
| **Scheduled Checker** | Periodically check a source and notify | "Check school menu every Monday morning" |
| **Data Lookup** | Query local DB with custom logic | "What chores has Emma completed this week?" |
| **Composite** | Chain multiple skills together | "Check school menu, if it's pizza day, don't add lunch to grocery list" |

**How it works (voice flow):**

```
User: "Jarvis, learn a new skill"
Jarvis: "Sure, what should I learn?"

User: "Check the school lunch menu from mountainview.schoolcafe.org"
Jarvis: "Got it. I'll call this 'School Lunch Menu'. When should I check it?"

User: "Every Monday at 7am, and also whenever I ask"
Jarvis: "Done. I've added 'School Lunch Menu'. I'll check it every Monday at 7am
         and you can ask me anytime by saying 'What's for lunch at school?'"
```

**Database Schema:**

```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                -- "School Lunch Menu"
  description TEXT NOT NULL,         -- "Check school lunch menu from website"
  type TEXT NOT NULL,                -- 'web_scraper', 'api_caller', 'scheduled', 'data_lookup', 'composite'
  trigger_phrases TEXT NOT NULL,     -- JSON array: ["school lunch", "lunch menu", "what's for lunch at school"]
  config TEXT NOT NULL,              -- JSON: { url, selector, api_endpoint, headers, schedule, etc. }
  schedule TEXT,                     -- cron expression for scheduled skills (nullable)
  is_active INTEGER DEFAULT 1,
  created_by TEXT,                   -- family_member_id who created it
  last_used_at INTEGER,
  use_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (created_by) REFERENCES family_members(id)
);
CREATE INDEX idx_skills_active ON skills(is_active);

CREATE TABLE skill_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL,
  executed_at INTEGER DEFAULT (unixepoch()),
  result TEXT,                       -- JSON: the result data
  success INTEGER DEFAULT 1,
  error TEXT,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
CREATE INDEX idx_skill_logs_skill ON skill_logs(skill_id);
CREATE INDEX idx_skill_logs_time ON skill_logs(executed_at);
```

**Config examples by skill type:**

```json
// Web Scraper - School lunch menu
{
  "type": "web_scraper",
  "url": "https://mountainview.schoolcafe.org/menu",
  "extraction_prompt": "Extract today's lunch menu items and any allergen info",
  "cache_minutes": 60
}

// API Caller - Weather
{
  "type": "api_caller",
  "endpoint": "https://api.openweathermap.org/data/2.5/weather",
  "params": { "q": "Mountain View,CA", "appid": "{{WEATHER_API_KEY}}" },
  "response_prompt": "Summarize the weather in a conversational way"
}

// Scheduled Checker - School menu weekly
{
  "type": "scheduled",
  "base_skill_id": "school_lunch_menu",
  "cron": "0 7 * * 1",
  "notification": "Here's what's for lunch at school this week: {{result}}"
}
```

**Implementation approach:**
- LLM interprets user's natural language skill description → generates config JSON
- Web scraper skills use `fetch()` + LLM to extract relevant info from HTML
- API caller skills use `fetch()` with configured endpoints
- Scheduled skills register with the existing scheduler engine
- All skill results are interpreted by LLM before presenting to user
- Skills are stored in DB and loaded on startup as available tools

**New tool for voice/text:**
```json
{
  "name": "manage_skill",
  "description": "Create, list, update, or delete custom skills. Use when user says 'learn a new skill', 'add ability', 'teach yourself', etc.",
  "parameters": {
    "action": "create | list | update | delete | execute",
    "name": "Skill name",
    "description": "What it does",
    "type": "web_scraper | api_caller | scheduled | data_lookup",
    "config": "JSON configuration",
    "trigger_phrases": "Comma-separated phrases that activate this skill"
  }
}
```

**Skill matching at runtime:**
When a user message doesn't match any built-in tool, the system:
1. Checks trigger phrases of all active skills (fuzzy match)
2. If a match is found, executes the skill
3. Passes raw result through LLM to generate a natural response
4. Logs execution in skill_logs

**Security considerations:**
- Only parents can create/delete skills (requires parent profile)
- URL allowlist (optional) - parents can restrict which domains skills can access
- No arbitrary code execution - skills are config-driven, not code-driven
- Rate limiting on web scraper skills (max 1 request per minute per URL)
- API keys for external services stored in the settings table, referenced by `{{KEY_NAME}}`

**Phase placement:** Phase 3 (after database, PII, and family profiles are built)

---

## CALENDAR/EVENTS/ACTIVITIES IMPROVEMENTS

User confirmed: **One shared Google family calendar is acceptable.**

### Gap A: Local-First Calendar (No Google Dependency)

**Problem:** Plan assumes Google Calendar as only source. No calendar works without internet/Google.

**Fix:** Make local `calendar_events` table the primary calendar. Google sync is optional overlay.
- Events created locally work immediately (no Google required)
- Google sync pushes local events to Google AND pulls Google events to local
- If Google is disconnected, all local events still work
- Label in UI: "Local" vs "Synced" events

**Impact on plan:** Modify Phase 2.2 - Google Calendar becomes an optional integration, not a requirement. Calendar CRUD works Day 1 with just SQLite.

### Gap B: Multi-Person Events

**Problem:** `calendar_events.family_member_id` links to ONE person only.

**Fix:**
- Make `family_member_id` nullable (null = whole family event)
- Add `calendar_event_attendees` junction table:
```sql
CREATE TABLE calendar_event_attendees (
  event_id TEXT NOT NULL,
  family_member_id TEXT NOT NULL,
  PRIMARY KEY (event_id, family_member_id),
  FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
```
- "Family dinner at grandma's" → null member_id (whole family)
- "Emma's dentist + Mom" → attendees: [emma_id, mom_id]

### Gap C: Birthday/Anniversary Tracking

**Fix:**
- Add `birthday TEXT` to `family_members` table (YYYY-MM-DD format)
- Add `special_dates` table:
```sql
CREATE TABLE special_dates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,           -- "Wedding Anniversary"
  date TEXT NOT NULL,            -- MM-DD (repeats annually)
  year_started INTEGER,          -- 2018 (for "5th anniversary" calculations)
  family_member_id TEXT,         -- nullable (family-wide events)
  reminder_days_before INTEGER DEFAULT 7,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
```
- Auto-generate annual calendar events 30 days before each special date
- Jarvis proactively: "Noah's birthday is next Thursday. He'll be turning 7!"

### Gap D: Public Holiday Awareness

**Fix:**
- Pull holidays from Google Calendar's "Holidays in [Country]" calendar during sync
- Store in `calendar_events` with `source = 'holiday'`
- Add `source` CHECK: `('google', 'caldav', 'manual', 'holiday', 'birthday', 'skill')`
- Jarvis can say "Monday is a holiday - no school for the kids"

### Gap E: All-Day Events & Free/Busy

**Fix:**
- All-day events formatted differently: "All day: Emma's school holiday" vs "3:00 PM: Dentist"
- Add free/busy query: "Am I free Thursday afternoon?"
- Logic: Find all events in time range, report gaps
- Voice: "You're free between 2pm and 4pm on Thursday"

### Gap F: Travel Time / Logistics Warnings

**Fix:**
- When two events for different kids overlap with different locations, warn parent
- Simple heuristic: If two events start within 30 min of each other AND have different `location` fields → flag
- "Emma has soccer at Riverside Park at 4pm and Noah has piano at Music Center at 4:15pm. Both need transportation."
- No GPS/maps required - just string comparison on locations

### Gap G: Event Edit/Delete Tools (CRITICAL)

**Fix:** Add two missing tools:
```json
{
  "name": "update_event",
  "description": "Modify an existing calendar event. Use when user says 'move', 'change', 'reschedule', or 'update' an event.",
  "parameters": {
    "event_title": "Title or partial match of the event to update",
    "date": "New date (optional)",
    "time": "New time (optional)",
    "title": "New title (optional)",
    "duration_minutes": "New duration (optional)"
  }
}
```
```json
{
  "name": "delete_event",
  "description": "Cancel/delete a calendar event. Use when user says 'cancel', 'delete', or 'remove' an event.",
  "parameters": {
    "event_title": "Title or partial match",
    "scope": "this_instance | all_future | entire_series"
  }
}
```

### Gap H: Weekly/Monthly Overview

**Fix:**
- `get_calendar` tool already accepts `date: "this week"` in plan
- Add explicit response formatting for week view
- Voice: "This week you have 8 events. Monday: school drop-off at 8, dentist at 10..."
- Dashboard: Add week view toggle (day | week | month)

### Gap I: Activity-to-Calendar Sync Lifecycle

**Fix:** Define explicit sync rules:
1. **Activity created** → Generate calendar events for next 4 weeks
2. **Activity time changed** → Update all future events, leave past unchanged
3. **Activity cancelled (series)** → Delete all future events
4. **Activity cancelled (single)** → Delete only that instance, add to exceptions list
5. **Weekly maintenance job** → Extend recurring events 4 weeks into future
6. **Event deleted from calendar** → Does NOT delete the activity (one-way: activity → events)

### Gap J: Reminder Snooze

**Fix:**
- When a reminder fires and user is present (app open):
  - Show: "Dismiss | Snooze 5 min | Snooze 15 min | Snooze 1 hour"
  - Voice: "Snooze" → default 10 min, "Snooze 30 minutes" → custom
- Creates a new one-time reminder at snooze time
- Max 3 snoozes per reminder (prevents infinite snooze)
- Add `snooze_count INTEGER DEFAULT 0` to `scheduled_reminders`

### Gap K: Activate Dead dueDate Code

**Fix:**
- Currently `Task.dueDate` exists but is never used in API, sorting, or reminders
- Phase 1 migration must activate it:
  - Tasks with due dates sorted by due date in list responses
  - Tasks due within 24 hours: auto-inject into context ("You have 2 tasks due today")
  - Tasks overdue: flag in responses ("Overdue: buy groceries was due yesterday")
  - Tasks with due dates + assigned member: create reminder for that member

---

## CODEBASE-LEVEL IMPROVEMENTS (Found During Deep Analysis)

### Issue 1: ScriptProcessorNode is Deprecated

**File:** `src/hooks/useRealtimeVoice.ts:281` and `src/lib/voice.ts:114`

**Problem:** `ScriptProcessorNode` is deprecated in Web Audio API. Should use `AudioWorkletNode`.

**Fix:** Replace with `AudioWorkletProcessor` pattern. This is a reliability improvement - ScriptProcessorNode runs on the main thread and can cause audio glitches.

**Phase:** Phase 6 (performance) - non-blocking, works for now

### Issue 2: No Rate Limiting on LLM API Calls

**File:** `src/app/api/chat/route.ts`

**Problem:** Unlimited API calls with no throttling. A runaway UI bug could drain tokens or hit rate limits.

**Fix:**
- Add request counter in DB (already tracked in `usage_logs`)
- Before each call: check daily token count vs budget
- If over budget: return friendly message "Daily token limit reached. Resets at midnight UTC."
- Configurable daily budget in settings table

### Issue 3: No Input Validation on API Routes

**Files:** All `/api/tools/*` routes

**Problem:** Routes accept any JSON without validation. Could crash on unexpected input types.

**Fix:**
- Add Zod schemas for all API route inputs
- Validate before processing
- Return structured error messages

**New dependency:** `zod` (~50KB)

### Issue 4: Chat History Grows Unbounded

**File:** `src/app/page.tsx:60` - `chatHistory` state array

**Problem:** `chatHistory` grows with every message and is sent entirely to the API. Long conversations will hit token limits and increase costs.

**Fix:**
- Cap `chatHistory` at last 20 messages
- When over 20: summarize older messages into a single context entry
- Or simply truncate to last 20 (simpler for Phase 1)

### Issue 5: No Error Recovery in Voice

**File:** `src/hooks/useRealtimeVoice.ts`

**Problem:** WebSocket errors show a message but don't auto-reconnect. User has to manually toggle the orb.

**Fix:**
- On WebSocket close (non-intentional): auto-reconnect with exponential backoff
- Max 3 retry attempts, then show error
- Visual indicator during reconnection

### Issue 6: Memory Context Has No Query Passed in Text Chat

**File:** `src/app/api/chat/route.ts:36`

**Problem:** `memory.getMemoryContext()` is called with NO query parameter. This means text chat always gets the general context dump (all types, 28 entries) instead of query-relevant context.

**Fix:**
```typescript
// Before
const memoryContext = memory.getMemoryContext();

// After
const lastUserMessage = userMessages[userMessages.length - 1]?.content || '';
const memoryContext = memory.getMemoryContext(lastUserMessage);
```

This alone reduces token waste and improves response quality - should be done in Phase 1.

### Issue 7: No Text Chat Cost Tracking

**File:** `src/app/api/chat/route.ts`

**Problem:** Voice tracks costs via `usage_logs`, but text chat doesn't track token usage at all despite Euri returning `data.usage`.

**Fix:** Add usage logging to text chat route:
```typescript
if (data.usage) {
  await fetch('/api/usage', {
    method: 'POST',
    body: JSON.stringify({ model, usage: data.usage, source: 'text' })
  });
}
```

### Issue 8: JSON File Corruption Risk

**Files:** `src/lib/memory.ts` - `writeJSON()`

**Problem:** `fs.writeFileSync()` is not atomic. If the process crashes mid-write, the JSON file is corrupted with no recovery.

**Fix:** This is exactly why we're migrating to SQLite. But until then, use write-to-temp-then-rename pattern:
```typescript
function writeJSON(filePath: string, data: unknown): void {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, filePath); // atomic on most filesystems
}
```

### Issue 9: Duplicate Memory Detection is Too Aggressive

**File:** `src/lib/memory.ts:112`

**Problem:** Dedup matches on `topic.toLowerCase() === newEntry.topic.toLowerCase() && type === type`. This means "Mom's birthday" will overwrite "Mom's phone number" if both have type "fact" and topic "Mom".

**Fix:** Add content similarity check or use a more specific match:
- Match on topic + type + first 50 chars of content
- Or generate a content hash for exact-duplicate detection
- SQLite migration will fix this properly with better querying

### Issue 10: Zustand Store Not Used

**File:** `package.json` - `zustand` is a dependency but never imported anywhere.

**Fix:** Either remove it or use it for global state management (family member, active session, settings). Could be useful for the dashboard phase.

### Issue 11: PCM16→Float32 Audio Conversion Bug (CRITICAL)

**File:** `src/hooks/useRealtimeVoice.ts:94-95`

**Problem:** The audio conversion is mathematically incorrect:
```typescript
float32Array[i] = audioData[i] / 32768;  // WRONG: should be 32768 for negative, 32767 for positive
```
This causes audio distortion, especially at lower volumes.

**Fix:**
```typescript
float32Array[i] = audioData[i] < 0 ? audioData[i] / 32768 : audioData[i] / 32767;
```

**Phase:** Phase 1 (quick fix, improves voice quality immediately)

### Issue 12: API Key Exposure in Fallback Path (SECURITY)

**File:** `src/app/api/ai/realtime-token/route.ts:102-108`

**Problem:** If OpenAI's `client_secrets` endpoint fails, the route falls back to returning the RAW API key to the browser. This key could be leaked via console, DevTools, or browser extensions.

**Fix:**
- Never return raw API key to client
- If ephemeral token fails, return an error and ask user to retry
- Log the failure server-side for debugging

### Issue 13: Unused Dependencies (5 packages)

**File:** `package.json`

**Problem:** These packages are installed but never imported:
- `framer-motion` (~180KB) - never used
- `zustand` (~3KB) - never used
- `react-markdown` - never used
- `remark-gfm` - never used
- `tailwind-merge` - never used

**Fix:** Remove unused ones now. Keep `zustand` and `react-markdown` if planning to use them in dashboard phase.

### Issue 14: Messages & ChatHistory State Split

**File:** `src/app/page.tsx:54,60`

**Problem:** Two separate state arrays track messages:
- `messages` - ALL messages (voice + text) for display
- `chatHistory` - ONLY text messages sent to Euri API

Voice messages never enter `chatHistory`, so text chat has no awareness of voice conversation context. If user talks via voice about groceries, then types "add milk", text chat doesn't know about the grocery discussion.

**Fix:** Unified message store (use Zustand). Both voice and text contribute to a single conversation context. When building Euri messages, include summarized voice transcripts.

### Issue 15: Usage Fetch on Every Message

**File:** `src/app/page.tsx:101-102`

**Problem:**
```typescript
useEffect(() => { fetch("/api/usage")... }, [messages.length]);
```
This fetches usage stats every time ANY message is added. In a fast voice conversation, this could fire 20+ times per minute.

**Fix:** Throttle to once every 30 seconds, or fetch only on page load + after text chat completes.

### Issue 16: No Request Timeout

**Files:** `src/app/api/chat/route.ts`, `src/lib/euri-client.ts`

**Problem:** `fetch()` calls to Euri have no timeout. If Euri is slow or down, requests hang indefinitely, locking the UI.

**Fix:** Add `AbortController` with 30-second timeout:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
const res = await fetch(url, { ...options, signal: controller.signal });
clearTimeout(timeout);
```

### Issue 17: Audio Playback Queue Unbounded (Memory Leak)

**File:** `src/hooks/useRealtimeVoice.ts:147`

**Problem:** `playbackQueueRef` accumulates audio chunks without limit. If OpenAI streams faster than the browser can play, the queue grows until the tab crashes.

**Fix:** Cap queue at ~50 chunks. If queue is full, drop oldest chunks (acceptable - causes brief audio skip but prevents crash).

---

## ARCHITECTURAL IMPROVEMENTS

### Improvement 1: Unified Tool Execution Layer

**Problem:** Voice tools execute via `fetch(/api/tools/${name})` from the client. Text chat has NO tool execution. Adding tools means updating both paths separately.

**Fix:** Create a single tool executor:
```
src/lib/tool-executor.ts
  - Registry of all tools (built-in + custom skills)
  - Single executeToolmethod(name, args) → result
  - Used by both voice API route AND text chat route
  - Skills from DB registered at startup
```

This is critical for the extensible skill system - new skills automatically available in both voice and text.

### Improvement 2: Event Bus for Cross-Feature Communication

**Problem:** Features will need to communicate: calendar event created → create reminder, task completed → award chore points, grocery item added → update dashboard widget.

**Fix:** Simple in-process event emitter:
```typescript
// src/lib/events.ts
import { EventEmitter } from 'events';
export const jarvisEvents = new EventEmitter();

// Usage:
jarvisEvents.emit('calendar:event_created', { event });
jarvisEvents.on('calendar:event_created', (event) => scheduler.createReminder(event));
```

Keeps features decoupled. No need for Redis/BullMQ - just in-process events.

### Improvement 3: Middleware Pattern for LLM Calls

**Problem:** PII redaction, token counting, context injection, and logging all need to happen on every LLM call. Without a middleware pattern, each route will duplicate this logic.

**Fix:**
```typescript
// src/lib/llm-middleware.ts
export async function callLLM(messages, options) {
  // 1. Inject context (tiered)
  // 2. Redact PII
  // 3. Count tokens / enforce budget
  // 4. Call Euri API
  // 5. Rehydrate PII in response
  // 6. Log usage
  // 7. Return response
}
```

Single function that ALL text LLM calls go through. Voice still uses OpenAI directly.

---

## UPDATED TOOL LIST (Built-in: 12 tools)

| # | Tool | Exists? | Phase |
|---|------|---------|-------|
| 1 | `save_memory` | YES | - |
| 2 | `recall_memory` | YES | - |
| 3 | `manage_task` | YES | - |
| 4 | `manage_grocery` | NO | 3 |
| 5 | `get_calendar` | NO | 2 |
| 6 | `create_event` | NO | 2 |
| 7 | `update_event` | NO (was missing) | 2 |
| 8 | `delete_event` | NO (was missing) | 2 |
| 9 | `manage_activity` | NO | 3 |
| 10 | `manage_chore` | NO | 3 |
| 11 | `set_reminder` | NO | 2 |
| 12 | `manage_meals` | NO | 3 |
| 13 | `manage_skill` | NO (NEW) | 3 |
| 14 | `get_family` | NO | 2 |

**Total: 14 built-in tools + unlimited custom skills**

---

## UPDATED DATABASE TABLES

Original plan: 12 tables. New additions:

| Table | Phase | Reason |
|-------|-------|--------|
| `skills` | 3 | Extensible skill system |
| `skill_logs` | 3 | Track skill executions |
| `calendar_event_attendees` | 2 | Multi-person events |
| `special_dates` | 2 | Birthdays, anniversaries |

**Updated total: 16 tables** (create only the 6 needed tables in Phase 1 as decided, add others per phase)

---

## UPDATED PHASE PLAN SUMMARY

### Phase 1: Foundation (unchanged + critical fixes)
- SQLite migration (6 tables only: memories, tasks, usage_logs, family_members, settings, schema_version)
- PII redaction (layers 1+2 only)
- Text chat tool calling
- **ADD:** Fix PCM16→Float32 audio conversion bug (Issue 11 - CRITICAL, voice quality)
- **ADD:** Fix API key exposure in fallback path (Issue 12 - SECURITY)
- **ADD:** Fix memory context query in text chat (Issue 6)
- **ADD:** Fix text chat cost tracking (Issue 7)
- **ADD:** Activate dueDate in tasks (Gap K)
- **ADD:** Cap chat history at 20 messages (Issue 4)
- **ADD:** Input validation with Zod on all API routes (Issue 3)
- **ADD:** Add request timeout (30s) on all fetch calls (Issue 16)
- **ADD:** Remove unused dependencies: framer-motion, remark-gfm, tailwind-merge (Issue 13)
- **ADD:** Throttle usage fetch to 30s intervals (Issue 15)
- **ADD:** Cap audio playback queue at 50 chunks (Issue 17)

### Phase 2: Family + Calendar (expanded)
- Family member profiles + parent PIN
- **CHANGED:** Local-first calendar (works without Google) → then optional Google sync
- **ADD:** Multi-person events (Gap B)
- **ADD:** Birthday/anniversary tracking (Gap C)
- **ADD:** Event update/delete tools (Gap G)
- **ADD:** Free/busy queries (Gap E)
- Scheduling & reminder engine
- **ADD:** Reminder snooze (Gap J)
- Tiered context injection

### Phase 3: Household Features + Skills (expanded)
- Grocery list + deduplication
- Kids activities + school schedule
- **ADD:** Activity-to-calendar sync lifecycle (Gap I)
- **ADD:** Multi-child conflict detection (logistics warnings, Gap F)
- Chore assignment + points
- Meal planning
- **ADD: Extensible Skill System** (NEW - major feature)
  - Skills DB table + CRUD
  - Web scraper skill type
  - API caller skill type
  - Scheduled skill type
  - Voice-based skill creation flow
  - Skill matching engine (trigger phrases)
  - `manage_skill` tool

### Phase 4: Intelligence (unchanged)
- Embedding-based semantic search
- Episodic memory
- Smart context building

### Phase 5: UI Dashboard + PWA (expanded)
- Dashboard with widgets
- **ADD:** Week/month calendar view toggle (Gap H)
- **ADD:** Skills management UI (list, enable/disable, test)
- PWA + push notifications
- **ADD:** Holiday display in calendar (Gap D)

### Phase 6: Performance (expanded)
- Token budget management
- Response streaming
- Background workers
- **ADD:** Replace ScriptProcessorNode with AudioWorklet (Issue 1)
- **ADD:** Auto-reconnect on WebSocket drop (Issue 5)
- **ADD:** Rate limiting on API calls (Issue 2)

---

## DECISION LOG

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Calendar approach | One shared Google family calendar | User confirmed. Simplifies OAuth (one account). Local-first means it works without Google too. |
| Skill system architecture | Config-driven, not code-driven | Security: no arbitrary code execution. LLM interprets config + web scrape/API results. |
| Skill creation | Voice + text + UI | Voice for quick creation, UI for editing config, text for complex setups. |
| Skill web scraping | fetch() + LLM extraction | No headless browser needed. LLM extracts relevant info from raw HTML. Works for most public pages. |
| Event attendees | Junction table | Allows proper many-to-many between events and family members. |
| Holiday source | Google's holiday calendar | Pulled during Google sync. Falls back to no holidays if Google not connected. |
| Tool architecture | Unified executor + registry | Single tool system for voice, text, and custom skills. No duplication. |

---

## BEST PRACTICES RESEARCH FINDINGS (Incorporate into Plan)

### BP1: SQLite Must-Have PRAGMAs

The plan mentions WAL mode but misses other critical settings. On database init:

```javascript
db.pragma('journal_mode = WAL');        // concurrent reads
db.pragma('synchronous = NORMAL');      // 2x faster than FULL, safe for local apps
db.pragma('cache_size = -64000');       // 64MB cache (default is only 2MB)
db.pragma('foreign_keys = ON');         // OFF by default in SQLite!
db.pragma('temp_store = MEMORY');       // temp tables in RAM
db.pragma('mmap_size = 268435456');     // 256MB memory-map
```

Also need WAL checkpoint management (every 30s, checkpoint if WAL > 50MB).

### BP2: Next.js Dev Mode DB Singleton

In dev mode, hot reloading creates multiple DB connections. Must use `globalThis` pattern:
```javascript
function getDb() {
  if (!globalThis.__db) {
    globalThis.__db = createDatabase('./data/family.db');
  }
  return globalThis.__db;
}
```

### BP3: Use Serwist (NOT next-pwa) for PWA

`next-pwa` is unmaintained and doesn't support App Router. Use `@serwist/next` instead:
```bash
npm install @serwist/next @serwist/precaching @serwist/sw
```

### BP4: Google Calendar Incremental Sync

Don't poll every 15 min. Use `syncToken` for incremental sync:
- First sync: fetch all events, save `syncToken`
- Subsequent syncs: send `syncToken`, get only changed events
- Optionally: set up webhook push notifications so Google tells YOU about changes

This stays well within Google's rate limits (1M queries/day).

### BP5: Prompt Caching for Token Savings

Place STATIC content at the BEGINNING of every prompt (system prompt, family context, house rules). Cloud providers cache repeated prefixes:
- Anthropic: 90% cost reduction on cached prefix
- OpenAI: 50% automatic caching

Structure: static prefix → dynamic conversation → user message.

### BP6: Child Safety - OpenAI Moderation API (FREE)

The plan mentions child-safe mode but doesn't specify HOW. Use OpenAI's free Moderation API:
- Classify input AND output for violence, sexual content, self-harm, hate
- Different system prompts per family role (parent vs child)
- Log flagged interactions (topic summaries, not full transcripts)
- Never expose full conversation logs to parents (privacy erosion)

### BP7: Use `rrule` Library for Recurring Events

Don't build custom recurrence logic. Use the `rrule` library:
- Compatible with Google Calendar's iCal RRULE format
- Handles complex patterns (every 2nd Tuesday, etc.)
- Can expand recurrence rules into concrete dates

```bash
npm install rrule
```

### BP8: Offline Degradation

When internet is down, Jarvis should:
- Still show calendar from SQLite cache
- Still fire reminders (all local)
- Still manage grocery list, tasks, chores (all local)
- Show clear "Offline Mode" indicator
- Queue LLM requests, process when internet returns
- Disable voice (requires OpenAI)
- Offer template-based responses for common queries

### BP9: Voice UX for Families

- Keep voice responses under 3 sentences; offer to elaborate
- When listing items (calendar), limit to 3, then "Want to hear more?"
- Always confirm destructive actions verbally
- Children's responses: shorter, simpler vocabulary, encouraging tone
- Use "Brief Mode" for simple confirmations (chime > verbose "I have set your reminder")
- Handle interruptions (OpenAI Realtime API supports this natively)

### BP10: Model Routing for Cost

Simple pattern-based routing before hitting LLM:
```
Simple queries (calendar, timer, grocery) → gemini-2.5-flash-lite (cheapest)
General chat → gemini-2.5-flash (standard)
Complex reasoning → gemini-2.5-pro (smart)
Voice → gpt-4o-mini-realtime (only option)
```

Detect simple queries via regex patterns before sending to LLM.

---

## UPDATED DEPENDENCY LIST

| Package | Purpose | Phase | Notes |
|---------|---------|-------|-------|
| `better-sqlite3` | Local database | 1 | Must-have PRAGMAs |
| `zod` | Input validation | 1 | ~50KB |
| `node-schedule` | Job scheduling | 2 | On top of SQLite persistence |
| `rrule` | Recurring events | 2 | iCal RRULE compatible |
| `googleapis` | Google Calendar | 2 | Incremental sync with syncToken |
| `web-push` | Push notifications | 2 | VAPID-based, no 3rd party |
| `@serwist/next` | PWA service worker | 5 | Replaces abandoned next-pwa |
| `sqlite-vec` | Vector search | 4 | SQLite extension |

**Remove:** `framer-motion`, `remark-gfm`, `tailwind-merge` (unused)
**Keep:** `zustand` (for dashboard state), `react-markdown` (for formatted responses)

---

## OPEN QUESTIONS

1. **Skill rate limits:** How often can a web scraper skill fetch? Suggest max 1 fetch per hour per URL to avoid being blocked.
2. **Skill API keys:** Where do users store API keys for custom skills? Suggest: settings table with key-value pairs, referenced as `{{KEY_NAME}}` in skill config.
3. **Skill sharing:** Should skills be exportable/importable? (e.g., share "school lunch checker" config with other families). Defer to Phase 7+.
4. **Voice identification:** Long-term, could Jarvis identify WHO is speaking by voice? Would eliminate manual member switching. Defer to Phase 7+.
5. **Tablet/kiosk mode:** Should there be a dedicated "always-on" mode for a tablet mounted in the kitchen? Could show dashboard + listen for wake word. Defer to Phase 7+.

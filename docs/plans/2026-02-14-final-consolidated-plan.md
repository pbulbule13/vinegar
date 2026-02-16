---
title: "FINAL PLAN: Jarvis Family Home Assistant - Full Upgrade"
type: feat
date: 2026-02-14
status: ready
consolidates:
  - 2026-02-14-family-home-assistant-brainstorm.md
  - 2026-02-14-plan-improvements-brainstorm.md
  - 2026-02-14-feat-family-home-assistant-upgrade-plan.md
  - 2026-02-14-feat-family-home-assistant-upgrade-plan-addendum.md
---

# FINAL PLAN: Jarvis Family Home Assistant - Full Upgrade

> This is the single source of truth. It consolidates the brainstorm, original plan, addendum, and improvements into one actionable document.

---

## Overview

Transform Jarvis from a basic AI chat app into a **production-grade family household management system** with:
- Local SQLite database (replacing fragile JSON files)
- PII protection before cloud LLM calls
- Family member awareness with child safety
- Local-first calendar with optional Google Calendar sync
- Scheduling, reminders, and alarms
- Grocery, chores, meals, kids' activities
- Voice-programmable extensible skill system
- Semantic memory search
- Dashboard with widgets
- PWA for mobile use

**Target users:** Family with parents + children under 8, running on home network.

---

## Architecture

```
                    +------------------+
                    |   Family Members |
                    | (Voice / Text)   |
                    +--------+---------+
                             |
                    +--------v---------+
                    |   Next.js App    |
                    |   (Frontend)     |
                    +--------+---------+
                             |
         +-------------------+-------------------+
         |                   |                   |
+--------v------+   +-------v-------+   +-------v--------+
| LLM Middleware |   | Scheduler     |   | Calendar Sync  |
| (PII + Tokens  |   | (node-schedule|   | (Google API +  |
|  + Context)    |   |  + SQLite)    |   |  syncToken)    |
+--------+------+   +-------+-------+   +-------+--------+
         |                   |                   |
+--------v-------------------v-------------------v--------+
|              Unified Tool Executor                      |
|  Built-in tools (14) + Custom Skills (unlimited)        |
+--------------------------+------------------------------+
                           |
+--------------------------v------------------------------+
|              API Routes (Next.js)                       |
|  /api/chat  /api/tools/*  /api/calendar  /api/family   |
|  /api/reminders  /api/grocery  /api/skills  /api/meals |
+--------------------------+------------------------------+
                           |
+--------------------------v------------------------------+
|              SQLite Database (local, single file)       |
|  16 tables + sqlite-vec extension for vector search     |
+---------------------------------------------------------+
```

**Key architectural patterns:**
1. **Unified Tool Executor** - Single registry for voice + text + custom skills
2. **LLM Middleware** - PII redact → context inject → token budget → call API → rehydrate → log
3. **Event Bus** - In-process EventEmitter for cross-feature communication
4. **Local-First** - Everything works without internet; cloud enhances but isn't required

---

## Phase 1: Foundation

**Goal:** Replace fragile JSON storage with SQLite, add PII protection, give text chat the same tools as voice, and fix critical bugs.

### 1.1 SQLite Database

**New file:** `src/lib/db.ts`

Initialize with required PRAGMAs:
```javascript
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -64000');     // 64MB (default 2MB)
db.pragma('foreign_keys = ON');       // OFF by default!
db.pragma('temp_store = MEMORY');
db.pragma('mmap_size = 268435456');   // 256MB memory-map
```

Use `globalThis` singleton pattern for Next.js dev mode hot-reload safety.

**Phase 1 tables (6 only):**

```sql
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER DEFAULT (unixepoch()),
  description TEXT
);

CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('parent', 'child')),
  age INTEGER,
  birthday TEXT,                    -- YYYY-MM-DD
  pin_hash TEXT,                    -- bcrypt, nullable (parents only)
  voice_profile TEXT,
  dietary_restrictions TEXT,        -- JSON array
  preferences TEXT,                 -- JSON blob
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('fact','preference','routine','decision','person','conversation')),
  importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('low','medium','high')),
  tags TEXT,                        -- JSON array
  family_member_id TEXT,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_memories_type ON memories(type);
CREATE INDEX idx_memories_importance ON memories(importance);
CREATE INDEX idx_memories_topic ON memories(topic);
CREATE INDEX idx_memories_created ON memories(created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
  assigned_to TEXT,
  due_date INTEGER,                 -- unix timestamp (ACTIVATE - was dead code)
  due_time TEXT,                    -- HH:MM
  recurring TEXT,                   -- JSON recurrence config
  category TEXT,
  points INTEGER DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (assigned_to) REFERENCES family_members(id)
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);

CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  audio_input_tokens INTEGER DEFAULT 0,
  audio_output_tokens INTEGER DEFAULT 0,
  text_input_tokens INTEGER DEFAULT 0,
  text_output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  source TEXT DEFAULT 'voice' CHECK(source IN ('voice','text')),
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_usage_created ON usage_logs(created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

**Migration strategy:**
- `schema_version` table tracks applied migrations
- One-time import from existing JSON files into SQLite
- Wrap entire migration in a transaction (`BEGIN IMMEDIATE ... COMMIT`)
- Keep JSON files as backup for 30 days
- Migration is idempotent (safe to re-run)

**Files to create/modify:**
- `src/lib/db.ts` (NEW) - Database init, PRAGMAs, singleton, migrations
- `src/lib/memory.ts` - Rewrite MemoryStore + TaskStore to use SQLite
- `src/app/api/usage/route.ts` - Rewrite to use SQLite

### 1.2 PII Redaction Gateway

**New file:** `src/lib/pii-redactor.ts`

**Layers (V1 - two layers only):**
1. **Family names from DB** - Load all names on startup, build dynamic regex
2. **Standard regex patterns** - Phone numbers, emails, street addresses, SSN-like patterns, credit card numbers

**Flow:**
```
User message → redact(msg) → [PII Map: "Sarah" → "<PERSON_1>"] → send to LLM
LLM response → rehydrate(resp) → replace "<PERSON_1>" → "Sarah" → show to user
```

- Session-scoped token mapping with 1-hour TTL
- Works for text chat (Euri). Voice acknowledged limitation (audio goes directly to OpenAI).
- Add privacy disclosure in settings: "Voice sends audio to OpenAI. Text chat redacts PII."

**Files to create/modify:**
- `src/lib/pii-redactor.ts` (NEW)
- `src/app/api/chat/route.ts` - Integrate redactor
- `src/app/api/ai/realtime-token/route.ts` - Redact system prompt memory context

### 1.3 Text Chat Tool Calling

**Problem:** Voice has 3 tools. Text chat has zero.

**Files to modify:**
- `src/app/api/chat/route.ts` - Add tool definitions to system prompt, implement tool-calling loop
- `src/lib/jarvis-context.ts` - Add tool instructions for text mode

**Approach:**
- Tool schemas in system prompt (one-time token cost)
- JSON-mode tool calls parsed from LLM response
- Max 3 tool-call iterations per user message
- Tool execution via unified tool executor (see 1.5)

### 1.4 LLM Middleware

**New file:** `src/lib/llm-middleware.ts`

Single function all text LLM calls go through:
1. Inject tiered context (family names always, memories when relevant)
2. Redact PII
3. Count tokens / enforce budget
4. Call Euri API (with 30s timeout via AbortController)
5. Rehydrate PII in response
6. Log usage to `usage_logs`
7. Return response

### 1.5 Unified Tool Executor

**New file:** `src/lib/tool-executor.ts`

- Registry of all tools (built-in + custom skills from DB)
- `executeTool(name, args)` → result
- Used by voice tool handler AND text chat tool loop
- Skills loaded from DB on startup and registered automatically

### 1.6 Event Bus

**New file:** `src/lib/events.ts`

Simple in-process EventEmitter for cross-feature communication:
```typescript
jarvisEvents.emit('task:created', { task });
jarvisEvents.on('task:created', (task) => { if (task.dueDate) createReminder(task); });
```

### 1.7 Critical Bug Fixes

| Fix | File | What |
|-----|------|------|
| Audio conversion | `useRealtimeVoice.ts:94` | Fix PCM16→Float32 math (divide by 32768 for negative, 32767 for positive) |
| API key exposure | `realtime-token/route.ts:102` | Never return raw API key in fallback; return error instead |
| Memory context query | `chat/route.ts:36` | Pass last user message to `getMemoryContext()` |
| Text cost tracking | `chat/route.ts` | Log `data.usage` to usage endpoint after Euri response |
| Request timeout | `chat/route.ts`, `euri-client.ts` | Add AbortController with 30s timeout on all fetch calls |
| Chat history cap | `page.tsx:60` | Cap `chatHistory` at 20 messages |
| Usage fetch throttle | `page.tsx:101` | Throttle usage fetch to once per 30 seconds |
| Audio queue cap | `useRealtimeVoice.ts:147` | Cap playback queue at 50 chunks |
| Input validation | All `/api/tools/*` routes | Add Zod schemas |
| Activate dueDate | Task queries | Sort by due date, inject "due today" into context, flag overdue |
| Remove unused deps | `package.json` | Remove `framer-motion`, `remark-gfm`, `tailwind-merge` |

### 1.8 New Dependencies (Phase 1)

```bash
npm install better-sqlite3 zod
npm install -D @types/better-sqlite3
npm uninstall framer-motion remark-gfm tailwind-merge
```

### Phase 1 Checklist

- [ ] `src/lib/db.ts` - SQLite init, PRAGMAs, singleton, migrations, JSON import
- [ ] `src/lib/memory.ts` - Rewrite MemoryStore to SQLite
- [ ] `src/lib/memory.ts` - Rewrite TaskStore to SQLite with active dueDate
- [ ] `src/app/api/usage/route.ts` - Rewrite to SQLite
- [ ] `src/lib/pii-redactor.ts` - Regex + family names redaction
- [ ] `src/lib/llm-middleware.ts` - Unified LLM call pipeline
- [ ] `src/lib/tool-executor.ts` - Tool registry and executor
- [ ] `src/lib/events.ts` - Event bus
- [ ] `src/app/api/chat/route.ts` - PII + tools + middleware + cost tracking + timeout
- [ ] `src/app/api/ai/realtime-token/route.ts` - Remove API key fallback, redact system prompt
- [ ] `src/lib/jarvis-context.ts` - Add text-mode tool instructions
- [ ] `src/hooks/useRealtimeVoice.ts` - Fix audio conversion, cap playback queue
- [ ] `src/app/page.tsx` - Cap chat history, throttle usage fetch
- [ ] All `/api/tools/*` routes - Add Zod validation
- [ ] `package.json` - Add better-sqlite3 + zod, remove unused deps
- [ ] JSON → SQLite one-time migration script

---

## Phase 2: Family + Calendar + Reminders

**Goal:** Family member awareness, local-first calendar with optional Google sync, scheduling engine with reminders.

### 2.1 Family Member Profiles

**New files:**
- `src/app/api/family/route.ts` - CRUD for family members
- `src/components/family-setup.tsx` - First-run wizard ("Who's in your family?")
- `src/components/family-switcher.tsx` - Quick switcher in header

**Features:**
- First-run wizard: Add names, roles (parent/child), ages, birthdays
- Optional parent PIN (4-digit, bcrypt hash in `family_members.pin_hash`)
- Voice/text: "This is [name]" to switch active member
- Per-member memory context
- Child-safe mode: When child is active, use age-appropriate system prompt + OpenAI Moderation API (free) on input/output
- Auto-timeout: Parent profile reverts to "no active user" after 30 min inactivity
- Active session stored in `settings` table (survives page refresh)

### 2.2 Local-First Calendar

**New tables (add via migration):**
```sql
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  external_id TEXT,              -- Google Calendar event ID (null for local)
  title TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  all_day INTEGER DEFAULT 0,
  location TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK(source IN ('google','caldav','manual','holiday','birthday','skill')),
  calendar_name TEXT,
  family_member_id TEXT,         -- nullable (null = whole family)
  reminder_minutes INTEGER,
  reminder_sent INTEGER DEFAULT 0,
  recurring TEXT,                -- iCal RRULE string (parsed by rrule library)
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_cal_start ON calendar_events(start_time);
CREATE INDEX idx_cal_external ON calendar_events(external_id);
CREATE INDEX idx_cal_member ON calendar_events(family_member_id);

CREATE TABLE calendar_event_attendees (
  event_id TEXT NOT NULL,
  family_member_id TEXT NOT NULL,
  PRIMARY KEY (event_id, family_member_id),
  FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);

CREATE TABLE special_dates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,             -- MM-DD (annual recurrence)
  year_started INTEGER,
  family_member_id TEXT,
  reminder_days_before INTEGER DEFAULT 7,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
```

**Calendar works local-first:**
- Create/read/update/delete events directly in SQLite
- No Google account required for basic calendar functionality
- Google sync is an optional enhancement (Phase 2.3)

**New tools:**
- `get_calendar` - Read events by date/member
- `create_event` - Create local event
- `update_event` - Modify existing event (was missing from original plan)
- `delete_event` - Cancel event with scope: this_instance | all_future | entire_series

**Features:**
- Multi-person events via attendees junction table
- Birthday auto-events from `family_members.birthday` and `special_dates`
- All-day events formatted separately from timed events
- Free/busy queries: "Am I free Thursday afternoon?"
- Logistics warnings: Flag when two kids' events overlap with different locations
- Weekly overview: "This week you have 8 events..."
- Use `rrule` library for recurring event expansion (iCal RRULE compatible)

### 2.3 Google Calendar Sync (Optional)

**New dependencies:** `googleapis` (for Google Calendar API)

**New files:**
- `src/lib/calendar-sync.ts` - Google Calendar sync engine
- `src/app/api/calendar/sync/route.ts` - Trigger sync

**Approach: Incremental sync with syncToken (NOT polling):**
1. First sync: Fetch all events, save `syncToken` in settings table
2. Subsequent syncs: Send `syncToken`, get only changed events
3. Sync triggered: On app startup, manual trigger, or webhook (if configured)
4. Conflict resolution: Google is source of truth for synced events
5. Local-only events have `source = 'manual'` and aren't pushed to Google (MVP)

**Phase 2 enhancement:** Two-way sync (local events push to Google).

**Holiday support:** Pull from Google's "Holidays in [Country]" calendar, store with `source = 'holiday'`.

### 2.4 Scheduling & Reminder Engine

**New table (add via migration):**
```sql
CREATE TABLE scheduled_reminders (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,             -- 'one_time','daily','weekly','custom'
  message TEXT NOT NULL,
  cron_expression TEXT,
  next_fire_time INTEGER,
  target_member_id TEXT,
  source_type TEXT,               -- 'calendar','task','manual','alarm','skill'
  source_id TEXT,
  is_active INTEGER DEFAULT 1,
  delivery_status TEXT DEFAULT 'pending',
  acknowledged_at INTEGER,
  snooze_count INTEGER DEFAULT 0,
  escalation_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (target_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_reminders_next ON scheduled_reminders(next_fire_time);
CREATE INDEX idx_reminders_active ON scheduled_reminders(is_active);
```

**New dependency:** `node-schedule`, `rrule`

**New files:**
- `src/lib/scheduler.ts` - Persistent scheduling engine
- `src/app/api/reminders/route.ts` - Reminder CRUD

**Features:**
- On startup: Load all active reminders from DB, register with node-schedule
- Calendar-driven: Auto-create reminder X minutes before calendar events
- Task-driven: Auto-create reminder for tasks with due dates
- Voice commands: "Remind me to pick up groceries at 5pm"
- Alarm support: "Set alarm for 6:30am weekdays"
- Delivery: Web push (primary) → in-app alert (always) → voice announcement (escalation after 5 min)
- **Snooze support:** "Dismiss | Snooze 5/15/60 min" - max 3 snoozes per reminder
- Morning briefing: At configurable time, compile today's schedule + tasks + grocery count

**New tool:**
- `set_reminder` - Create alarm/reminder with optional recurrence

### 2.5 Tiered Context Injection

**Modify:** `src/lib/memory.ts` - Rewrite `getMemoryContext()`

```
Level 0 (Always, ~50 tokens): Family member names + active user
Level 1 (Relevant, max 300 tokens): Memories matching query keywords (top 8)
Level 2 (Time-based, max 200 tokens): Today's calendar + upcoming reminders (only within 2hr window)
Level 3 (On-demand): Full memory dump (only when user asks "what do you know about X")
```

**Keyword detection for context routing:**
- Calendar keywords → inject Level 2
- Task/chore keywords → inject pending tasks
- Grocery/meal keywords → inject grocery list + today's meal
- Memory keywords → inject Level 3 (semantic search)
- Default → Level 0 only

**Prompt caching optimization:** Place static content (system prompt, family context) at the BEGINNING of every prompt for 50-90% cache hit rate.

### Phase 2 Checklist

- [ ] `src/app/api/family/route.ts` - Family member CRUD + parent PIN
- [ ] `src/components/family-setup.tsx` - First-run wizard
- [ ] `src/components/family-switcher.tsx` - Member switcher in header
- [ ] `src/lib/jarvis-context.ts` - Per-role system prompts (parent/child)
- [ ] Child safety: OpenAI Moderation API on input/output when child is active
- [ ] Calendar events table + attendees table + special_dates table (migration)
- [ ] `src/app/api/calendar/route.ts` - Local calendar CRUD
- [ ] `get_calendar`, `create_event`, `update_event`, `delete_event` tools
- [ ] Birthday auto-events from family_members + special_dates
- [ ] Free/busy queries
- [ ] `src/lib/calendar-sync.ts` - Google Calendar incremental sync (optional)
- [ ] Scheduled reminders table (migration)
- [ ] `src/lib/scheduler.ts` - Persistent scheduler with node-schedule
- [ ] `src/app/api/reminders/route.ts` - Reminder CRUD
- [ ] `set_reminder` tool
- [ ] Reminder snooze support
- [ ] Morning briefing scheduled job
- [ ] Tiered context injection rewrite
- [ ] Prompt structure for cache optimization

---

## Phase 3: Household Features + Skills

**Goal:** Grocery, activities, chores, meals, and the extensible skill system.

### 3.1 Grocery List

**New table:**
```sql
CREATE TABLE grocery_items (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit TEXT,
  category TEXT,
  added_by TEXT,
  completed INTEGER DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (added_by) REFERENCES family_members(id)
);
```

**Features:**
- Voice/text CRUD: "Add milk to grocery list", "Mark milk as done"
- Deduplication: Normalize (lowercase, trim, singularize), fuzzy match existing items, merge quantities
- Category auto-detection: keyword mapping (milk → dairy, apple → produce)
- `manage_grocery` tool

### 3.2 Kids' Activities & School Schedule

**New files:**
- `src/app/api/activities/route.ts` - Recurring activities CRUD
- `src/components/activity-schedule.tsx` - Weekly schedule view

**Features:**
- Store recurring activities: "Emma has swimming Monday and Wednesday 4-5pm"
- **Activity-to-calendar sync lifecycle:**
  1. Activity created → generate calendar events for next 4 weeks
  2. Activity changed → update future events
  3. Activity cancelled (series) → delete future events
  4. Activity cancelled (single) → exception list
  5. Weekly job → extend events 4 weeks forward
- Multi-child conflict detection: Flag overlapping activities with different locations
- Voice: "What does Noah have today?"
- `manage_activity` tool

### 3.3 Chore Assignment

**New files:**
- `src/app/api/chores/route.ts`
- `src/components/chore-board.tsx`

**Features:**
- Assign chores to family members
- Recurring chores (daily, weekly)
- Points/stars for children
- Parent verification flow: Push notification "Emma says she cleaned her room. Approve?"
- Auto-approve after 24 hours (configurable)
- Voice: "Did Emma set the table?" → mark complete, award points
- `manage_chore` tool

### 3.4 Meal Planning

**New table:**
```sql
CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
  recipe TEXT NOT NULL,
  ingredients TEXT,               -- JSON array
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
```

**Features:**
- Plan meals: "Monday dinner is pasta"
- Auto-add ingredients to grocery list
- Voice: "What's for dinner tonight?"
- Dietary restriction warnings from `family_members.dietary_restrictions`
- `manage_meals` tool

### 3.5 Extensible Skill System (Major Feature)

**New tables:**
```sql
CREATE TABLE skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,              -- 'web_scraper','api_caller','scheduled','data_lookup','composite'
  trigger_phrases TEXT NOT NULL,   -- JSON array
  config TEXT NOT NULL,            -- JSON config object
  schedule TEXT,                   -- cron expression (nullable)
  is_active INTEGER DEFAULT 1,
  created_by TEXT,
  last_used_at INTEGER,
  use_count INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (created_by) REFERENCES family_members(id)
);

CREATE TABLE skill_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL,
  executed_at INTEGER DEFAULT (unixepoch()),
  result TEXT,
  success INTEGER DEFAULT 1,
  error TEXT,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
);
```

**Skill types:**
| Type | How it works | Example |
|------|-------------|---------|
| Web Scraper | `fetch(url)` + LLM extracts info from HTML | School lunch menu |
| API Caller | `fetch(endpoint)` with configured params | Weather |
| Scheduled | Base skill + cron schedule + notification | Check menu every Monday |
| Data Lookup | Query local DB with configured logic | "What chores did Emma do this week?" |
| Composite | Chain multiple skills | Check menu → conditionally add to grocery |

**Voice creation flow:**
```
"Jarvis, learn a new skill"
→ "What should I learn?"
"Check school lunch menu from mountainview.schoolcafe.org"
→ LLM generates config JSON → stored in skills table
→ "When should I check?"
"Every Monday at 7am"
→ Creates scheduled variant → registered with scheduler
→ "Done! Ask 'What's for lunch at school?' anytime"
```

**Runtime matching:** When user message doesn't match built-in tools, fuzzy-match against all active skill trigger_phrases. Execute matching skill, pass result through LLM for natural response.

**Security:**
- Only parents can create/delete skills
- Config-driven (no arbitrary code execution)
- Rate limit: max 1 fetch per hour per URL
- API keys referenced as `{{KEY_NAME}}` from settings table
- `manage_skill` tool

### Phase 3 Checklist

- [ ] Grocery items table (migration) + API route + tool + deduplication
- [ ] Activities API route + calendar sync lifecycle
- [ ] Multi-child activity conflict detection
- [ ] Chore API route + points system + parent verification
- [ ] Meal plans table (migration) + API route + tool + dietary warnings
- [ ] Skills table + skill_logs table (migration)
- [ ] `src/app/api/skills/route.ts` - Skills CRUD
- [ ] Web scraper skill execution
- [ ] API caller skill execution
- [ ] Scheduled skill registration with scheduler
- [ ] Voice-based skill creation flow
- [ ] Skill trigger phrase matching engine
- [ ] `manage_skill` tool

---

## Phase 4: Intelligence

**Goal:** Semantic search, episodic memory, smart context.

### 4.1 Vector Search

**New dependency:** `sqlite-vec` (SQLite extension)

**New table:**
```sql
CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
```

**Approach:**
- Generate embeddings via Euri's embedding API (free within daily limit, already in `euri-client.ts`)
- Store in `memory_embeddings` as BLOB
- Search via `sqlite-vec` cosine similarity
- Hybrid scoring: vector similarity + keyword match + importance + recency
- Generate embeddings ASYNC via background worker (non-blocking)
- Cache: Never re-embed unchanged content (hash check)
- Fallback: If sqlite-vec fails to load (Windows), use keyword search only

### 4.2 Episodic Memory

**New table:**
```sql
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  details TEXT,
  family_member_id TEXT,
  session_id TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
```

**Features:**
- Log every significant interaction as episode
- Conversation summaries after each session
- Pattern detection: "You usually go grocery shopping on Saturdays"
- Learning from corrections: Update memory + log correction episode

### 4.3 Smart Context Builder

Combine all intelligence:
1. Embed user's current message
2. Find top 5 semantically similar memories
3. Check today's calendar for time-relevant events
4. Check pending tasks with approaching due dates
5. Build compact context (~200-400 tokens)

### Phase 4 Checklist

- [ ] `src/lib/embeddings.ts` - Embedding generation via Euri API
- [ ] sqlite-vec extension integration
- [ ] memory_embeddings table (migration)
- [ ] Hybrid search: vector + keyword + importance + recency
- [ ] Background embedding worker
- [ ] Episodes table (migration)
- [ ] `src/lib/episodes.ts` - Episode logging + pattern extraction
- [ ] Smart context builder rewrite

---

## Phase 5: Dashboard + PWA

**Goal:** Visual dashboard, mobile installability, push notifications.

### 5.1 Dashboard

**New files:**
- `src/app/dashboard/page.tsx`
- `src/components/dashboard/calendar-widget.tsx`
- `src/components/dashboard/tasks-widget.tsx`
- `src/components/dashboard/grocery-widget.tsx`
- `src/components/dashboard/family-status.tsx`
- `src/components/dashboard/skills-widget.tsx`

**Layout:**
```
+--------------------------------------------------+
| JARVIS    [Family: Smith] [Active: Mom] [Settings]|
+--------------------------------------------------+
| Today's Schedule (day|week|month) | Active Tasks  |
| - 8:00 School drop              | [ ] Groceries  |
| - 10:00 Dentist                  | [ ] Fix sink   |
| - 15:30 Emma swim                | [ ] Homework   |
+----------------------------------+----------------+
| Grocery List          | This Week's Meals         |
| [ ] Milk (2)          | Mon: Pasta                |
| [ ] Bread (1)         | Tue: Grilled chicken      |
+----------------------------------+----------------+
| Skills: 3 active      | Chat / Voice Input        |
| School Lunch (Mon 7am)| [Type a message...] [Send]|
+--------------------------------------------------+
```

**Features:**
- Day/week/month calendar view toggle
- Holiday display
- Skills management (list, enable/disable, test)
- Empty state guidance for first-run
- Responsive for tablet/phone

### 5.2 PWA

**New dependency:** `@serwist/next` (NOT next-pwa which is abandoned)

**New files:**
- `public/manifest.json`
- `public/sw.js` - Service worker
- `src/app/layout.tsx` - Manifest link + SW registration

**Features:**
- Install as app on phone/tablet
- Push notifications for reminders (via `web-push` VAPID)
- Offline caching: App shell, grocery list, calendar cache, tasks
- iOS note: Push only works on iOS 16.4+ when added to Home Screen

**Offline feature matrix:**

| Feature | Offline? |
|---------|----------|
| View grocery list | Yes |
| Add grocery item | Yes (queued) |
| View calendar (cached) | Yes |
| Create calendar event | Local only |
| Voice chat | No |
| Text chat | No |
| View tasks | Yes |
| Reminders (in-app) | Yes |

### 5.3 Response Streaming

**Modify:** `src/app/api/chat/route.ts` + `src/app/page.tsx`

Use Euri streaming mode + SSE in API route + incremental rendering in UI.

### Phase 5 Checklist

- [ ] Dashboard page + all widget components
- [ ] Calendar day/week/month toggle
- [ ] Skills management UI
- [ ] Holiday display
- [ ] Empty state / onboarding guidance
- [ ] PWA manifest + service worker via Serwist
- [ ] Web push notification setup
- [ ] Offline caching strategy
- [ ] Response streaming for text chat

---

## Phase 6: Performance & Polish

**Goal:** Token optimization, audio improvements, reliability.

### 6.1 Token Budget Management

**New file:** `src/lib/token-budget.ts`

```
System prompt base:     400 tokens (fixed)
Family context:          50 tokens (always)
Relevant memories:      300 tokens (max 8)
Calendar context:       200 tokens (when relevant)
Chat history:           400 tokens (last N, summarize older)
User message:           200 tokens
---
TOTAL BUDGET:         1,550 tokens input max
```

Trim order: chat history → calendar → memories → never trim system prompt.

### 6.2 Model Routing

```
Simple queries (calendar, timer, grocery) → gemini-2.5-flash-lite
General chat → gemini-2.5-flash
Complex reasoning → gemini-2.5-pro
Voice → gpt-4o-mini-realtime
```

### 6.3 AudioWorklet Migration

Replace deprecated `ScriptProcessorNode` with `AudioWorkletProcessor` for main-thread audio processing relief.

### 6.4 WebSocket Auto-Reconnect

On non-intentional WebSocket close: auto-reconnect with exponential backoff, max 3 retries, visual indicator during reconnection.

### 6.5 Rate Limiting

Check daily token usage against configurable budget before each LLM call.

### 6.6 Background Workers

- Calendar sync (triggered, not polling)
- Reminder evaluation (every 30s)
- Episode summarization (after session)
- Embedding generation (queue-based)
- Recurring event extension (weekly)
- Database backup (daily at 3am, keep last 7)

### Phase 6 Checklist

- [ ] Token budget enforcement
- [ ] Model routing logic
- [ ] AudioWorklet migration
- [ ] WebSocket auto-reconnect
- [ ] Rate limiting
- [ ] Background worker system
- [ ] Daily database backup

---

## Complete Tool List (14 built-in + unlimited skills)

| # | Tool | Phase | Description |
|---|------|-------|-------------|
| 1 | `save_memory` | Exists | Persist information to memory |
| 2 | `recall_memory` | Exists | Search memory |
| 3 | `manage_task` | Exists | Task CRUD |
| 4 | `get_family` | 2 | List family members |
| 5 | `get_calendar` | 2 | Read calendar events |
| 6 | `create_event` | 2 | Create calendar event |
| 7 | `update_event` | 2 | Modify event |
| 8 | `delete_event` | 2 | Cancel event (single/series) |
| 9 | `set_reminder` | 2 | Create alarm/reminder |
| 10 | `manage_grocery` | 3 | Grocery list CRUD |
| 11 | `manage_activity` | 3 | Kids' activity CRUD |
| 12 | `manage_chore` | 3 | Chore assignment + points |
| 13 | `manage_meals` | 3 | Meal planning CRUD |
| 14 | `manage_skill` | 3 | Create/manage custom skills |

---

## Complete Database Schema (16 tables)

| Table | Phase | Purpose |
|-------|-------|---------|
| `schema_version` | 1 | Migration tracking |
| `family_members` | 1 | Family profiles + PIN + birthday |
| `memories` | 1 | Long-term memory (replaces JSON) |
| `tasks` | 1 | Task management (replaces JSON) |
| `usage_logs` | 1 | Cost tracking (replaces JSON) |
| `settings` | 1 | Key-value config store |
| `calendar_events` | 2 | Local-first calendar |
| `calendar_event_attendees` | 2 | Multi-person events |
| `special_dates` | 2 | Birthdays, anniversaries |
| `scheduled_reminders` | 2 | Persistent reminders |
| `grocery_items` | 3 | Shared grocery list |
| `meal_plans` | 3 | Weekly meal plans |
| `skills` | 3 | Custom skills/plugins |
| `skill_logs` | 3 | Skill execution logs |
| `memory_embeddings` | 4 | Vector search embeddings |
| `episodes` | 4 | Episodic memory log |

---

## Dependencies

### Add
| Package | Phase | Size |
|---------|-------|------|
| `better-sqlite3` | 1 | ~2MB |
| `zod` | 1 | ~50KB |
| `node-schedule` | 2 | ~50KB |
| `rrule` | 2 | ~30KB |
| `googleapis` | 2 | ~15MB (tree-shakeable) |
| `web-push` | 2 | ~100KB |
| `sqlite-vec` | 4 | ~5MB |
| `@serwist/next` | 5 | ~200KB |

### Remove
`framer-motion`, `remark-gfm`, `tailwind-merge`

### Keep (for future use)
`zustand` (dashboard state), `react-markdown` (formatted responses)

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite migration corrupts data | HIGH | Transaction-wrapped migration, JSON backups for 30 days |
| Google OAuth token expires | MEDIUM | Refresh token rotation, alert user if re-auth needed |
| Scheduler jobs lost on restart | MEDIUM | Persist in DB, reload on startup |
| PII slips through redaction | MEDIUM | Accept imperfection for V1, log redaction hits for audit |
| sqlite-vec fails on Windows | MEDIUM | Fallback to keyword search |
| Web scraper skills blocked | LOW | Rate limit 1/hour/URL, cache results |
| Token budget exceeded | LOW | Hard cap at 1550 tokens, truncate oldest context |

---

## Files Summary

### New Files (Phase 1: 6, Phase 2: 8, Phase 3: 8, Phase 4: 2, Phase 5: 8, Phase 6: 2)

**Phase 1 (6 new):**
```
src/lib/db.ts                    - Database init + migrations
src/lib/pii-redactor.ts          - PII detection + redaction
src/lib/llm-middleware.ts         - Unified LLM call pipeline
src/lib/tool-executor.ts         - Tool registry + executor
src/lib/events.ts                - Event bus
src/lib/validators.ts            - Zod schemas for all routes
```

**Phase 2 (8 new):**
```
src/app/api/family/route.ts      - Family member CRUD
src/app/api/calendar/route.ts    - Calendar CRUD
src/app/api/calendar/sync/route.ts - Google Calendar sync
src/app/api/reminders/route.ts   - Reminder CRUD
src/lib/scheduler.ts             - Persistent scheduler
src/lib/calendar-sync.ts         - Google Calendar client
src/components/family-setup.tsx   - Setup wizard
src/components/family-switcher.tsx - Member switcher
```

**Phase 3 (8 new):**
```
src/app/api/grocery/route.ts     - Grocery CRUD
src/app/api/activities/route.ts  - Activities CRUD
src/app/api/chores/route.ts      - Chore management
src/app/api/meals/route.ts       - Meal planning
src/app/api/skills/route.ts      - Skills CRUD
src/components/grocery-list.tsx   - Grocery UI
src/components/chore-board.tsx    - Chore UI
src/components/activity-schedule.tsx - Activities UI
```

**Phase 4 (2 new):**
```
src/lib/embeddings.ts            - Embedding generation
src/lib/episodes.ts              - Episodic memory
```

**Phase 5 (8 new):**
```
src/app/dashboard/page.tsx       - Dashboard
src/components/dashboard/calendar-widget.tsx
src/components/dashboard/tasks-widget.tsx
src/components/dashboard/grocery-widget.tsx
src/components/dashboard/family-status.tsx
src/components/dashboard/skills-widget.tsx
public/manifest.json             - PWA manifest
public/sw.js                     - Service worker
```

**Phase 6 (2 new):**
```
src/lib/token-budget.ts          - Token counting + budget
src/lib/background-worker.ts     - Background job runner
```

### Modified Files (8)
```
src/lib/memory.ts                - SQLite + vector search
src/lib/jarvis-context.ts        - Family-aware + per-role prompts
src/app/api/chat/route.ts        - Middleware + tools + streaming
src/app/api/ai/realtime-token/route.ts - Security fix + PII + new tools
src/app/api/tools/manage_task/route.ts - SQLite + Zod
src/app/api/tools/save_memory/route.ts - SQLite + Zod
src/app/api/tools/recall_memory/route.ts - SQLite + vector
src/app/api/usage/route.ts       - SQLite
src/hooks/useRealtimeVoice.ts    - Audio fix + queue cap
src/app/page.tsx                 - History cap + throttle + dashboard link
src/app/layout.tsx               - PWA manifest + SW registration
package.json                     - Dependencies
```

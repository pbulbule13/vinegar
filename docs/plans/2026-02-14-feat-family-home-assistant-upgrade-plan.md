---
title: "feat: Family Home Assistant - Full Upgrade to Robust Household Management System"
type: feat
date: 2026-02-14
---

# Family Home Assistant - Full Upgrade to Robust Household Management System

## Overview

Transform the existing Jarvis home voice/text assistant from a basic AI chat app into a **production-grade family household management system** with dedicated local database, PII protection, calendar integration, scheduling, reminders, and multi-member family coordination. The system serves parents managing household logistics and children (under 8) for learning and schedule awareness.

---

## Current State Analysis

### What Exists Today (Fully Audited)

| Feature | Status | Implementation | Gaps |
|---------|--------|---------------|------|
| **Voice Chat** | Working | OpenAI Realtime API (WebSocket, GPT-4o Mini) via `useRealtimeVoice.ts` | No wake word, no multi-user voice profiles |
| **Text Chat** | Working | Euri API (20+ models) via `/api/chat/route.ts` | No PII redaction, no tool calling in text mode |
| **Memory (3-tier)** | Partial | JSON file (`memory-data.json`) with short-term (in-memory), long-term (file), working (compiled) | No episodic memory, no vector search, no embeddings, flat file bottleneck, no backup/recovery |
| **Task Management** | Basic | JSON file (`tasks-data.json`) with CRUD via voice/text | No recurring tasks, no assignment to family members, no due date reminders, no calendar sync |
| **Settings** | Working | HTTP-only cookies for API keys via `/api/settings/route.ts` | No family member profiles, no per-user settings |
| **Cost Tracking** | Working | JSON file (`usage-data.json`) with per-session and daily cost | Voice-only tracking, text chat tokens not tracked |
| **System Prompt** | Working | `jarvis-context.ts` with personality and memory instructions | No family-aware context, no child-safe mode, no PII boundary instructions |
| **Model Selection** | Working | 20+ models via Euri in UI dropdown | Good as-is |
| **UI** | Working | Single-page orb + chat + text input | No dashboard, no calendar view, no task board, no family member switcher |

### Critical Architecture Issues Found

1. **No PII Protection** - All user data (names, addresses, routines, personal facts) is sent directly to cloud LLMs without any redaction
2. **Flat JSON Files** - `memory-data.json`, `tasks-data.json`, `usage-data.json` are all flat JSON files read/written synchronously. No transactions, no indexing, no concurrent safety, 500-entry hard cap on memory
3. **No Vector/Semantic Search** - Memory search is substring-based (`string.includes()`), no embeddings, no semantic similarity
4. **No Episodic Memory** - No time-series event logs, no conversation history persistence, no activity pattern tracking
5. **No Calendar Integration** - Zero calendar access despite being described as a "home assistant"
6. **No Scheduling/Reminders** - No cron jobs, no alarms, no proactive notifications
7. **No Family Member Awareness** - Single-user design, no concept of family members, roles, or per-person context
8. **No Tool Calling in Text Chat** - Voice mode has tools (save_memory, recall_memory, manage_task) but text chat route (`/api/chat/route.ts`) sends raw messages without tool support
9. **No Offline/Background Processing** - Everything is request-response, no background workers
10. **No Data Backup/Recovery** - JSON files can corrupt, no versioning, no export

---

## Proposed Solution - Phased Implementation

### Architecture Diagram

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
              +--------------+--------------+
              |              |              |
    +---------v----+ +------v------+ +-----v--------+
    | PII Gateway  | | Scheduler   | | Calendar     |
    | (Redact/     | | (node-      | | Sync Service |
    |  Rehydrate)  | |  schedule)  | | (Google/     |
    +---------+----+ +------+------+ |  CalDAV)     |
              |              |        +-----+--------+
              |              |              |
    +---------v--------------v--------------v--------+
    |              API Routes (Next.js)              |
    |  /api/chat  /api/tools/*  /api/calendar        |
    |  /api/family  /api/reminders  /api/grocery     |
    +------------------------+-----------------------+
                             |
    +------------------------v-----------------------+
    |            SQLite Database (local)             |
    |  +----------+ +----------+ +----------------+ |
    |  | Memories | | Tasks    | | Calendar Events| |
    |  | (long-   | | (with    | | (synced from   | |
    |  |  term)   | |  recur)  | |  Google/iCal)  | |
    |  +----------+ +----------+ +----------------+ |
    |  +----------+ +----------+ +----------------+ |
    |  | Episodes | | Family   | | Grocery Lists  | |
    |  | (time-   | | Members  | | Meal Plans     | |
    |  |  series) | | Profiles | | Chore Assign.  | |
    |  +----------+ +----------+ +----------------+ |
    |  +------------------------------------------+ |
    |  | Vector Embeddings (sqlite-vec extension) | |
    |  +------------------------------------------+ |
    +------------------------------------------------+
```

---

## Phase 1: Foundation - Database & PII Protection

**Priority: CRITICAL - Must be done first**

### 1.1 Migrate from JSON Files to SQLite

**Why:** JSON files have no indexing, no transactions, no concurrent safety, and a hard 500-entry cap. SQLite handles millions of rows, has ACID transactions, and runs locally with zero configuration.

**New dependency:** `better-sqlite3`

**Files to create/modify:**
- `src/lib/db.ts` (NEW) - Database initialization, schema, migrations
- `src/lib/memory.ts` - Rewrite to use SQLite instead of JSON files
- `src/lib/memory.ts` - TaskStore class migrated to SQLite

**Database Schema:**

```sql
-- src/lib/schema.sql

-- Family Members
CREATE TABLE family_members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('parent', 'child')),
  age INTEGER,
  voice_profile TEXT,         -- for future voice identification
  preferences TEXT,           -- JSON blob for per-member preferences
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Long-Term Memory (replaces memory-data.json)
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  content TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('fact', 'preference', 'routine', 'decision', 'person', 'conversation')),
  importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('low', 'medium', 'high')),
  tags TEXT,                  -- JSON array
  family_member_id TEXT,      -- who this memory is about (nullable for general)
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

-- Episodic Memory (NEW - time-series event logs)
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,   -- 'conversation', 'reminder_fired', 'task_completed', 'calendar_event', 'voice_session'
  summary TEXT NOT NULL,
  details TEXT,               -- JSON blob with full context
  family_member_id TEXT,
  session_id TEXT,            -- group events by conversation session
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_episodes_type ON episodes(event_type);
CREATE INDEX idx_episodes_created ON episodes(created_at);
CREATE INDEX idx_episodes_session ON episodes(session_id);

-- Vector Embeddings (for semantic search via sqlite-vec)
CREATE TABLE memory_embeddings (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,    -- float32 vector stored as blob
  model TEXT NOT NULL,        -- which embedding model produced this
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- Tasks (replaces tasks-data.json)
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  assigned_to TEXT,           -- family_member_id
  due_date INTEGER,           -- unix timestamp
  due_time TEXT,              -- HH:MM for time-specific tasks
  recurring TEXT,             -- JSON: { "type": "daily"|"weekly"|"monthly", "days": [1,3,5], "interval": 1 }
  category TEXT,              -- 'household', 'school', 'grocery', 'errand', 'appointment'
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (assigned_to) REFERENCES family_members(id)
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to);
CREATE INDEX idx_tasks_category ON tasks(category);

-- Calendar Events (synced from Google Calendar / manual)
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  external_id TEXT,           -- Google Calendar event ID
  title TEXT NOT NULL,
  description TEXT,
  start_time INTEGER NOT NULL,
  end_time INTEGER NOT NULL,
  all_day INTEGER DEFAULT 0,
  location TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('google', 'caldav', 'manual')),
  calendar_name TEXT,
  family_member_id TEXT,
  reminder_minutes INTEGER,   -- how many minutes before to remind
  reminder_sent INTEGER DEFAULT 0,
  recurring TEXT,             -- iCal RRULE string
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (family_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_cal_start ON calendar_events(start_time);
CREATE INDEX idx_cal_external ON calendar_events(external_id);
CREATE INDEX idx_cal_member ON calendar_events(family_member_id);

-- Grocery List
CREATE TABLE grocery_items (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  unit TEXT,                  -- 'kg', 'lbs', 'pcs', 'liters'
  category TEXT,              -- 'produce', 'dairy', 'meat', 'pantry', 'frozen', 'household'
  added_by TEXT,
  completed INTEGER DEFAULT 0,
  completed_at INTEGER,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (added_by) REFERENCES family_members(id)
);
CREATE INDEX idx_grocery_completed ON grocery_items(completed);
CREATE INDEX idx_grocery_category ON grocery_items(category);

-- Meal Plans
CREATE TABLE meal_plans (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,          -- YYYY-MM-DD
  meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe TEXT NOT NULL,
  ingredients TEXT,            -- JSON array
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_meals_date ON meal_plans(date);

-- Scheduled Reminders (for node-schedule persistence)
CREATE TABLE scheduled_reminders (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- 'one_time', 'daily', 'weekly', 'custom'
  message TEXT NOT NULL,
  cron_expression TEXT,        -- for recurring: "30 14 * * 1-5"
  next_fire_time INTEGER,
  target_member_id TEXT,
  source_type TEXT,            -- 'calendar', 'task', 'manual', 'alarm'
  source_id TEXT,              -- ID of calendar_event or task that created this
  is_active INTEGER DEFAULT 1,
  created_at INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (target_member_id) REFERENCES family_members(id)
);
CREATE INDEX idx_reminders_next ON scheduled_reminders(next_fire_time);
CREATE INDEX idx_reminders_active ON scheduled_reminders(is_active);

-- Usage Tracking (replaces usage-data.json)
CREATE TABLE usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,
  audio_input_tokens INTEGER DEFAULT 0,
  audio_output_tokens INTEGER DEFAULT 0,
  text_input_tokens INTEGER DEFAULT 0,
  text_output_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  source TEXT DEFAULT 'voice' CHECK(source IN ('voice', 'text')),
  created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX idx_usage_created ON usage_logs(created_at);

-- App Settings (key-value store for configuration)
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT (unixepoch())
);
```

**Migration Strategy:**
1. Create `src/lib/db.ts` with schema auto-creation on first run
2. Add a one-time migration function that reads existing JSON files and imports into SQLite
3. Keep JSON files as backup for 30 days, then remove

### 1.2 PII Redaction Gateway

**Why:** Currently ALL personal information (names, addresses, family details, routines) goes directly to cloud LLMs. This is a privacy risk, especially with children's information.

**Approach:** Lightweight regex-based PII detection with token-mapping and rehydration. No heavy Docker dependencies (Presidio is overkill for a home assistant).

**New dependency:** None (custom implementation using regex patterns)

**Files to create:**
- `src/lib/pii-redactor.ts` (NEW) - PII detection, tokenization, rehydration

**Implementation Pattern:**

```typescript
// src/lib/pii-redactor.ts

// 1. On app startup, load all family member names, addresses, phone numbers from DB
// 2. Build a dynamic regex pattern from known PII
// 3. Before sending ANY message to LLM:
//    - Replace known names with tokens: "Sarah" -> "<PERSON_1>"
//    - Replace phone numbers, emails, addresses with tokens
//    - Store mapping in session-scoped Map
// 4. After receiving LLM response:
//    - Replace tokens back with real values
//    - Return to user

// Key design decisions:
// - Family member names loaded from DB (not hardcoded)
// - Standard PII patterns (email, phone, SSN) via regex
// - Session-scoped mappings with 1-hour TTL
// - Works for BOTH voice and text chat paths
```

**Integration Points:**
- Modify `/api/chat/route.ts` - Wrap outgoing messages through redactor before Euri API call
- Modify `/api/ai/realtime-token/route.ts` - Redact system prompt memory context
- Modify `/api/tools/save_memory/route.ts` - Store original (unredacted) data locally
- Modify `/api/tools/recall_memory/route.ts` - Return unredacted data to local context

### 1.3 Add Tool Calling to Text Chat

**Why:** Voice mode has tools (save_memory, recall_memory, manage_task) but text chat sends raw messages without any tool support. This means text chat cannot create tasks, save memories, or recall information.

**Approach:** Implement a lightweight tool-calling loop in the text chat API route. Parse the LLM response for tool call intents and execute them server-side.

**Files to modify:**
- `src/app/api/chat/route.ts` - Add tool definitions to system prompt, implement tool execution loop
- `src/lib/jarvis-context.ts` - Add text-mode tool instructions to system prompt

**Token Optimization Note:** For text chat tool calling, use a structured approach:
- Include tool schemas in system prompt (one-time cost)
- Use JSON-mode responses for tool calls (smaller than function_call format)
- Limit tool call depth to 3 iterations per user message to prevent token spirals

---

## Phase 2: Family Awareness & Calendar

### 2.1 Family Member Profiles

**Files to create:**
- `src/app/api/family/route.ts` (NEW) - CRUD for family members
- `src/components/family-setup.tsx` (NEW) - First-run family setup wizard
- `src/components/family-switcher.tsx` (NEW) - Quick switcher in header

**Features:**
- First-run wizard: "Who's in your family?" - Add names, roles (parent/child), ages
- Voice/text can say "This is [name]" to switch active family member
- Per-member memory context (Jarvis remembers each person's preferences separately)
- Child-safe mode: When a child is the active user, filter responses for age-appropriateness
- No login/auth required (home network trust model) - just name-based switching

### 2.2 Google Calendar Integration

**New dependencies:** `googleapis`, `next-auth` (for OAuth)

**Files to create:**
- `src/lib/calendar.ts` (NEW) - Google Calendar API client
- `src/app/api/calendar/route.ts` (NEW) - Calendar CRUD endpoints
- `src/app/api/calendar/sync/route.ts` (NEW) - Pull events from Google Calendar into local DB
- `src/app/api/auth/[...nextauth]/route.ts` (NEW) - OAuth handler for Google

**Features:**
- One-time Google OAuth setup (stored refresh token in SQLite settings table)
- Periodic sync: Pull events every 15 minutes into local `calendar_events` table
- Two-way: Create events from voice/text ("Add dentist appointment Friday 3pm")
- Family member association: "Add Emma's swimming class Tuesday 4pm"
- Voice tool: `get_calendar` and `create_event` added to voice/text tool set

**Token Optimization:** Calendar context is injected into system prompt ONLY when:
- User asks about schedule/calendar/events
- It's within 2 hours of a calendar event (proactive reminder)
- Not on every single message (saves ~200-500 tokens per call)

### 2.3 Scheduling & Reminder Engine

**New dependency:** `node-schedule`

**Files to create:**
- `src/lib/scheduler.ts` (NEW) - Persistent scheduling engine
- `src/app/api/reminders/route.ts` (NEW) - Reminder CRUD

**Features:**
- On app startup: Load all active reminders from `scheduled_reminders` table, register with node-schedule
- Calendar-driven reminders: Auto-create reminder X minutes before each calendar event
- Task-driven reminders: Auto-create reminder for tasks with due dates
- Voice/text commands: "Remind me to pick up groceries at 5pm"
- Alarm support: "Set an alarm for 6:30am weekdays" (creates daily recurring reminder)
- Reminder delivery methods:
  1. **Browser notification** (web-push via service worker)
  2. **Voice announcement** (Web Speech API in browser, or say.js on server)
  3. **Visual alert** in the Jarvis UI (toast notification)
- Morning briefing: At configurable time, Jarvis proactively announces today's schedule

### 2.4 Proactive Context Injection (Token-Optimized)

**Why:** Currently Jarvis injects ALL memory context on every call. This wastes tokens and reduces response quality.

**New approach - Tiered Context Injection:**

```
Level 0 (Always): Family member names + active user (tiny, ~50 tokens)
Level 1 (Relevant): Memories matching query keywords (scored, max 8 entries)
Level 2 (Time-based): Today's calendar events + upcoming reminders (only within 2hr window)
Level 3 (On-demand): Full memory dump (only when user asks "what do you know about X")
```

**Files to modify:**
- `src/lib/memory.ts` - Rewrite `getMemoryContext()` to use tiered approach
- `src/lib/jarvis-context.ts` - Restructure system prompt with sections that can be toggled

**Estimated token savings:** 40-60% reduction in system prompt size per call

---

## Phase 3: Household Management Features

### 3.1 Grocery List Management

**Files to create:**
- `src/app/api/grocery/route.ts` (NEW) - Grocery list CRUD
- `src/components/grocery-list.tsx` (NEW) - UI component

**Voice/text commands:**
- "Add milk to the grocery list"
- "Add 2kg chicken to grocery"
- "What's on the grocery list?"
- "Mark milk as done"
- "Clear completed grocery items"

**Tool definition for voice/text:**
```json
{
  "name": "manage_grocery",
  "description": "Add, remove, list, or complete items on the shared family grocery list",
  "parameters": {
    "action": "add | remove | list | complete | clear_completed",
    "item": "Item name",
    "quantity": "Number (default 1)",
    "category": "produce | dairy | meat | pantry | frozen | household"
  }
}
```

### 3.2 Kids' School Schedule & Activity Tracker

**Files to create:**
- `src/app/api/activities/route.ts` (NEW) - Kids' recurring activities CRUD
- `src/components/activity-schedule.tsx` (NEW) - Weekly schedule view

**Features:**
- Store recurring activities: "Emma has swimming Monday and Wednesday 4-5pm"
- Auto-create calendar events and reminders from activities
- School schedule: Define school hours per child, auto-remind for pickup
- Class/homework tracking: "Emma has math homework due Friday"
- Voice queries: "What does Noah have today?" "When is Emma's next swimming class?"

### 3.3 Chore Assignment System

**Files to create:**
- `src/app/api/chores/route.ts` (NEW) - Chore CRUD with assignment
- `src/components/chore-board.tsx` (NEW) - Visual chore board

**Features:**
- Create chores: "Add 'set table' as a daily chore for Emma"
- Assign chores to family members (parents or children)
- Recurring chores (daily, weekly)
- Points/stars system for children (gamification)
- Voice: "Did Emma set the table?" -> mark complete, award points
- Weekly chore summary

### 3.4 Meal Planning

**Files to create:**
- `src/app/api/meals/route.ts` (NEW) - Meal plan CRUD
- `src/components/meal-planner.tsx` (NEW) - Weekly meal grid

**Features:**
- Plan meals for the week: "Monday dinner is pasta"
- Auto-add ingredients to grocery list
- Voice: "What's for dinner tonight?" (looks up today's meal plan)
- Suggest meals based on past preferences (via memory)

---

## Phase 4: Vector Search & Learning

### 4.1 Embedding-Based Semantic Memory Search

**New dependency:** `sqlite-vec` (extension for better-sqlite3)

**Files to create/modify:**
- `src/lib/embeddings.ts` (NEW) - Embedding generation via Euri API
- `src/lib/memory.ts` - Add semantic search method using vector similarity

**How it works:**
1. When a memory is saved, generate an embedding via Euri's `gemini-embedding-001` model
2. Store the embedding in `memory_embeddings` table as a BLOB
3. When searching memory, embed the query and find nearest neighbors via `vec_distance()`
4. Combine vector similarity score with existing keyword + importance + recency scoring

**Token Optimization:** Embeddings are generated once per memory entry (not on every query). The Euri embedding API is free within the 200K token/day limit. Each embedding call uses ~10-50 tokens.

### 4.2 Episodic Memory & Pattern Learning

**Files to create:**
- `src/lib/episodes.ts` (NEW) - Episodic memory logging and pattern extraction

**Features:**
- Log every significant interaction as an episode (conversation summaries, tasks completed, reminders fired)
- Weekly pattern analysis: "You usually go grocery shopping on Saturdays"
- Seasonal awareness: "Last winter you set the thermostat to 72"
- Learning from corrections: "Actually, Emma's class is at 4:30 not 4:00" -> update memory + log correction episode
- Conversation summarization: After each voice/text session, generate a 1-sentence summary and store as episode

### 4.3 Smart Context Building

**Files to modify:**
- `src/lib/memory.ts` - New `buildSmartContext()` method

**How it works:**
1. Embed the user's current message
2. Find top 5 semantically similar memories
3. Check today's calendar for time-relevant events
4. Check pending tasks with approaching due dates
5. Combine into a compact context block (~200-400 tokens)
6. Inject into system prompt ONLY when relevant

---

## Phase 5: Enhanced UI Dashboard

### 5.1 Dashboard Layout

**Files to create:**
- `src/app/dashboard/page.tsx` (NEW) - Family dashboard
- `src/components/dashboard/calendar-widget.tsx` (NEW)
- `src/components/dashboard/tasks-widget.tsx` (NEW)
- `src/components/dashboard/grocery-widget.tsx` (NEW)
- `src/components/dashboard/family-status.tsx` (NEW)

**Layout:**
```
+--------------------------------------------------+
| JARVIS          [Family: Smith]  [Settings] [Orb] |
+--------------------------------------------------+
|  Today's Schedule     |  Active Tasks             |
|  - 8:00 School drop   |  [ ] Buy groceries       |
|  - 10:00 Dentist       |  [ ] Fix kitchen sink    |
|  - 15:30 Emma swim     |  [ ] Emma homework       |
|  - 18:00 Dinner prep   |                          |
+------------------------+--------------------------+
|  Grocery List          |  This Week's Meals       |
|  [ ] Milk (2)          |  Mon: Pasta              |
|  [ ] Bread (1)         |  Tue: Grilled chicken    |
|  [ ] Chicken (2kg)     |  Wed: Tacos              |
+------------------------+--------------------------+
|  Chat / Voice Input                               |
|  [Type a message...                    ] [Send]   |
+--------------------------------------------------+
```

### 5.2 Progressive Web App (PWA)

**Files to create:**
- `public/manifest.json` (NEW) - PWA manifest
- `public/sw.js` (NEW) - Service worker for notifications and offline
- `src/app/layout.tsx` - Add manifest link and service worker registration

**Features:**
- Install as app on phone/tablet
- Receive push notifications for reminders
- Offline access to cached data (last-known schedule, grocery list)

---

## Phase 6: Performance & Token Optimization

### 6.1 Token Budget Management

**Files to create:**
- `src/lib/token-budget.ts` (NEW) - Token counting and budget allocation

**Strategy:**
- System prompt base: ~400 tokens (personality + rules)
- Memory context: Budget 300 tokens max (tiered injection)
- Calendar context: Budget 200 tokens max (only when relevant)
- User message history: Keep last 10 messages in text chat, last 5 in voice
- Total per-call budget target: ~1000-1500 tokens input

**Optimization techniques:**
1. **Compress memory entries**: Store as "topic: content" not full objects
2. **Lazy context loading**: Only inject calendar/tasks when keywords detected
3. **Summarize old messages**: After 10 messages, summarize older ones into a single context entry
4. **Model routing**: Use fast/cheap models for simple queries, smart models for complex ones
5. **Cache embeddings**: Don't re-embed unchanged memories

### 6.2 Response Streaming

**Files to modify:**
- `src/app/api/chat/route.ts` - Implement SSE streaming for text responses
- `src/app/page.tsx` - Handle streaming responses in UI

**Why:** Currently the entire response is buffered before display. Streaming shows tokens as they arrive, making the assistant feel faster.

### 6.3 Background Sync Workers

**Files to create:**
- `src/lib/background-worker.ts` (NEW) - Background task runner

**Jobs:**
- Calendar sync (every 15 minutes)
- Reminder evaluation (every 1 minute)
- Episode summarization (after session ends)
- Embedding generation (queue-based, non-blocking)

---

## Implementation Priority Order

```
Week 1-2: Phase 1 (Database + PII + Text Tools)
  - 1.1 SQLite migration
  - 1.2 PII redaction gateway
  - 1.3 Text chat tool calling

Week 3-4: Phase 2 (Family + Calendar + Reminders)
  - 2.1 Family member profiles
  - 2.2 Google Calendar integration
  - 2.3 Scheduling engine
  - 2.4 Tiered context injection

Week 5-6: Phase 3 (Household Features)
  - 3.1 Grocery list
  - 3.2 School schedule tracker
  - 3.3 Chore board
  - 3.4 Meal planning

Week 7-8: Phase 4 (Intelligence)
  - 4.1 Vector search
  - 4.2 Episodic memory
  - 4.3 Smart context building

Week 9-10: Phase 5 (UI + PWA)
  - 5.1 Dashboard
  - 5.2 PWA setup

Ongoing: Phase 6 (Performance)
  - Token optimization applied throughout
  - Streaming added early (Week 2)
```

---

## New Dependencies

| Package | Purpose | Size |
|---------|---------|------|
| `better-sqlite3` | Local SQLite database | ~2MB |
| `node-schedule` | Persistent scheduling/cron | ~50KB |
| `googleapis` | Google Calendar API | ~15MB (tree-shakeable) |
| `next-auth` | OAuth for Google Calendar | ~200KB |
| `web-push` | Browser push notifications | ~100KB |
| `sqlite-vec` | Vector search extension | ~5MB |

**Total new dependencies:** ~22MB (all run locally, no cloud services)

---

## Acceptance Criteria

### Functional Requirements
- [ ] All data stored in SQLite (no JSON files)
- [ ] PII (names, phone numbers, emails, addresses) never sent to cloud LLMs
- [ ] Text chat has same tool capabilities as voice chat
- [ ] Family members can be added and switched
- [ ] Google Calendar events sync to local DB
- [ ] Reminders fire via notification + voice at configured times
- [ ] "What's on the schedule today?" returns calendar events
- [ ] "Add milk to grocery list" works via voice and text
- [ ] "Set alarm for 6:30am weekdays" creates recurring reminder
- [ ] "What does Emma have tomorrow?" returns child's activities
- [ ] Memory search uses semantic similarity (not just substring)
- [ ] System learns from corrections and patterns over time
- [ ] Dashboard shows today's schedule, tasks, grocery list at a glance

### Non-Functional Requirements
- [ ] Average system prompt size < 1500 tokens (currently unbounded)
- [ ] Memory search returns results in < 100ms (currently O(n) scan)
- [ ] Calendar sync completes in < 5 seconds
- [ ] App starts and scheduler initializes in < 3 seconds
- [ ] All data stays on local machine (zero cloud data storage)
- [ ] Database backup exportable as single `.db` file
- [ ] Works on home WiFi without internet (degraded mode - no LLM, but local data accessible)

---

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|------------|
| SQLite migration corrupts existing data | HIGH | Keep JSON backups for 30 days, test migration on copy first |
| Google OAuth token expires | MEDIUM | Implement refresh token rotation, alert user if re-auth needed |
| node-schedule jobs lost on server restart | MEDIUM | Persist all schedules in DB, reload on startup |
| PII redaction misses edge cases | HIGH | Start with known family names (from DB), add regex for common patterns, log redaction hits for review |
| Token budget exceeded on complex queries | LOW | Hard cap at 2000 tokens input, truncate oldest context first |
| sqlite-vec not available on Windows | MEDIUM | Fallback to keyword search if extension fails to load |

---

## Files Changed Summary

### New Files (22)
```
src/lib/db.ts                              - Database initialization
src/lib/pii-redactor.ts                    - PII detection & redaction
src/lib/scheduler.ts                       - Reminder scheduling engine
src/lib/calendar.ts                        - Google Calendar client
src/lib/embeddings.ts                      - Embedding generation
src/lib/episodes.ts                        - Episodic memory logging
src/lib/token-budget.ts                    - Token counting & budget
src/lib/background-worker.ts               - Background job runner
src/app/api/family/route.ts                - Family member CRUD
src/app/api/calendar/route.ts              - Calendar CRUD
src/app/api/calendar/sync/route.ts         - Calendar sync from Google
src/app/api/auth/[...nextauth]/route.ts    - OAuth handler
src/app/api/reminders/route.ts             - Reminder CRUD
src/app/api/grocery/route.ts               - Grocery list CRUD
src/app/api/activities/route.ts            - Kids activities CRUD
src/app/api/chores/route.ts                - Chore management
src/app/api/meals/route.ts                 - Meal planning
src/app/dashboard/page.tsx                 - Dashboard page
src/components/family-setup.tsx            - First-run setup wizard
src/components/family-switcher.tsx         - Family member switcher
src/components/grocery-list.tsx            - Grocery list UI
src/components/chore-board.tsx             - Chore board UI
```

### Modified Files (8)
```
src/lib/memory.ts                          - SQLite + vector search
src/lib/jarvis-context.ts                  - Family-aware system prompt
src/app/api/chat/route.ts                  - PII + tools + streaming
src/app/api/ai/realtime-token/route.ts     - PII + new tools
src/app/api/tools/manage_task/route.ts     - SQLite backend
src/app/api/tools/save_memory/route.ts     - SQLite backend
src/app/api/tools/recall_memory/route.ts   - SQLite + vector search
src/app/api/usage/route.ts                 - SQLite backend
```

### New Tool Definitions (added to voice + text)
```
manage_grocery    - Grocery list CRUD
get_calendar      - Read calendar events
create_event      - Create calendar event
manage_activity   - Kids' activity CRUD
manage_chore      - Chore assignment CRUD
set_reminder      - Create alarm/reminder
get_family        - List family members
```

---

## References

### Internal
- `src/lib/memory.ts:59-284` - Current MemoryStore (to be rewritten)
- `src/lib/memory.ts:289-338` - Current TaskStore (to be rewritten)
- `src/app/api/chat/route.ts:14-94` - Current text chat (no tools)
- `src/lib/jarvis-context.ts:6-86` - Current system prompt (single-user)
- `src/app/api/ai/realtime-token/route.ts:33-76` - Current voice tools

### External Research
- SQLite via better-sqlite3: synchronous API, ACID transactions, better-sqlite3 v12.6.2
- sqlite-vec: Pure C vector extension, successor to sqlite-vss, cross-platform
- PII Redaction: Deterministic tokenization with session-scoped mapping, regex-based for home use
- Google Calendar API v3: Stable, not deprecated, OAuth with offline refresh tokens
- node-schedule: Flexible time-based scheduling, RecurrenceRule for weekly patterns
- Web Push: VAPID-based, works on all modern browsers including iOS 16.4+ PWA

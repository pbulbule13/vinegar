---
title: "Family Home Assistant - Brainstorm & Gap Analysis"
date: 2026-02-14
status: complete
---

# Family Home Assistant - Brainstorm & Gap Analysis

## What We Have vs What We Need

### EXISTING: Basic AI Chat App
- Single-user voice + text chat
- Flat JSON file storage (500 entry cap)
- Substring-based memory search
- No calendar, no reminders, no family awareness
- No PII protection

### TARGET: Robust Family Household Management System
- Multi-member family with parents + children under 8
- Talk assistant with voice + text
- Home calendar access with reminders/alarms
- Dedicated local database (short-term, long-term, episodic, vector)
- Learn and track activities over time
- Zero PII leakage to cloud LLMs
- Coordinate household: groceries, meals, chores, school schedules

---

## Complete Gap Analysis

### GAP 1: Data Storage - CRITICAL
**Current:** 3 flat JSON files (`memory-data.json`, `tasks-data.json`, `usage-data.json`) read/written synchronously. Hard cap at 500 memory entries.
**Need:** Proper database with indexing, transactions, concurrent safety, and unlimited growth.
**Solution:** SQLite via `better-sqlite3` - single file, zero config, runs locally, ACID compliant.
**Effort:** HIGH - Requires rewriting `memory.ts` and all API routes that read/write data.

### GAP 2: PII Protection - CRITICAL
**Current:** ALL personal information sent directly to Euri and OpenAI APIs. Family names, addresses, routines, children's school info - everything goes to cloud.
**Need:** No personal information should reach any LLM. All PII must be redacted before API calls and rehydrated after responses.
**Solution:** Local PII gateway with regex-based detection + deterministic token mapping. Load family names from DB to build dynamic patterns.
**Effort:** MEDIUM - New module + integration into chat and voice routes.

### GAP 3: No Family Member Awareness - CRITICAL
**Current:** Single-user design. System prompt says "the user" with no concept of who is speaking.
**Need:** Know each family member (parents, kids), their preferences, schedules, and context.
**Solution:** Family member profiles in DB + active member switcher + per-member memory context.
**Effort:** MEDIUM - New DB table, API route, UI component, context injection changes.

### GAP 4: No Calendar Integration - HIGH
**Current:** Zero calendar access. Cannot answer "What's on today?"
**Need:** Access to family calendar. Create/read events. Know about school schedules, appointments, activities.
**Solution:** Google Calendar API with OAuth + local event cache in SQLite. Sync every 15 min.
**Effort:** HIGH - OAuth setup, API client, sync engine, new tools for voice/text.

### GAP 5: No Reminders/Alarms/Scheduling - HIGH
**Current:** No proactive notifications. Jarvis only responds when spoken to.
**Need:** Alarm for school mornings, reminder for grocery shopping, notification before appointments.
**Solution:** `node-schedule` with SQLite persistence. Reminders reload on app restart. Deliver via web push + voice announcement.
**Effort:** HIGH - Scheduler engine, persistence layer, push notification setup, service worker.

### GAP 6: No Episodic Memory - MEDIUM
**Current:** Short-term (in-memory, 20 entries) + long-term (JSON, 500 entries). No sense of "what happened when."
**Need:** Time-series log of conversations, events, completions. Pattern recognition over weeks/months.
**Solution:** `episodes` table in SQLite. Log summarized events with timestamps. Query for patterns.
**Effort:** MEDIUM - New table, logging hooks in chat/voice/task flows, pattern query functions.

### GAP 7: No Vector/Semantic Search - MEDIUM
**Current:** Memory search uses `string.includes()` - exact substring matching only. "What do you know about dinner?" won't find "We usually eat pasta on Mondays."
**Need:** Semantic similarity search. "dinner" should find "pasta on Mondays" and "grocery list for this week."
**Solution:** Generate embeddings via Euri API (free), store in `memory_embeddings` table, search via `sqlite-vec` extension for cosine similarity.
**Effort:** MEDIUM - Embedding generation, sqlite-vec integration, hybrid scoring (vector + keyword).

### GAP 8: Text Chat Has No Tool Calling - HIGH
**Current:** Voice mode has 3 tools (save_memory, recall_memory, manage_task). Text chat route (`/api/chat/route.ts`) just forwards messages to Euri with NO tool support.
**Need:** Text chat should have same capabilities as voice. Users should be able to type "add milk to grocery list" and have it actually happen.
**Solution:** Add tool definitions to text chat system prompt. Implement tool-calling loop in chat route (parse LLM response for tool intents, execute, return result).
**Effort:** MEDIUM - Modify chat route, add tool instruction format to system prompt.

### GAP 9: No Grocery List Management - MEDIUM
**Current:** No grocery feature exists.
**Need:** Shared family grocery list. Add/remove items via voice or text. Check off items while shopping.
**Solution:** `grocery_items` table + API route + voice/text tool + UI component.
**Effort:** LOW-MEDIUM - Straightforward CRUD + tool integration.

### GAP 10: No Kids' Activity/School Tracking - MEDIUM
**Current:** No concept of children's schedules.
**Need:** Track recurring activities (swimming Mon/Wed, piano Thu), school hours, homework deadlines.
**Solution:** Activities table with recurrence rules. Auto-create calendar events and reminders. Voice queries: "What does Emma have tomorrow?"
**Effort:** MEDIUM - DB schema, recurrence logic, calendar integration.

### GAP 11: No Chore Management - LOW
**Current:** Basic task CRUD exists but no assignment, no recurrence, no gamification.
**Need:** Assign chores to family members, track completion, recurring chores, points for kids.
**Solution:** Extend tasks table with assignment + recurring + points fields. Add chore board UI.
**Effort:** LOW - Extend existing task system.

### GAP 12: No Meal Planning - LOW
**Current:** No meal feature exists.
**Need:** Plan weekly meals, auto-add ingredients to grocery list, answer "What's for dinner?"
**Solution:** `meal_plans` table + API route + voice/text tool + simple UI grid.
**Effort:** LOW - Straightforward CRUD.

### GAP 13: No Dashboard View - MEDIUM
**Current:** Single page with orb + chat. No overview of family's day.
**Need:** At-a-glance view: today's schedule, pending tasks, grocery list, meal plan.
**Solution:** New `/dashboard` page with widget components.
**Effort:** MEDIUM - New page, multiple widget components, data fetching.

### GAP 14: Token Waste in Context Injection - MEDIUM
**Current:** `getMemoryContext()` dumps up to 28 memory entries into every single LLM call regardless of relevance.
**Need:** Inject only relevant context to save tokens and improve response quality.
**Solution:** Tiered context injection. Level 0 (always: family names, 50 tokens), Level 1 (relevant: query-matched memories, 300 tokens max), Level 2 (time-based: calendar, only near events), Level 3 (on-demand: full dump only when asked).
**Effort:** MEDIUM - Rewrite context building logic in memory.ts.

### GAP 15: No Response Streaming - LOW
**Current:** Text chat buffers entire response before displaying.
**Need:** Stream tokens as they arrive for perceived speed improvement.
**Solution:** Use Euri streaming mode + SSE in API route + incremental rendering in UI.
**Effort:** LOW - Modify chat route and UI message rendering.

### GAP 16: No Morning Briefing / Proactive Mode - LOW
**Current:** Jarvis only responds to user input.
**Need:** Proactive daily briefing: "Good morning! Today you have 3 events, 2 tasks due, and the grocery list has 5 items."
**Solution:** Scheduled job at configurable morning time. Compile today's data. Deliver via push notification + voice.
**Effort:** LOW - Depends on scheduler (Gap 5) being implemented first.

### GAP 17: No Data Backup/Export - LOW
**Current:** JSON files can corrupt with no recovery.
**Need:** Single-file backup, easy export, disaster recovery.
**Solution:** SQLite is already a single `.db` file. Add a `/api/backup` route that returns a copy. Schedule weekly auto-backup to a second location.
**Effort:** LOW - Very simple with SQLite.

### GAP 18: No PWA Support - LOW
**Current:** Regular web app, no installability, no offline, no push notifications.
**Need:** Install on phone/tablet for always-on family use. Receive push notifications.
**Solution:** `manifest.json` + service worker + web-push setup.
**Effort:** LOW-MEDIUM - Standard PWA setup.

---

## Robustness Checklist

### Data Integrity
- [ ] SQLite with WAL mode for concurrent read safety
- [ ] Transactions for multi-table operations (e.g., create task + create reminder)
- [ ] Foreign key constraints enforced
- [ ] Input validation on all API routes
- [ ] Automatic database backup on schedule

### Privacy & Security
- [ ] PII redaction on ALL outbound LLM calls (voice + text)
- [ ] Family member names dynamically loaded (not hardcoded)
- [ ] API keys in HTTP-only cookies (already done)
- [ ] No telemetry or external data collection
- [ ] Local-only database (never synced to cloud)
- [ ] Child-safe content filtering when child is active user

### Reliability
- [ ] Scheduler persists in DB, reloads on restart
- [ ] Graceful degradation without internet (show local data, disable LLM)
- [ ] Error boundaries in UI prevent full-page crashes
- [ ] Rate limiting on LLM API calls to stay within token budgets
- [ ] Connection retry logic for voice WebSocket

### Performance
- [ ] SQLite indexed queries for all frequent access patterns
- [ ] Token budget enforced (< 1500 tokens input per call)
- [ ] Embedding cache (don't re-embed unchanged memories)
- [ ] Lazy context loading (calendar only when needed)
- [ ] Streaming responses for text chat
- [ ] Background workers for non-blocking operations

### Family-Specific
- [ ] Multi-member awareness (who is asking)
- [ ] Age-appropriate responses for children
- [ ] Shared data (grocery, calendar) + personal data (preferences)
- [ ] Morning briefing with daily overview
- [ ] School schedule integration with pickup reminders
- [ ] Chore gamification to engage kids

---

## Key Design Decisions

1. **SQLite over Postgres/MongoDB**: Zero infrastructure, single file, runs on any home machine, perfect for single-household use.

2. **Regex PII over Presidio**: Presidio requires Docker + Python. For a home assistant where we KNOW the family members, regex with dynamic name loading is simpler and equally effective.

3. **node-schedule over BullMQ**: No Redis dependency. node-schedule runs in-process with our Next.js app. Persistence via SQLite table.

4. **sqlite-vec over ChromaDB/LanceDB**: Unified database (one SQLite file for everything). No separate vector DB server to run.

5. **Google Calendar first, CalDAV later**: Google Calendar has the best API and most families use it. CalDAV (Apple Calendar) can be added as Phase 2.

6. **No authentication/login**: Home network trust model. Family members switch by name, not by login. The assistant runs on the home network only.

7. **Web Push over SMS/Email**: Zero cost, works on phones as PWA, no external service dependency.

8. **Euri for embeddings**: Free within daily token limit. No separate embedding service needed.

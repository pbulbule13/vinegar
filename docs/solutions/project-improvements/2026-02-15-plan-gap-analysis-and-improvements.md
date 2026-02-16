---
title: "Vinegar Home Assistant - Plan Gap Analysis & Improvement Recommendations"
type: improvement
date: 2026-02-15
status: documented
component: full-stack
severity: mixed
tags: [architecture, plan-review, gap-analysis, improvements, vinegar]
---

# Vinegar Home Assistant - Plan Gap Analysis & Improvement Recommendations

> Comprehensive analysis comparing the consolidated plan (`docs/plans/2026-02-14-final-consolidated-plan.md`) against the actual implementation, identifying gaps, what's working well, and prioritized improvements.

---

## Executive Summary

The project is in strong shape for an MVP. Phase 1 (Foundation) is **substantially complete** - SQLite database, PII redaction, LLM middleware, tool executor, event bus, Zod validation, and the Android APK are all implemented. However, several plan items were implemented as **scaffolds** (schemas/routes exist but handlers are thin or untested), and important cross-cutting concerns are missing.

### Scorecard

| Area | Plan Status | Implementation Status | Gap |
|------|-------------|----------------------|-----|
| SQLite Database (5 migrations) | Complete | **Fully implemented** | None |
| PII Redaction | Complete | **Fully implemented** | None |
| LLM Middleware | Complete | **Fully implemented** | Minor |
| Tool Executor (14 tools) | Complete | **Schemas complete, 3 tools have full handlers** | Medium |
| Event Bus | Complete | **Fully implemented** | None |
| Zod Validators | Complete | **Fully implemented** | None |
| Token Budget | Complete | **Fully implemented** | None |
| API Key Security Fix | Complete | **Fully implemented** | None |
| Conversation Logging | Complete | **Fully implemented** | None |
| Wake Word Detection | Complete | **Fully implemented** | None |
| Futuristic Orb UI | Complete | **Fully implemented** | None |
| Android APK | Complete | **Built and ready** | None |
| Calendar Handlers | Planned | **Route exists, needs tool handler wiring** | Medium |
| Grocery/Meals/Chores Handlers | Planned | **Routes exist, tool handlers incomplete** | Medium |
| Google Calendar Sync | Planned | **Sync engine scaffolded** | High |
| Scheduler Engine | Planned | **Implemented with interval-based evaluation** | Low |
| Background Workers | Planned | **Scaffolded** | Medium |
| Dashboard | Planned | **Page + 5 widget components exist (scaffolded)** | Medium |
| Family Setup Wizard | Planned | **Component exists** | Low |
| ScriptProcessorNode Migration | Planned (Phase 6) | **Still using deprecated API** | Low |
| PWA + Push Notifications | Planned (Phase 5) | **Not started** | High |
| Vector Search (sqlite-vec) | Planned (Phase 4) | **Scaffolded** | High |
| Child Safety (Moderation API) | Planned (Phase 2) | **Prompt exists, API not called** | Medium |

---

## Section 1: What's Working Well

These items are **fully implemented and aligned with the plan**:

### 1.1 Database Layer (`src/lib/db.ts`) - Excellent
- All 5 migration phases defined and applied
- All 16 tables match the plan schema exactly
- Proper PRAGMAs (WAL, 64MB cache, foreign keys, mmap)
- `globalThis` singleton for dev mode safety
- Transaction-wrapped migrations with concurrent worker safety
- Legacy JSON import with idempotency check

### 1.2 PII Redaction (`src/lib/pii-redactor.ts`) - Excellent
- Two-layer approach (family names + regex patterns)
- Session-scoped cache with 1-hour TTL
- Bidirectional mapping (redact + rehydrate)
- Properly integrated into both text chat and voice token routes

### 1.3 LLM Middleware (`src/lib/llm-middleware.ts`) - Excellent
- Full pipeline: context inject -> PII redact -> token budget -> API call -> tool loop -> rehydrate -> log
- Tiered context injection with keyword routing
- 30s AbortController timeout
- Max 3 tool call iterations
- Usage logging to database
- Conversation logging

### 1.4 Unified Tool Executor (`src/lib/tool-executor.ts`) - Good
- Registry pattern with `registerTool()`
- Skill matching as fallback for unknown tool names
- Event bus integration (`vinegarEvents.emit`)
- 3 fully-wired handlers: `save_memory`, `recall_memory`, `manage_task`
- 14 tool schemas defined for LLM

### 1.5 Chat Route (`src/app/api/chat/route.ts`) - Excellent
- Clean delegation to middleware
- Zod input validation
- Proper error handling

### 1.6 Voice Token Route (`src/app/api/ai/realtime-token/route.ts`) - Excellent
- Security fix applied: never returns raw API key
- PII redaction on system prompt memory context
- 15s timeout on OpenAI API call
- Tool schemas passed to voice session

### 1.7 Event Bus (`src/lib/events.ts`) - Excellent
- Clean implementation with `on/off/emit/once`
- Error isolation in handlers
- `globalThis` singleton

### 1.8 Zod Validators (`src/lib/validators.ts`) - Excellent
- Comprehensive schemas for all route types
- Proper constraints (min/max lengths, regex patterns, enums)

---

## Section 2: Gaps & Missing Implementation

### Gap 1: Tool Handlers Not Wired for Most Tools (CRITICAL)

**Problem:** The tool executor has 14 tool schemas defined in `getToolSchemas()`, but only 3 tools have actual `registerTool()` handlers:
- `save_memory`
- `recall_memory`
- `manage_task`

The remaining 11 tools (`get_calendar`, `create_event`, `update_event`, `delete_event`, `set_reminder`, `manage_grocery`, `manage_meals`, `manage_activity`, `manage_chore`, `manage_skill`, `get_family`) have schemas that the LLM sees, but when the LLM tries to call them, they'll fall through to the skill matcher (which won't match) and return "Unknown tool" error.

**Impact:** High - The LLM will generate tool calls for calendar, grocery, meals, etc. but they'll all silently fail.

**Fix:** Add `registerTool()` calls for all 11 remaining tools in `tool-executor.ts`. The DB tables and API routes already exist; the handlers just need to be wired up. Each handler should:
1. Parse args
2. Execute the DB query
3. Emit appropriate event
4. Return structured result

**Priority:** P0 - Must fix before real usage

### Gap 2: API Routes vs Tool Handlers Dual Path

**Problem:** There are separate API routes (e.g., `/api/grocery/route.ts`, `/api/calendar/route.ts`) AND tool handlers. The API routes are for direct HTTP calls, the tool handlers are for LLM tool calls. But they may diverge in behavior.

**Recommendation:** The API route handlers should delegate to the same tool executor functions. This prevents logic duplication and ensures the LLM and UI always get the same behavior.

**Priority:** P1 - Important for consistency

### Gap 3: Google Calendar OAuth Flow Not Implemented

**Problem:** The `calendar-sync.ts` has the sync engine scaffolded, but there's no OAuth flow to get an access token. The plan mentions Google OAuth but no routes for the auth callback, token storage, or refresh.

**Missing:**
- `src/app/api/calendar/auth/route.ts` - OAuth redirect
- `src/app/api/calendar/callback/route.ts` - OAuth callback
- Token storage in settings table
- Token refresh logic
- `googleapis` package not installed

**Priority:** P2 - This is Phase 2 work and can wait

### Gap 4: ScriptProcessorNode Still Used (Deprecated)

**File:** `src/hooks/useRealtimeVoice.ts:39`
```typescript
const processorRef = useRef<ScriptProcessorNode | null>(null);
```

**Problem:** `ScriptProcessorNode` is deprecated in Web Audio API. It runs on the main thread and can cause audio glitches, especially on tablets.

**Plan says:** Phase 6 - AudioWorklet migration

**Priority:** P2 - Works for now, but should be done before heavy tablet use

### Gap 5: No PWA + Push Notifications

**Problem:** The plan calls for PWA via `@serwist/next` with push notifications for reminders. Neither the service worker, manifest, nor web-push setup exists.

**Impact:** Reminders only fire in-app (via the scheduler's event bus). No notification when the app isn't open.

**Priority:** P2 - Phase 5 work

### Gap 6: Child Safety Moderation API Not Called

**Problem:** The plan specifies using OpenAI's free Moderation API to classify input/output when a child is the active user. The `CHILD_SAFE_PROMPT` exists in `vinegar-context.ts` but is never injected. No Moderation API call is made.

**Fix:** In `llm-middleware.ts`, check active user role. If child:
1. Prepend `CHILD_SAFE_PROMPT` to system message
2. Call OpenAI Moderation API on LLM response
3. Filter flagged content

**Priority:** P1 - Important for families with young children

### Gap 7: Vector Search Not Functional

**Problem:** `memory_embeddings` table exists, `embeddings.ts` is scaffolded, but `sqlite-vec` is not installed and embedding generation isn't wired up.

**Priority:** P3 - Phase 4 work, keyword search works fine for now

### Gap 8: No `node-schedule` or `rrule` Installed

**Problem:** The plan specifies `node-schedule` for scheduling and `rrule` for recurring event expansion. Neither is in `package.json`.

The scheduler (`scheduler.ts`) works around this with a simple `setInterval` approach, which is functional but less capable.

**Priority:** P2 - The interval-based scheduler works for basic reminders

### Gap 9: Dashboard Widgets Are Scaffolds

**Problem:** Dashboard page and 5 widget components exist in `src/components/dashboard/` but need data fetching and real rendering logic.

**Priority:** P2 - Phase 5 work

### Gap 10: Build Plan References Old Path

**File:** `docs/VINEGAR-BUILD-PLAN.md:40`
```
- [ ] **Start server**: `cd C:\Users\pbkap\Documents\euron\Projects\dhruvjarvis && npx next dev -H 0.0.0.0`
```

**Problem:** References the deleted `dhruvjarvis` path. Should be `vinegar-home`.

**Priority:** P0 - Quick fix

### Gap 11: Legacy `jarvis.db` Files Still Present

**Problem:** Both `jarvis.db*` and `vinegar.db*` exist at project root. The old files are unused but waste space and cause confusion.

**Priority:** P1 - Quick cleanup

### Gap 12: Plan Title Still Says "Jarvis"

**File:** `docs/plans/2026-02-14-final-consolidated-plan.md:1-2`
```yaml
title: "FINAL PLAN: Jarvis Family Home Assistant - Full Upgrade"
```
And throughout the plan, references to "Jarvis" remain (e.g., `jarvisEvents`, `jarvis-context.ts`).

The code has been renamed to Vinegar but the documentation hasn't been updated.

**Priority:** P1 - Documentation hygiene

### Gap 13: `data_lookup` Skill Type Has SQL Injection Risk

**File:** `src/lib/tool-executor.ts:120-124`
```typescript
case 'data_lookup': {
  const query = config.query || args.query;
  const rows = db.prepare(query as string).all();
  result = rows;
}
```

**Problem:** This executes arbitrary SQL from the skill config. A parent could accidentally create a skill that drops tables or leaks data.

**Fix:** Use parameterized queries, or restrict to SELECT-only with a SQLite read-only connection.

**Priority:** P1 - Security concern

### Gap 14: No `.env.local` in `.gitignore`

**File:** `.gitignore` - needs verification that `.env.local` is excluded.

**Priority:** P0 if missing

---

## Section 3: Improvement Recommendations

### Improvement 1: Wire Up All 11 Missing Tool Handlers

Add handler registrations for all tools. Here's the pattern:

```typescript
// In tool-executor.ts, add after existing registerTool calls:

registerTool('get_calendar', 'Read calendar events', (args) => {
  const { start, end, family_member_id } = args;
  // Query calendar_events table with date range
  // Return formatted events
});

registerTool('create_event', 'Create calendar event', (args) => {
  const { title, start_time, end_time, ... } = args;
  // Insert into calendar_events
  // Emit 'calendar:event_created'
  // Auto-create reminder if reminder_minutes set
});

// ... etc for all 11 tools
```

**Effort:** ~2 hours. The DB tables exist, schemas exist, just need the glue.

### Improvement 2: Add Error Boundary for Tool Failures

**Problem:** If a tool call fails silently, the LLM doesn't know and gives a confused response.

**Fix:** When `executeTool` returns `{ success: false }`, inject a clear error message back into the conversation so the LLM can retry or inform the user.

### Improvement 3: Add Active Family Member Tracking

**Problem:** The plan specifies "active member" tracking with auto-timeout, but no code manages which family member is currently active.

**Fix:** Add to settings table:
- `active_member_id` - current user
- `active_member_since` - timestamp
- Auto-timeout after 30 min inactivity
- Check in LLM middleware to inject per-member context

### Improvement 4: Implement Morning Briefing

**Problem:** Plan mentions a "morning briefing" scheduled job but it's not implemented.

**Fix:** Add to scheduler:
- Configurable time (default 7am)
- Compile: today's calendar + pending tasks + grocery count + weather (if skill exists)
- Deliver via push notification (when PWA is ready) or in-app

### Improvement 5: Add Grocery Deduplication

**Problem:** Plan specifies grocery dedup (normalize, fuzzy match, merge quantities) but it's not implemented.

**Fix:** In the `manage_grocery` tool handler:
```typescript
function normalizeItem(item: string): string {
  return item.toLowerCase().trim()
    .replace(/s$/, '') // simple singularize
    .replace(/\s+/g, ' ');
}
// Check if normalized item exists, merge quantities if so
```

### Improvement 6: Add Response Streaming for Text Chat

**Problem:** Plan specifies SSE streaming for text responses. `src/app/api/chat/stream/route.ts` exists but isn't integrated into the main UI.

**Fix:** In `page.tsx`, offer a streaming option for text chat that uses the stream endpoint and shows tokens as they arrive.

### Improvement 7: Unified Message Store

**Problem:** (Plan Issue 14) Two separate arrays `messages` and `chatHistory` track messages. Voice and text contexts are isolated.

**Fix:** Use Zustand (already installed) for a unified message store:
```typescript
interface MessageStore {
  messages: Message[];
  addMessage: (msg: Message) => void;
  getApiMessages: (limit: number) => { role: string; content: string }[];
}
```

### Improvement 8: Add Proper `capacitor.config.ts` Server Discovery

**Problem:** Server IP (`192.168.1.15`) is hardcoded. If the PC's IP changes, the app breaks.

**Fix options:**
1. mDNS/Bonjour discovery
2. QR code pairing (scan from tablet to set server URL)
3. Fallback: show error with "Enter server IP" input on the tablet

### Improvement 9: Database Backup System

**Problem:** Plan specifies daily backups at 3am. The `background-worker.ts` has a job stub for it.

**Fix:** Implement the backup handler:
```typescript
// Use SQLite's backup API
db.backup(`backups/vinegar-${new Date().toISOString().split('T')[0]}.db`);
// Rotate: keep last 7
```

### Improvement 10: Add Health Check Endpoint

**Problem:** No way to verify the server is running before the tablet connects.

**Fix:** Add `src/app/api/health/route.ts`:
```typescript
export function GET() {
  return NextResponse.json({ status: 'ok', version: '0.1.0', uptime: process.uptime() });
}
```

---

## Section 4: What the Plan Gets Right (No Changes Needed)

1. **Architecture** - Local-first SQLite + optional cloud sync is perfect for a home assistant
2. **Phase ordering** - Foundation -> Family -> Household -> Intelligence -> Dashboard -> Polish
3. **PII protection** - Text chat redaction + voice limitation acknowledged
4. **Token budget** - 8000 input / 200K daily limit is sensible for free Euri tier
5. **Tool calling loop** - Max 3 iterations prevents infinite loops
6. **Skill system design** - Config-driven (not code) is the right security choice
7. **Event bus** - Simple in-process emitter is perfect for single-server deployment
8. **Model routing** - Simple keyword-based routing avoids unnecessary complexity

---

## Section 5: Prioritized Action Items

### P0 - Must Do Before Real Usage
1. ~~Wire up 11 missing tool handlers in `tool-executor.ts`~~ **DONE (2026-02-15)**
2. ~~Fix `data_lookup` SQL injection risk~~ **DONE (2026-02-15)** - Now blocks sensitive tables, requires LIMIT, blocks DDL/DML
3. ~~Fix build plan path reference (`dhruvjarvis` -> `vinegar-home`)~~ **DONE (2026-02-15)**
4. ~~Verify `.env.local` is in `.gitignore`~~ **DONE (2026-02-15)**

### P0.5 - Security Fixes Applied (2026-02-15)
- ~~PII redaction causing wrong names in tool calls~~ **FIXED** - Family names no longer redacted for text LLM
- ~~System prompt leaked to browser via realtime-token response~~ **FIXED** - Removed `instructions` field
- ~~SSRF in web_scraper/api_caller skills~~ **FIXED** - Added `isUrlSafe()` blocking private IPs/localhost
- ~~SQL injection in skill creation~~ **FIXED** - Validates queries at creation time
- ~~PINs stored in plaintext~~ **FIXED** - Now uses bcrypt hashing
- ~~Missing Zod validation on chores POST~~ **FIXED** - Added `choreSchema.safeParse()`
- ~~Missing Zod validation on PUT routes~~ **FIXED** - Added update schemas for family/calendar
- ~~Conversation logs storing unredacted PII~~ **FIXED** - SSN/CC/email/phone now redacted in logs
- ~~Weak ID generation (Math.random)~~ **FIXED** - Now uses `crypto.randomBytes()`
- ~~Flexible tool call parser for LLM variations~~ **ADDED** - Handles JSON, Python-style, inline JSON formats
- ~~PII rehydration for tool arguments~~ **ADDED** - Real names saved to DB correctly

### P1 - Should Do Soon
5. Add active family member tracking
6. Implement child safety moderation API
7. Remove legacy `jarvis.db*` files
8. Update plan documentation to say "Vinegar" instead of "Jarvis"
9. Unify API routes to delegate to tool executor (prevent logic duplication)
10. ~~Fix `data_lookup` to use parameterized read-only queries~~ **DONE - now blocks sensitive tables + requires LIMIT**

### P2 - Phase 2-3 Work
11. Install `node-schedule` + `rrule` for proper scheduling
12. Implement Google Calendar OAuth flow
13. Implement PWA + push notifications
14. Migrate ScriptProcessorNode to AudioWorklet
15. Implement dashboard widget data fetching
16. Add grocery deduplication
17. Add morning briefing

### P3 - Phase 4+ Work
18. Install `sqlite-vec` for vector search
19. Implement response streaming in UI
20. Unified message store with Zustand
21. Server IP discovery for Capacitor
22. Database backup rotation

---

## Section 6: Build Plan Update

The `docs/VINEGAR-BUILD-PLAN.md` should be updated:

1. Change server path from `dhruvjarvis` to `vinegar-home`
2. Mark folder rename as DONE
3. Add section on "Next Steps" listing P0 items
4. Note that the HTTP file server trick for APK transfer (which was locking `dhruvjarvis`) should use the `vinegar-home` directory instead

---

## Conclusion

The Vinegar project has a solid foundation with excellent architectural decisions. The main gap is that **11 of 14 tool handlers are schemas without implementations** - the LLM will try to call them and get errors. Fixing this is the single highest-impact improvement. After that, adding active family member tracking and child safety will make it genuinely usable for the target audience (families with young children on a Samsung tablet).

The plan itself is comprehensive and well-structured. No major architectural changes are recommended - just implementation completion of what's already designed.

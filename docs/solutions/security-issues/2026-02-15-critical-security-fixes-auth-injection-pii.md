---
title: 10 P1 Critical Security and Reliability Fixes
date: 2026-02-15
category: security-issues
tags: [authentication, sql-injection, prompt-injection, pii-redaction, dead-code, memory-leak, closure-bug, date-parsing, tool-registry, api-security]
severity: P1
status: resolved
components: [tool-executor.ts, middleware.ts, llm-middleware.ts, stream/route.ts, family/route.ts, embeddings.ts, pii-redactor.ts, useWakeWord.ts, scheduler.ts]
symptoms:
  - Duplicate tool registrations silently overwriting each other (~580 lines dead code)
  - Unauthenticated access to all 19 API endpoints
  - SQL injection possible via UNION/WITH/subqueries in data_lookup
  - Prompt injection via tool_call patterns in injected context
  - PII not redacted in streaming endpoint logs
  - Family PIN bypass when pin field omitted
  - Entire embeddings table loaded into memory during semantic search
  - Unbounded PII session cache growth
  - Microphone cannot be stopped due to stale closure in useWakeWord
  - NaN values written to SQLite from unsafe date parsing
root_cause: Multiple security and reliability gaps across authentication, input validation, context sanitization, memory management, and React hook lifecycle
---

# 10 P1 Critical Security and Reliability Fixes

## Problem Statement

A multi-agent code review (7 parallel review agents) of the Vinegar Home Assistant identified 43 findings across the codebase. 10 were classified as P1 (Critical) spanning security vulnerabilities, data integrity risks, and reliability bugs. These were fixed in commit `c53d049` on the `vinegar-home` branch.

## Fixes Applied

### P1-1: Remove Duplicate Tool Registrations

**File:** `src/lib/tool-executor.ts`

**Root Cause:** 11 tools were registered in tool-executor.ts (lines 306-884), then silently overwritten by `scheduler.ts` (6 tools) and `household-tools.ts` (5 tools) via `Map.set()`. This created ~580 lines of dead code with no indication of the problem.

**Fix:** Removed all 11 duplicate handlers from tool-executor.ts. File consolidated from 1,166 to 586 lines. Only 4 tools remain in tool-executor.ts: `save_memory`, `recall_memory`, `manage_task`, `get_usage`.

---

### P1-2: Add Authentication Middleware

**File:** `src/middleware.ts` (new)

**Root Cause:** No authentication on any of the 19 API routes. Any client on the LAN could call sensitive endpoints.

**Fix:** Created Next.js middleware checking `VINEGAR_AUTH_TOKEN` env var on all `/api/*` routes. Supports both `Authorization: Bearer` header and `vinegar_auth` cookie. Auth disabled when no token is set (dev mode).

```typescript
// src/middleware.ts
export function middleware(request: NextRequest) {
  const authToken = process.env.VINEGAR_AUTH_TOKEN;
  if (!authToken) return NextResponse.next(); // Dev mode

  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '');
  const cookieToken = request.cookies.get('vinegar_auth')?.value;

  if (headerToken === authToken || cookieToken === authToken) {
    return NextResponse.next();
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
```

---

### P1-3: Harden data_lookup Against SQL Injection

**File:** `src/lib/tool-executor.ts`

**Root Cause:** data_lookup blocked obvious keywords (DROP, DELETE, INSERT) but not `UNION`, `WITH` (CTE), or parenthesized `SELECT` subqueries. These could bypass the table blocklist.

**Fix:** Added regex checks blocking UNION, WITH, and `(SELECT...)` patterns:

```typescript
if (/\b(UNION|WITH)\b/i.test(queryStr)) {
  return { success: false, error: 'Data lookup does not support UNION or WITH clauses' };
}
if (/\(\s*SELECT\b/i.test(queryStr)) {
  return { success: false, error: 'Data lookup does not support subqueries' };
}
```

---

### P1-4: Prevent Prompt Injection

**File:** `src/lib/llm-middleware.ts`

**Root Cause:** User-controlled data (memory content, calendar titles) injected into LLM context could contain ` ```tool_call ` patterns that `parseToolCall()` would execute as legitimate tool calls.

**Fix:**
1. Added `sanitizeContext()` to strip tool_call fence patterns from all injected context
2. Added guard in `parseToolCall()` to reject responses containing memory context markers

```typescript
function sanitizeContext(text: string): string {
  return text
    .replace(/```(?:tool_call|tool_code|tool|json)\s*\n/gi, '``` ')
    .replace(/\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"/g, '{"_name": "$1", "_arguments"');
}
```

---

### P1-5: Fix Streaming Endpoint

**File:** `src/app/api/chat/stream/route.ts`

**Root Cause:** Stream endpoint logged unredacted user messages and had no usage tracking to the `usage_logs` table.

**Fix:**
- Applied `redact()` before logging user messages
- Added `estimateTokens()` and usage_logs INSERT after stream completes

---

### P1-6: Fix Family PIN Bypass

**File:** `src/app/api/family/route.ts`

**Root Cause:** `if (body.pin && role === 'parent')` only checked PIN when it was *submitted*. Omitting the pin field entirely bypassed verification.

**Fix:** Changed to check if member HAS a `pin_hash` first, then require a valid PIN:

```typescript
// Before: if (body.pin && role === 'parent') { ... }
// After:
const stored = db.prepare('SELECT pin_hash FROM family_members WHERE id = ?').get(memberId);
if (stored?.pin_hash) {
  if (!body.pin) {
    return NextResponse.json({ error: 'PIN required' }, { status: 401 });
  }
  const isValid = await bcrypt.compare(String(body.pin), stored.pin_hash);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }
}
```

---

### P1-7: Fix Semantic Search Full Table Load

**File:** `src/lib/embeddings.ts`

**Root Cause:** `semanticSearch()` did `SELECT ... FROM memories INNER JOIN memory_embeddings` with no WHERE clause, loading every row.

**Fix:** Added keyword pre-filtering WHERE clause and `LIMIT 100`:

```typescript
const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
const keywordFilter = keywords.length > 0
  ? `WHERE (${keywords.map(() => '(m.content LIKE ? OR m.topic LIKE ? OR m.tags LIKE ?)').join(' OR ')})`
  : '';
// ... query with LIMIT 100
```

---

### P1-8: Add PII Session Cache Eviction

**File:** `src/lib/pii-redactor.ts`

**Root Cause:** `sessionCache.mappings` and `reverseMappings` Maps grew forever. `clearSession()` existed but was never called.

**Fix:** Added `MAX_CACHE_SIZE = 500`. When exceeded, oldest 25% of entries are evicted:

```typescript
if (sessionCache.mappings.size >= MAX_CACHE_SIZE) {
  const keysToDelete = Array.from(sessionCache.mappings.keys()).slice(0, Math.floor(MAX_CACHE_SIZE / 4));
  for (const key of keysToDelete) {
    const token = sessionCache.mappings.get(key);
    sessionCache.mappings.delete(key);
    if (token) sessionCache.reverseMappings.delete(token);
  }
}
```

---

### P1-9: Fix useWakeWord Stale Closure

**File:** `src/hooks/useWakeWord.ts`

**Root Cause:** `recognition.onend` handler captured `isPassiveListening` state value at call time. When `stopPassiveListening` set state to false, the onend handler still had the old `true` value and kept restarting.

**Fix:** Added `isPassiveListeningRef` that stays in sync with state. The `onend` handler reads the ref instead of the closure-captured value:

```typescript
const isPassiveListeningRef = useRef(false);

// In startPassiveListening:
isPassiveListeningRef.current = true;

// In onend handler:
if (isPassiveListeningRef.current) { // reads current value, not stale closure
  setTimeout(() => { recognitionRef.current?.start(); }, 100);
}

// In stopPassiveListening:
isPassiveListeningRef.current = false;
```

---

### P1-10: Add Safe Date Parsing

**Files:** `src/lib/tool-executor.ts`, `src/lib/scheduler.ts`

**Root Cause:** `new Date(userInput).getTime() / 1000` produces NaN when input is invalid, which gets written to SQLite.

**Fix:** Added `isNaN()` checks after date parsing in `manage_task`, `get_calendar`, `create_event`, and `set_reminder`:

```typescript
const dueDate = due_date ? Math.floor(new Date(due_date).getTime() / 1000) : null;
if (dueDate !== null && isNaN(dueDate)) {
  return { success: false, error: 'Invalid due_date format. Use ISO format (e.g., 2026-02-15)' };
}
```

---

## Prevention Strategies

| Issue Class | Prevention Rule |
|---|---|
| Duplicate registrations | Throw on Map overwrite instead of silent replace |
| Missing auth | Centralized middleware; never add unprotected API routes |
| SQL injection bypass | Block UNION/WITH/subqueries; prefer parameterized queries |
| Prompt injection | Sanitize all user-controlled data before LLM context injection |
| Streaming security gaps | Apply same guards to streaming as non-streaming endpoints |
| Auth bypass via optional fields | Check if credential *exists on record*, not if it was *submitted* |
| Full table loads | Always include WHERE + LIMIT on search queries |
| Unbounded caches | Every cache needs max-size + TTL + eviction policy |
| React stale closures | Use refs for values read in event handlers; audit dependency arrays |
| Unsafe date parsing | Always validate `isNaN()` after `new Date()` before DB writes |

## Related Documentation

- `docs/solutions/project-improvements/2026-02-15-plan-gap-analysis-and-improvements.md` - Section 5 (P0.5) documents earlier security fixes
- `docs/plans/2026-02-14-feat-family-home-assistant-upgrade-plan-addendum.md` - Section 1 covers CRITICAL FIXES including PIN protection and PII
- `docs/plans/2026-02-14-final-consolidated-plan.md` - Phase 1.2 covers PII Redaction Gateway design

## Commit Reference

- **Commit:** `c53d049`
- **Branch:** `vinegar-home`
- **Files changed:** 9 (131 insertions, 597 deletions)
- **Net reduction:** 466 lines removed

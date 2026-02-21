---
title: "feat: V2 Privacy Hardening, Multi-Language TTS, Bug Fixes, HTML Docs"
type: feat
date: 2026-02-20
brainstorm: docs/brainstorms/2026-02-20-v2-improvements-brainstorm.md
---

# V2: Privacy Hardening, Multi-Language TTS/STT, Bug Fixes, Documentation

## Overview

Comprehensive v2 improvement pass for Vinegar Home Assistant covering 5 areas:

1. **Privacy**: Replace Google TTS with client-side Browser SpeechSynthesis (zero external data leaks for TTS). Add PII sanitization for external search/location APIs.
2. **Multi-Language Voice**: Hindi (hi-IN), Marathi (mr-IN), Indian English (en-IN) support for both TTS and STT, with accent/voice selection.
3. **Bug Fixes**: Broken chores query in suggestion engine, 3 missing tools in LLM registry, missing `is_active` column on `family_members`.
4. **Settings UI Overhaul**: Language/speed/voice pickers, STT language, home/work location inputs, family member switcher.
5. **HTML Documentation**: Standalone `public/docs.html` documenting all 26 tools, 21 API routes, architecture, and capabilities.
6. **Launcher Script**: Update `start-vinegar.bat` to avoid port conflicts with other services.

## Problem Statement / Motivation

- **Privacy leak**: `/api/tts` sends full AI response text (names, addresses, schedules) to `translate.google.com` on every voice response.
- **English-only**: TTS hardcoded to `tl=en`, STT hardcoded to `en-US`. Family needs Hindi and Marathi.
- **Speed**: TTS speed locked at 1.0x, user wants faster (~1.2x).
- **Silent bugs**: Chores suggestions silently fail (query nonexistent table), 3 tools (traffic/nearby/deals) invisible to LLM.
- **No documentation**: No way to see what the system can do at a glance.
- **Port conflict**: `start-vinegar.bat` uses port 3000 which may conflict with other services.

## Proposed Solution

### Architecture Decision Record

| Decision | Choice | Rationale |
|----------|--------|-----------|
| TTS engine | Client-side `window.speechSynthesis` | Zero external calls, multi-language, speed control, offline, free |
| TTS fallback | Keep `/api/tts` as fallback when browser has no voices | Android WebView may lack voices on some devices |
| TTS chunking | Client-side sentence-boundary splitting, max 150 chars/utterance | Chrome/Android has long-text pause bug >200 chars |
| Default speed | 1.2x | User requested "a little faster" |
| PII on search | Strip PII entirely (not tokenize) | Tokenized PII breaks search queries |
| PII on location | Allow addresses (required for functionality), strip names/SSN/CC | Addresses are required input for maps APIs |
| Settings storage | SQLite key-value table | Consistent with existing pattern |
| Documentation | Static `public/docs.html` with "Last updated" date | Simple, no build step, accessible at /docs.html |
| Port | 3001 for Next.js dev server | Avoids conflict with common port 3000 services |

---

## Technical Approach

### Phase 1: Client-Side TTS Engine + Chunking + Fallback

**Goal**: Eliminate Google TTS privacy leak. All TTS runs in the browser.

#### 1A. Enhance `useClientTTS.ts` hook with chunking

**File**: `src/hooks/useClientTTS.ts` (already exists, needs chunking)

Add sentence-boundary chunking to avoid Chrome's long-text pause bug:

```typescript
// src/hooks/useClientTTS.ts - add chunking
function splitIntoChunks(text: string, maxLen: number = 150): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let breakAt = remaining.lastIndexOf(". ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = remaining.lastIndexOf(", ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }
  return chunks.filter(c => c.length > 0);
}
```

Queue chunks sequentially via `utterance.onend` chaining. Add fallback: if `getVoices()` returns empty after 3 seconds, use server-side `/api/tts` instead.

**Acceptance Criteria**:
- [ ] Text >150 chars is split into sentence-boundary chunks
- [ ] Chunks play sequentially without overlap
- [ ] `isSpeaking` is true for entire duration (all chunks)
- [ ] `onSpeakEnd` fires only after last chunk
- [ ] Fallback to `/api/tts` when no browser voices available

#### 1B. Wire `useClientTTS` into `page.tsx`

**File**: `src/app/page.tsx`

Replace `speakText()` function (lines 186-200) with `useClientTTS.speak()`:

```typescript
// page.tsx - replace speakText with hook
const clientTTS = useClientTTS(() => {
  // onSpeakEnd callback - can restart STT if needed
});

// Replace: speakText(fullResponse) at line 299
// With: clientTTS.speak(fullResponse)

// Replace: speakText("Going to sleep...") at line 100
// With: clientTTS.speak("Going to sleep. Say Vinegar when you need me.")
```

**Files to modify**: `src/app/page.tsx` (lines 100, 186-200, 299)

#### 1C. Wire `useClientTTS` into `useBrowserVoice.ts`

**File**: `src/hooks/useBrowserVoice.ts`

This hook currently has its own `speak()` (lines 71-131) that calls `/api/tts`. Replace with a callback pattern:

- Add `onSpeak?: (text: string) => void` to `UseBrowserVoiceOptions`
- Replace the internal `speak()` with `onSpeak?.(text)` calls
- The parent component (`page.tsx`) passes `clientTTS.speak` as the `onSpeak` callback
- Add `onSpeakEnd` to restart listening after TTS completes

Also update STT language (line 215):
```typescript
// Currently: recognition.lang = "en-US";
// Change to: recognition.lang = sttLanguage || "en-US";
```

Accept `sttLanguage` as a prop from parent or load from `/api/settings/tts`.

**Files to modify**: `src/hooks/useBrowserVoice.ts` (lines 25-30, 71-131, 150, 188, 215)

#### 1D. Keep `/api/tts` as fallback (with PII redaction)

**File**: `src/app/api/tts/route.ts`

Don't delete - keep as fallback for devices without browser TTS. But add PII redaction before sending to Google:

```typescript
// Before sending to Google TTS, redact PII
import { redact } from "@/lib/pii-redactor";
const { redacted } = redact(cleanText, { redactFamilyNames: true });
// Use redacted text in the Google TTS URL
```

Also make language and speed configurable via query params or request body:
```typescript
const { text, lang = "en", speed = 1 } = await request.json();
const url = `...&tl=${lang}&ttsspeed=${speed}`;
```

**Files to modify**: `src/app/api/tts/route.ts` (lines 9, 38)

#### 1E. Echo cancellation for same-browser TTS/STT

When both TTS and STT are browser-native, the TTS audio can be picked up by STT microphone. Handle by:

1. Hard-stop `SpeechRecognition` before `SpeechSynthesis.speak()`
2. Add 400ms delay after `utterance.onend` before restarting recognition
3. Use `isSpeakingRef` flag (already exists in `useBrowserVoice.ts`)

**Files to modify**: `src/hooks/useBrowserVoice.ts` (lines 96-109, 266-272)

---

### Phase 2: Multi-Language Support

#### 2A. TTS/STT Settings API Route

**File**: `src/app/api/settings/tts/route.ts` (already exists)

Already created with keys: `tts_language`, `tts_speed`, `tts_pitch`, `tts_voice`, `stt_language`

Valid languages: `["en-US", "en-IN", "hi-IN", "mr-IN", "en-GB", "en-AU"]`

#### 2B. Database Migration v8

**File**: `src/lib/db.ts` - add migration v8

```typescript
{
  version: 8,
  description: 'Phase 9: TTS/voice settings + family_members.is_active column',
  up: (db) => {
    // TTS settings defaults
    const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    insertSetting.run('tts_language', 'en-US');
    insertSetting.run('tts_speed', '1.2');
    insertSetting.run('tts_pitch', '1.0');
    insertSetting.run('tts_voice', '');
    insertSetting.run('stt_language', 'en-US');
    insertSetting.run('weather_city', '');

    // Add is_active column to family_members (referenced but missing)
    const hasColumn = db.prepare(
      "SELECT COUNT(*) as c FROM pragma_table_info('family_members') WHERE name='is_active'"
    ).get() as { c: number };
    if (hasColumn.c === 0) {
      db.exec('ALTER TABLE family_members ADD COLUMN is_active INTEGER DEFAULT 0');
      // Set the first parent as active by default
      db.prepare(
        "UPDATE family_members SET is_active = 1 WHERE id = (SELECT id FROM family_members WHERE role = 'parent' LIMIT 1)"
      ).run();
    }
  },
}
```

#### 2C. Voice selection with language-aware filtering

The `useClientTTS.ts` hook already has `findVoice()` that searches by language. Enhance with:

- When selected language has no voices, show a toast notification: "No [language] voices found on this device. Using [fallback] instead."
- Filter the voice picker dropdown to show voices matching the selected language
- Prefer `localService: true` voices (runs on-device, no network = more private)

#### 2D. STT language propagation

Pass loaded `stt_language` setting to `useBrowserVoice` hook as a prop:

```typescript
// page.tsx
const [sttLanguage, setSttLanguage] = useState("en-US");

// Load from settings
useEffect(() => {
  fetch("/api/settings/tts").then(r => r.json()).then(data => {
    if (data.stt_language) setSttLanguage(data.stt_language);
  }).catch(() => {});
}, []);

// Pass to browser voice hook
const browserVoice = useBrowserVoice({
  model: selectedModel,
  sttLanguage,
  ...voiceCallbacks,
});
```

**File**: `src/hooks/useBrowserVoice.ts` line 215 - use prop instead of hardcoded `"en-US"`.

---

### Phase 3: Bug Fixes

#### 3A. Fix suggestion engine chores query

**File**: `src/lib/suggestion-engine.ts` lines 110-122

```typescript
// BEFORE (broken - chores table doesn't exist):
const pendingChores = db.prepare(`
  SELECT c.title, f.name as assigned_to FROM chores c
  LEFT JOIN family_members f ON c.assigned_to = f.id
  WHERE c.status = 'pending' AND c.created_at < unixepoch() - 86400
  LIMIT 3
`).all()

// AFTER (correct - use tasks table with category filter):
const pendingChores = db.prepare(`
  SELECT t.title, f.name as assigned_to FROM tasks t
  LEFT JOIN family_members f ON t.assigned_to = f.id
  WHERE t.category = 'chore' AND t.status = 'pending'
    AND t.created_at < unixepoch() - 86400
  LIMIT 3
`).all()
```

#### 3B. Add 3 missing tools to LLM registry

**File**: `src/lib/llm-middleware.ts`

1. **Line 258** - `getToolInstructions()` string: append `get_traffic`, `find_nearby`, `check_deals` with their argument signatures:

```
, get_traffic({from,to}), find_nearby({query,type,near,radius_miles}), check_deals({store,item,zip_code})
```

2. **Lines 283-287** - `knownTools` array: add the 3 missing tools:

```typescript
const knownTools = ['save_memory', ..., 'manage_budget',
  'get_traffic', 'find_nearby', 'check_deals'];
```

**File**: `src/app/api/chat/stream/route.ts`

3. **Line 27** - `getToolInstructions()` string: same additions as above.

#### 3C. Fix `is_active` column (via migration v8 in Phase 2B)

Already handled in Phase 2B migration. After migration, the child safety check in `llm-middleware.ts` line 353 will work correctly.

---

### Phase 4: PII Hardening for External APIs

#### 4A. Create `sanitizeForExternal()` utility

**File**: `src/lib/pii-redactor.ts` - add new export

Unlike `redact()` which tokenizes for round-trip, `sanitizeForExternal()` strips PII entirely:

```typescript
export function sanitizeForExternal(text: string): string {
  let clean = text;
  // Strip SSN, credit cards, emails, phones
  for (const pattern of PII_PATTERNS) {
    clean = clean.replace(pattern.regex, '');
  }
  // Strip family names
  refreshFamilyNames();
  for (const name of sessionCache.familyNames) {
    clean = clean.replace(new RegExp(`\\b${escapeRegex(name)}\\b`, 'gi'), '');
  }
  // Collapse whitespace
  return clean.replace(/\s+/g, ' ').trim();
}
```

#### 4B. Apply to DuckDuckGo search

**File**: `src/lib/search-tools.ts` lines 112-118

```typescript
import { sanitizeForExternal } from './pii-redactor';

// In web_search handler:
const searchQuery = sanitizeForExternal(query.trim());
```

#### 4C. Apply to DuckDuckGo deals search

**File**: `src/lib/deals-tools.ts` line 58

```typescript
import { sanitizeForExternal } from './pii-redactor';

// Sanitize the search query before sending
const searchQuery = sanitizeForExternal(queryParts.join(' '));
```

#### 4D. Location tools - minimize data, don't strip addresses

**File**: `src/lib/location-tools.ts`

Addresses must be sent for functionality. But:
- Strip names, SSN, CC from any freeform text in location queries
- Don't send unnecessary data (e.g., user names as part of origin/destination)

```typescript
import { sanitizeForExternal } from './pii-redactor';

// In get_traffic handler (line 129-130):
const origin = sanitizeForExternal(from?.trim() || '') || getSetting('home_location') || '';
const destination = sanitizeForExternal(to?.trim() || '') || getSetting('work_location') || '';
```

---

### Phase 5: Settings UI Overhaul

**File**: `src/components/settings-modal.tsx`

Add new sections below the existing API keys:

#### Section: Voice & Language
- **TTS Language** dropdown: en-US, en-IN (Indian English), hi-IN (Hindi), mr-IN (Marathi)
- **TTS Speed** slider: 0.8x to 2.0x, default 1.2x, shows current value
- **TTS Voice** dropdown: populated from browser voices matching selected language
- **Test Voice** button: speaks "Hello, I'm Vinegar" in selected voice/speed
- **STT Language** dropdown: same options as TTS, with "Link to TTS language" checkbox (default: linked)

#### Section: Location
- **Home Location** text input (read from `home_location` setting)
- **Work Location** text input (read from `work_location` setting)
- **Home ZIP** text input (read from `home_zip` setting)
- **Weather City** text input (read from `weather_city` setting)

#### Section: Family
- **Active Member** selector: list family members, highlight active one, tap to switch
- Note: switching to a child activates child-safe mode

**Load/save pattern**: On modal open, GET `/api/settings/tts` + read location settings. On each change, POST to save immediately (debounced 500ms for sliders).

---

### Phase 6: HTML System Documentation

**File**: `public/docs.html`

Standalone, styled HTML page. Sections:

1. **Hero/Header**: "Vinegar Home Assistant - System Documentation"
2. **Overview**: What Vinegar is, architecture summary
3. **Tools Reference**: All 26 tools with name, description, arguments, example usage
4. **API Routes**: All 21 routes with method, path, description
5. **Voice Features**: Wake word, STT, TTS, language support
6. **Privacy & Security**: PII redaction, local-first architecture, what data goes where
7. **Settings & Configuration**: All settings keys, environment variables
8. **Family Features**: Members, child safety mode, active user
9. **Dashboard**: What the dashboard shows
10. **Footer**: "Last updated: 2026-02-20" + link back to main app

Styling: Dark theme matching the app (bg-[#050508], amber accents), responsive, no external dependencies (inline CSS).

Add a navigation link from the main app header or settings modal.

---

### Phase 7: Launcher Script Update

**File**: `start-vinegar.bat`

Change from port 3000 to 3001 (or a less common port) to avoid conflicts. Also check if the chosen port is available before starting:

```batch
:: Check if port 3001 is already in use
set PORT=3001
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
    echo   Port %PORT% in use by PID: %%a, killing...
    taskkill /F /PID %%a >nul 2>&1
)

:: Also kill any stale Next.js processes
for /f "tokens=2" %%a in ('tasklist ^| findstr "node.exe"') do (
    wmic process where "ProcessId=%%a" get CommandLine 2>nul | findstr "next" >nul && taskkill /F /PID %%a >nul 2>&1
)

npx next dev -H 0.0.0.0 -p %PORT%
```

Also update the Capacitor config to use the new port:

**File**: `capacitor.config.ts` - update `server.url` if it references port 3000.

---

## Implementation Phases (Execution Order)

| Phase | What | Files | Est. Lines Changed |
|-------|------|-------|-------------------|
| **1** | Client-side TTS + chunking + fallback | `useClientTTS.ts`, `page.tsx`, `useBrowserVoice.ts`, `tts/route.ts` | ~200 |
| **2** | Multi-language + migration v8 + STT lang | `db.ts`, `useBrowserVoice.ts`, `page.tsx`, `settings/tts/route.ts` | ~80 |
| **3** | Bug fixes (chores, tools, is_active) | `suggestion-engine.ts`, `llm-middleware.ts`, `stream/route.ts` | ~30 |
| **4** | PII hardening for external APIs | `pii-redactor.ts`, `search-tools.ts`, `deals-tools.ts`, `location-tools.ts` | ~40 |
| **5** | Settings UI overhaul | `settings-modal.tsx` | ~250 |
| **6** | HTML documentation | `public/docs.html` (new) | ~800 |
| **7** | Launcher script + port update | `start-vinegar.bat`, `capacitor.config.ts` | ~20 |

**Total**: ~1420 lines across 14 files (2 new, 12 modified)

---

## Acceptance Criteria

### Functional Requirements
- [ ] All TTS output uses client-side `window.speechSynthesis` by default
- [ ] Server-side `/api/tts` fallback activates when browser has no voices
- [ ] TTS supports en-US, en-IN, hi-IN, mr-IN with correct accent
- [ ] TTS speed defaults to 1.2x, configurable 0.8-2.0x via settings
- [ ] STT supports en-US, hi-IN, mr-IN language selection
- [ ] Long text (>150 chars) is chunked for TTS without mid-sentence pauses
- [ ] No TTS echo feedback loop (STT doesn't hear TTS output)
- [ ] Chore suggestions appear for pending chores in tasks table
- [ ] LLM can call get_traffic, find_nearby, check_deals tools
- [ ] Search queries to DuckDuckGo have PII stripped
- [ ] Settings modal shows voice/language/speed/location sections
- [ ] `public/docs.html` accessible at /docs.html with full system documentation
- [ ] `start-vinegar.bat` uses a non-conflicting port

### Non-Functional Requirements
- [ ] No personal data sent to Google TTS (privacy)
- [ ] PII (names, SSN, CC, email, phone) stripped from all external search API calls
- [ ] Client-side TTS works on Android Chrome and Windows Chrome/Edge
- [ ] TTS fallback works when browser voices unavailable
- [ ] Settings persist across browser sessions (SQLite)
- [ ] Migration v8 is idempotent (safe to run multiple times)

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Android WebView may lack SpeechSynthesis voices | Fallback to server-side `/api/tts` with PII redaction |
| Chrome long-text pause bug | Chunk text at sentence boundaries, max 150 chars |
| TTS/STT echo feedback loop | Stop STT during TTS + 400ms post-TTS delay |
| Marathi (mr-IN) voices rare on most devices | Show notification, fallback to Hindi or Indian English |
| PII stripping degrades search quality | Accept some loss; privacy > search precision |
| Port 3001 may also conflict | Script checks and kills conflicting process first |

---

## References

### Internal
- Brainstorm: `docs/brainstorms/2026-02-20-v2-improvements-brainstorm.md`
- Existing plans: `docs/plans/2026-02-14-final-consolidated-plan.md` (Phases 1-6)
- Security fixes: `docs/solutions/security-issues/2026-02-15-critical-security-fixes-auth-injection-pii.md`
- Location plan: `docs/plans/2026-02-16-feat-location-traffic-deals-integration-plan.md`

### Key File Paths
- TTS route: `src/app/api/tts/route.ts`
- Client TTS hook: `src/hooks/useClientTTS.ts`
- Browser voice hook: `src/hooks/useBrowserVoice.ts`
- Main page: `src/app/page.tsx`
- PII redactor: `src/lib/pii-redactor.ts`
- LLM middleware: `src/lib/llm-middleware.ts`
- Streaming route: `src/app/api/chat/stream/route.ts`
- Settings modal: `src/components/settings-modal.tsx`
- Database: `src/lib/db.ts`
- Suggestion engine: `src/lib/suggestion-engine.ts`
- Search tools: `src/lib/search-tools.ts`
- Location tools: `src/lib/location-tools.ts`
- Deals tools: `src/lib/deals-tools.ts`
- Launcher: `start-vinegar.bat`

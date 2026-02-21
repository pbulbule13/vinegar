# Vinegar v2 Improvements Brainstorm

**Date:** 2026-02-20
**Status:** Ready for implementation

---

## What We're Building

A comprehensive v2 improvement pass covering: privacy hardening (no personal data leaves the server), multi-language TTS with Marathi/Hindi support, speed controls, bug fixes from log analysis, HTML system documentation, and high-value new features.

---

## 1. CRITICAL: Privacy Hardening (No Data Leaves Server)

### Current External Data Leaks Found

| # | What Leaks | Where | Severity |
|---|-----------|-------|----------|
| 1 | **Full response text** sent to `translate.google.com` for TTS | `/api/tts/route.ts:38` | **HIGH** - response text can contain names, addresses, schedule details |
| 2 | User messages sent to Euri LLM API | `llm-middleware.ts:390` | MEDIUM - PII redacted (SSN/CC/email/phone/address) but family names pass through |
| 3 | Search queries to DuckDuckGo | `search-tools.ts:22,53` | LOW - user-requested, queries may contain personal context |
| 4 | Location/address to Google Maps | `location-tools.ts:50` | MEDIUM - home/work addresses sent to Google |
| 5 | City name to OpenWeatherMap | `weather-tools.ts:51` | LOW - just city name, not personal |
| 6 | Store/item queries to DuckDuckGo (deals) | `deals-tools.ts:65` | LOW - search terms only |

### Fix: Replace Google TTS with Client-Side Browser SpeechSynthesis

**Why this is the best approach:**
- **Zero external calls** - runs entirely in the browser engine
- **Multi-language** - supports `en-US`, `hi-IN`, `mr-IN` and dozens more
- **Speed/pitch/voice control** - native parameters: `rate`, `pitch`, `volume`, `voice`
- **No API key needed** - free, unlimited
- **Works offline** - no network required for TTS
- **Accent selection** - multiple voices per language on most systems

**Implementation:**
- Remove `/api/tts` server endpoint (or keep as fallback)
- Add client-side `speakWithBrowser(text, lang, speed)` using `window.speechSynthesis`
- Add language/voice selection to settings modal
- Store TTS preferences in SQLite settings table: `tts_language`, `tts_speed`, `tts_voice`

### Fix: PII Redaction for External Tool Calls

- Apply `redact()` to search queries before sending to DuckDuckGo
- Apply `redact()` to location queries before sending to Google Maps
- Family names should be redacted for ALL external API calls (not just LLM)

---

## 2. Multi-Language TTS: Hindi & Marathi

### Problem
- TTS hardcoded to `tl=en` (English) - line 38 of tts/route.ts
- STT hardcoded to `en-US` - line 215 of useBrowserVoice.ts
- No language selection UI anywhere
- Marathi and Hindi accents were "all off" per user feedback

### Solution: Browser SpeechSynthesis with Language Selection

**Supported languages (Browser SpeechSynthesis):**
- `en-US` / `en-IN` - English (US / Indian English accent)
- `hi-IN` - Hindi
- `mr-IN` - Marathi

**Voice quality notes:**
- Windows 11 includes Microsoft voices for Hindi and Marathi (decent quality)
- Android Chrome uses Google voices (good quality for Hindi, acceptable for Marathi)
- Edge browser has the best Indian language voices (Neural voices)

**STT language support (Web Speech API):**
- `hi-IN` - Hindi recognition (Google servers)
- `mr-IN` - Marathi recognition (Google servers)
- Can auto-detect or allow user to set preferred language

### Settings to Add
- `tts_language`: "en-US" | "en-IN" | "hi-IN" | "mr-IN" (default: "en-US")
- `tts_speed`: 0.8 - 2.0 (default: 1.2 -- slightly faster than normal per user request)
- `tts_voice`: voice name string (populated from available browser voices)
- `stt_language`: same options as tts_language (default: "en-US")

---

## 3. TTS Speed Increase

### Current State
- Google TTS `ttsspeed=1` (normal speed, hardcoded)
- No user control

### Fix
- Browser SpeechSynthesis `rate` parameter: 0.1 to 10.0 (1.0 = normal)
- Default to `1.2` (slightly faster as requested)
- Add speed slider in settings modal
- Store in settings table as `tts_speed`

---

## 4. Bug Fixes Found in Code Analysis

### Bug 1: Suggestion Engine Chores Query (BROKEN)
**File:** `suggestion-engine.ts:111-122`
**Problem:** Queries a `chores` table that doesn't exist. Chores are in `tasks` table with `category = 'chore'`.
**Fix:** Change SQL to query `tasks WHERE category = 'chore' AND status = 'pending'`

### Bug 2: Tool Registry Missing Traffic/Nearby Tools
**File:** Need to verify `get_traffic` and `find_nearby` are in the tool call parser's known tools list
**Check:** `llm-middleware.ts` parseToolCall knownTools array -- verify all 26 tools listed

### Bug 3: PII Redaction Doesn't Cover TTS Output
**File:** `tts/route.ts`
**Problem:** Raw AI response text (potentially containing names, addresses, personal details) is sent to Google TTS
**Fix:** Eliminated by switching to client-side TTS

---

## 5. New Features Worth Adding

### 5A. Settings UI Overhaul
**Current state:** Settings modal only shows API keys
**Add:**
- TTS language selector (dropdown)
- TTS speed slider (0.8x - 2.0x)
- TTS voice picker (populated from browser voices)
- STT language selector
- Home/work location inputs (already in DB, no UI)
- Weather city input
- Active family member selector

### 5B. Conversation History Viewer
**Current state:** Conversations logged to DB but no way to view past conversations
**Add:** `/history` page showing past conversations with search, date filtering

### 5C. Family Member Quick-Switch
**Current state:** No UI to switch active family member
**Add:** Family member avatar bar at top, tap to switch. Activates child-safe mode for children.

### 5D. Full HTML System Documentation
**User request:** "Create a full HTML documentation of what this system has and is capable of"
**Implementation:** Generate `public/docs.html` - a standalone, styled HTML page documenting:
- All 26 tools with descriptions and examples
- All 21 API routes
- System architecture overview
- Privacy & security features
- Voice commands and wake word
- Settings and configuration
- Family features and child safety mode
- Accessible at `http://192.168.1.15:3000/docs.html`

### 5E. Health Dashboard Widget
**Add to dashboard:** Family health tips, water reminders, exercise nudges based on time of day

### 5F. Smart Home Integration Prep
**Add settings for:** Home WiFi devices, IP-based device control hooks (lights, AC, etc.)
**Note:** Don't over-engineer - just add the settings/schema, actual integrations come later

---

## 6. Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Privacy fix: Client-side TTS (eliminates Google TTS leak) | Medium | Critical |
| P0 | Multi-language TTS (Hindi, Marathi, English) | Medium | High |
| P0 | TTS speed increase (default 1.2x) | Low | High |
| P0 | HTML system documentation | Medium | High |
| P1 | Settings UI overhaul (language, speed, voice, location) | Medium | High |
| P1 | Bug fix: suggestion engine chores query | Low | Medium |
| P1 | PII redaction for external tool calls | Low | Medium |
| P2 | STT language selection (Hindi/Marathi recognition) | Low | Medium |
| P2 | Conversation history viewer | Medium | Medium |
| P2 | Family member quick-switch | Medium | Medium |
| P3 | Health dashboard widget | Low | Low |
| P3 | Smart home integration prep | Low | Low |

---

## Key Decisions

1. **Client-side Browser SpeechSynthesis over Google TTS** - privacy, multi-language, speed control, free, offline
2. **Default speed 1.2x** - slightly faster than normal per user feedback
3. **`en-IN` as alternative English voice** - Indian English accent sounds more natural for the family
4. **Settings stored in SQLite** - consistent with existing pattern, persists across sessions
5. **HTML docs as static file in `/public`** - no build step, accessible at /docs.html
6. **PII redaction extended to ALL external calls** - not just LLM

## Open Questions

None - requirements are clear. Proceeding to implementation.

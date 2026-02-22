---
title: "feat: Auto Language Detection & Speaker Identification"
type: feat
date: 2026-02-21
deepened: 2026-02-21
agents_used: 13
---

# feat: Auto Language Detection & Speaker Identification

## Enhancement Summary

**Deepened on:** 2026-02-21
**Agents used:** 13 (architecture, security, performance, TypeScript, simplicity, pattern recognition, race conditions, agent-native, spec flow, language detection research, speaker ID research, framework docs, learnings)

### Key Corrections from Research

1. **STT transliteration breaks script detection**: When STT is set to `en-US`, Hindi/Marathi speech is returned as Latin transliteration ("kya haal hai"), NOT Devanagari. Script detection alone is insufficient — need English dictionary check as secondary signal.
2. **SpeechRecognition NOT supported in Android WebView**: Chromium bug #487255. Must use `@capacitor-community/speech-recognition` native plugin for the Android APK.
3. **Dual mic streams fail on Android**: Hardware mic is exclusive. Must use sequential handoff (Meyda first, then STT) instead of parallel.
4. **Child safety race condition**: First utterance is unprotected during speaker ID. Fix: fail-closed (default to child-safe for unknown speakers).
5. **is_active column never synced**: `/api/family` only updates `settings.active_family_member`, but child safety checks `family_members.is_active`. Must fix in Phase 1.

### Simplifications Applied

- **4 phases collapsed to 2** (ship complete features, not layers)
- **5 enrollment phrases reduced to 3**
- **32-dimensional feature vector reduced to 16** (MFCC means + spectral means only)
- **Removed YAGNI**: `needsRetranscription`, `enrollmentEmbeddings`, incremental enrollment, waveform visualization, `auto_language` toggle, confidence indicator UI, three-tier confidence
- **SQLite storage instead of IndexedDB** (single source of truth, existing column)

---

## Overview

Two interconnected features that make Vinegar a truly personalized family assistant:

1. **Auto Language Detection**: Vinegar automatically detects whether the user is speaking English, Hindi, or Marathi — no manual settings change needed. The LLM responds in the detected language, and TTS speaks it correctly.

2. **Speaker Identification**: Vinegar recognizes WHO is speaking based on their voice, auto-switches the active family member, personalizes responses, and activates child safety mode when a child speaks.

Both features are **privacy-first** — all processing happens on-device. No audio or voiceprints ever leave the device. MFCC feature vectors are non-reversible (cannot reconstruct audio from them).

## Problem Statement

**Language**: Users currently must manually change language settings to switch between English, Hindi, and Marathi. When speaking Marathi, if the STT is set to English, the transcript is garbled (Latin transliteration). The LLM only recently got language instructions (added today), but the STT language must match what the user speaks.

**Speaker ID**: Family members currently switch profiles manually via a UI dropdown. There is no voice-based identification. The `voice_profile` column exists in `family_members` but is completely unused. Child safety mode only works if someone manually sets a child as active.

## Technical Approach

### Feature 1: Auto Language Detection

#### Architecture: Dual-Signal Detection Pipeline (Zero Dependencies)

```
[User speaks]
      |
      v
[STT transcribes using sticky language]
      |
      v
[Signal 1: Script Detection - Devanagari vs Latin regex]
      |
      ├── Devanagari chars found ─────► [Hindi vs Marathi morphological markers]
      |                                        |
      |                                 ├── Marathi ळ char ──────► mr-IN (instant)
      |                                 ├── Marathi markers win ─► mr-IN
      |                                 └── Hindi markers win ──► hi-IN
      |
      ├── Latin script only ──────────► [Signal 2: English Dictionary Check]
      |                                        |
      |                                 ├── >30% common English words ► en-US (confirmed)
      |                                 └── <30% match + transliteration patterns ► suspect switch
      |                                        |
      |                                        └── Switch STT to hi-IN, re-detect next utterance
      |
      └── Mixed/Unknown ─────────────► keep current language
      |
      v
[Update sticky language for next utterance]
[Set recognition.lang in onend handler (between sessions)]
[Pass detected language to /api/chat]
[TTS auto-matches via settings sync (debounced 2s)]
```

#### Research Insights: Why Dual-Signal

The original plan assumed Devanagari script would always be present in Hindi/Marathi transcripts. Research revealed:

**Critical finding**: When Web Speech API's `recognition.lang` is set to `"en-US"` and the user speaks Hindi, the STT engine returns **Latin transliteration** (e.g., "kya haal hai" not "क्या हाल है"). The `\p{Script=Devanagari}` regex sees only Latin characters and incorrectly classifies as English.

**Solution**: Add a secondary English dictionary check. If the transcript is Latin but <30% of words match the top 200 common English words, suspect a language switch. Combined with transliteration phonetic patterns (consecutive consonant clusters uncommon in English like "ksh", "dh", "bh"), this achieves reliable detection.

**Self-correcting**: Once STT switches to `hi-IN` or `mr-IN`, subsequent transcripts WILL contain Devanagari — primary script detection takes over.

#### Why This Approach

| Approach | Viable? | Why/Why Not |
|----------|---------|-------------|
| Parallel SpeechRecognition instances | **NO** | Browser allows only ONE instance at a time |
| NLP libraries (franc, ELD, cld3) | Yes but overkill | 200KB-930KB bundle, Hindi/Marathi still confused |
| Script detection only | **NO** | STT transliterates to Latin when lang mismatch |
| Script detection + English dictionary | **YES (chosen)** | Zero deps, sub-ms, handles transliteration case |

#### Key Design Decisions

1. **Sticky Language**: Last detected language carries forward. Users typically speak one language for extended periods. Track with `consecutiveMatches` counter — require 2 consecutive matches before switching.
2. **Self-Correcting**: If user switches from English to Marathi, the first utterance is transliterated Latin. English dictionary check detects low match rate, switches STT to `hi-IN`. Second utterance transcribes correctly in Devanagari. Script detector confirms.
3. **No re-transcription**: We cannot replay audio. Accept the garbled first utterance as the cost of zero-dependency detection.
4. **Hindi vs Marathi**: 3-layer distinction:
   - Layer 1: Check for Marathi-exclusive `ळ` character → instant Marathi
   - Layer 2: Function word markers (pronouns, verbs, postpositions)
   - Layer 3: Suffix patterns (`-ला` vs `-को`, `-ने` vs `-ने`)
5. **Settings sync debounced**: Language changes trigger settings save debounced by 2 seconds to prevent thundering herd on rapid switches.
6. **State machine**: Recognition lifecycle uses explicit states (`IDLE | LISTENING | SWITCHING_LANG | PROCESSING | SPEAKING`) instead of boolean refs, preventing double-start and mic conflicts.

#### Research Insights: Marker Lists

**Marathi-exclusive markers**: ळ (exclusive character), मी, आहे, नाही, काय, मला, तुला, सांग, करतो, झालं, बोल, ये, जा, करा, आम्ही, तुम्ही, आणि, पण, कारण, म्हणून, असं, तसं, हे, ते

**Hindi markers**: मैं, है, नहीं, क्या, मुझे, बताओ, करो, मेरा, कैसा, और, लेकिन, क्योंकि, इसलिए, ऐसा, वैसा, यह, वह, हम, तुम, आप

**Pre-compiled regex** (at module level, not per-call):
```typescript
const DEVANAGARI_RE = /\p{Script=Devanagari}/u;
const LATIN_RE = /\p{Script=Latin}/u;
const MARATHI_EXCLUSIVE_RE = /ळ/; // Marathi-only character
```

#### Implementation Files

##### `src/types/language.ts` (NEW)

```typescript
// Single source of truth for language types across the app
export type SupportedLanguage = "en-US" | "hi-IN" | "mr-IN";

// en-IN supported by TTS but not STT detection
export type TtsLanguage = SupportedLanguage | "en-IN";
```

##### `src/lib/language-detector.ts` (NEW)

```typescript
import type { SupportedLanguage } from "@/types/language";

interface DetectionResult {
  language: SupportedLanguage;
  confidence: "high" | "low";
}

// Pre-compiled at module level
const DEVANAGARI_RE = /\p{Script=Devanagari}/u;
const MARATHI_EXCLUSIVE_RE = /ळ/;

// Top 200 common English words for dictionary check
const COMMON_ENGLISH: Set<string>; // populated at module level

// Script detection: \p{Script=Devanagari} vs \p{Script=Latin}
function detectScript(text: string): "devanagari" | "latin" | "mixed" | "unknown"

// Hindi vs Marathi: 3-layer morphological marker matching
function distinguishHindiMarathi(text: string): SupportedLanguage

// English dictionary check for Latin-script text (catches transliteration)
function isLikelyEnglish(text: string): boolean

// Main entry point
export function detectLanguage(transcript: string, current: SupportedLanguage): DetectionResult
```

##### `src/hooks/useBrowserVoice.ts` (MODIFY)

- Import `SupportedLanguage` from `@/types/language`
- Add `currentLangRef` to track sticky language across utterances
- Add `consecutiveMatchRef` — require 2 matches before switching
- After `onresult` gets final transcript, call `detectLanguage()`
- If language changed: set `recognition.lang` in `onend` handler (NOT during active session)
- Pass detected language (not just settings language) to `/api/chat`
- Add `onLanguageChange` callback to options interface
- Use state machine (`IDLE | LISTENING | SWITCHING_LANG | PROCESSING | SPEAKING`) instead of boolean refs
- Capture `activeMemberId` at transcript-finalization time, pass to LLM call

##### `src/app/page.tsx` (MODIFY)

- Add `onLanguageChange` callback to `useBrowserVoice` options
- When language changes: update `sttLanguage` state, debounced save to settings (2s), update TTS language
- Pass language to `/api/chat/stream` for text input too (detect from typed text via script detection)
- Single source of truth for `activeLanguage` state

##### `src/lib/offline-commands.ts` (MODIFY)

- Accept `language` parameter in `tryOfflineResponse(input, language?)`
- Return localized responses for common patterns (greetings, thanks, time) when language is `hi-IN` or `mr-IN`
- Keep English as fallback for complex responses

##### `src/hooks/useWakeWord.ts` (MODIFY)

- Update `recognition.lang` to match sticky language (currently hardcoded `"en-US"` at line 98)

---

### Feature 2: Speaker Identification

#### Architecture: Sequential Handoff with Meyda.js MFCC

```
[User activates voice mode]
      |
      v
[getUserMedia → single mic stream]
      |
      v
[Phase A: Speaker Identification (~1 second)]
      |
      AudioContext → MediaStreamSourceNode
      |
      Meyda Analyzer (bufferSize: 2048, ~21 callbacks/sec)
        Features: MFCC(13), RMS
      |
      VAD with hysteresis (startThreshold / endThreshold)
      |
      Buffer ~1 second of speech frames
      |
      Compute 16-dimensional feature vector:
        [mfcc_mean(13), spectral_centroid, spectral_rolloff, spectral_flatness]
      |
      L2 normalize → Cosine similarity vs stored voiceprints
      |
      Best match above threshold → identifiedSpeaker
      |
      v
[Stop Meyda analyzer, release AudioContext]
      |
      v
[Phase B: STT Processing]
      |
      SpeechRecognition starts (or native plugin on Android)
      |
      (normal voice pipeline continues)
      |
      v
[Auto-switch active family member + child safety check]
```

#### Research Insights: Why Sequential Handoff

| Approach | Viable? | Why/Why Not |
|----------|---------|-------------|
| Parallel mic (getUserMedia + STT) | **NO on Android** | Hardware mic is exclusive; dual streams fail |
| Sequential handoff (Meyda → STT) | **YES (chosen)** | Works on all devices; ~1s overhead |
| Continuous parallel on desktop | Possible | But inconsistent behavior across platforms |

**Performance research**: ScriptProcessorNode (used by Meyda) runs on main thread. With `bufferSize: 512`, ~86 callbacks/sec → 15-47% CPU on Android. With `bufferSize: 2048`, ~21 callbacks/sec → manageable. Combined with stopping after identification (not running continuously), battery impact is minimal.

**Android WebView**: `getUserMedia` IS supported in Android WebView. SpeechRecognition is NOT (need native plugin). Sequential handoff avoids the dual-stream problem entirely.

#### Child Safety: Fail-Closed Policy

**Critical security requirement**: Default to child-safe mode for ALL speakers until positively identified as an adult.

```
Speaker identified as enrolled adult? → Adult mode (full content)
Speaker identified as enrolled child? → Child safety mode
Speaker NOT identified (unknown)?    → Child safety mode (fail-closed)
No voice profiles enrolled?          → Use manual setting (current behavior)
```

This prevents the 2-3 second identification window from being exploited. The first utterance is always child-safe. Adult mode activates only after positive identification.

#### Enrollment Flow

```
Settings → Voice Profiles → [+ Enroll Voice]
      |
      v
Consent: "Your voice profile is stored on this device only
          and can be deleted anytime. Continue?"
      |
      v
"Let's learn your voice, [Name]."
"Read 3 short phrases. This takes 20 seconds."
      |
      v
Phrase 1: "Hey Vinegar, what's the weather today?"
Phrase 2: "Add milk and eggs to the grocery list."
Phrase 3: "Good morning Vinegar, I'm ready to start my day."
      |
      (Each phrase: record ~3s, extract MFCC, compute embedding)
      (Quality check: RMS > threshold, minimum 1.5s duration)
      (Simple pulsing dot animation during recording)
      |
      v
Average 3 embeddings → final voiceprint (16-dimensional)
      |
      v
Verification test: "Say anything to test."
      → "Recognized as [Name]! Voice profile saved."
      |
      v
Store voiceprint in SQLite family_members.voice_profile (JSON)
```

#### Research Insights: Enrollment

- **3 phrases sufficient** for home use with 4-5 family members. 5 phrases adds diminishing returns for the additional time cost.
- **Biometric consent required**: Voiceprints are biometric data under GDPR, BIPA, CCPA. Show explicit consent dialog before enrollment. Store consent timestamp.
- **Quality checks**: Require RMS above ambient noise threshold and minimum 1.5s duration. Reject and re-prompt if quality insufficient.
- **Verification test**: Critical for user confidence. If verification fails, offer re-enrollment.

#### Storage

**SQLite** (`family_members.voice_profile` column — already exists, currently unused):

```typescript
// Stored as JSON string in voice_profile column
interface StoredVoiceProfile {
  embedding: number[];           // 16 floats, L2 normalized (JSON-safe)
  enrolledAt: number;            // Unix timestamp
  consentTimestamp: number;      // When user gave biometric consent
}
```

**Why SQLite instead of IndexedDB**:
- Single source of truth (no split-brain between client IndexedDB and server SQLite)
- Server can check enrollment status directly
- Backs up with database
- MFCC feature vectors are NOT reversible to audio — safe to store server-side
- Column already exists and is unused

**API**: Load voiceprints via `/api/family` GET response. Save via `/api/family` POST with `action: 'enroll_voice'`.

#### Implementation Files

##### `src/lib/speaker-id-service.ts` (NEW)

```typescript
// Pure logic — no React dependency. Testable in isolation.
import type { SupportedLanguage } from "@/types/language";

interface VoiceEmbedding {
  familyMemberId: string;
  name: string;
  role: "parent" | "child";
  embedding: Float32Array;  // 16 floats, L2 normalized
}

interface IdentificationResult {
  memberId: string;
  name: string;
  role: "parent" | "child";
  confidence: number;       // 0-1 cosine similarity
}

// Cosine similarity with dimension validation
export function cosineSimilarity(a: Float32Array, b: Float32Array): number

// Compute 16-dimensional feature vector from MFCC frames
export function computeEmbedding(mfccFrames: Float32Array[]): Float32Array

// L2 normalize a vector in-place
export function l2Normalize(vec: Float32Array): Float32Array

// Match against stored profiles, return best match above threshold
export function identifySpeaker(
  embedding: Float32Array,
  profiles: VoiceEmbedding[],
  threshold?: number  // default 0.75
): IdentificationResult | null
```

##### `src/hooks/useSpeakerIdentification.ts` (NEW)

```typescript
// React wrapper around speaker-id-service
import type { IdentificationResult } from "@/lib/speaker-id-service";

interface UseSpeakerIdOptions {
  enabled?: boolean;         // default: false
  onSpeakerIdentified?: (speaker: IdentificationResult) => void;
}

interface UseSpeakerIdReturn {
  currentSpeaker: IdentificationResult | null;
  isIdentifying: boolean;
  error: string | null;
  identifyOnce: () => Promise<IdentificationResult | null>;
  // identifyOnce: starts mic → Meyda → identify → releases mic
  // Called once at voice session start, not continuously
}

// Manages: getUserMedia stream, AudioContext, Meyda analyzer
// MUST include cleanup useEffect:
//   - MediaStream tracks stopped
//   - AudioContext closed
//   - Meyda analyzer stopped
```

##### `src/components/voice-enrollment.tsx` (NEW)

```typescript
// Guided 3-phrase enrollment UI component
// Props: familyMember: {id, name, role}, onComplete, onCancel
// Shows: consent dialog → phrase prompts → pulsing dot animation → progress → verification test
// Saves voiceprint via /api/family POST with action: 'enroll_voice'
```

##### `src/components/settings-modal.tsx` (MODIFY)

- Add "Voice Profiles" section
- Show enrolled members with [Re-enroll] [Delete] buttons
- Show un-enrolled members with [Enroll Voice] button
- No auto-language toggle (always on)

##### `src/app/page.tsx` (MODIFY)

- Initialize `useSpeakerIdentification` hook
- Call `identifyOnce()` at voice session start (before STT begins)
- On speaker identified: update active family member via `/api/family` POST
- Apply fail-closed child safety: default to child-safe until adult confirmed
- Show small speaker name badge in UI (no confidence indicator)
- Capture speaker ID at transcript-finalization time, pass to LLM call

##### `src/app/api/family/route.ts` (MODIFY)

- **Fix is_active sync**: When switching active member, update BOTH `settings.active_family_member` AND `family_members.is_active` column in a single transaction
- Add `voice_profile` data to family member GET response (enrollment status + embedding for client-side matching)
- Add `action: 'enroll_voice'` POST handler to save voiceprint
- Add `action: 'voice_switch'` POST handler — no PIN required, limited permissions (personalization + child safety only)
- PIN-based switch remains for full access (settings, data)

##### `src/lib/llm-middleware.ts` (MODIFY)

- Accept `activeMemberId` and `detectedLanguage` in LLMOptions
- Inject `[Active Speaker: Name (role)]` into system prompt context via `buildMemoryContext()`
- Child safety check uses passed `activeMemberId` directly (not stale DB query)

##### `src/lib/vinegar-context.ts` (MODIFY)

- Update `VINEGAR_SYSTEM_PROMPT` to mention speaker identification and language detection capabilities

---

## Implementation Phases

### Phase 1: Auto Language Detection

- [x] Create `src/types/language.ts` with `SupportedLanguage` type (shared across all files)
- [x] Create `src/lib/language-detector.ts` with dual-signal detection:
  - Script detection (`\p{Script=Devanagari}` with `u` flag, pre-compiled)
  - English dictionary check (top 200 common words) for Latin-script text
  - 3-layer Hindi/Marathi distinction (ळ check, function words, suffix patterns)
- [x] Refactor `useBrowserVoice.ts`:
  - Import `SupportedLanguage` from shared types
  - Add state machine (`IDLE | LISTENING | SWITCHING_LANG | PROCESSING | SPEAKING`)
  - Add `currentLangRef` + `consecutiveMatchRef` for sticky language with 2-match threshold
  - Detect language after each final transcript
  - Set `recognition.lang` in `onend` handler (between sessions, not during)
  - Wire TTS completion via `onSpeakEnd` callback (replace duration estimation)
  - Capture `activeMemberId` at transcript time
- [x] In `page.tsx`: single source of truth for `activeLanguage` state
- [x] Debounced settings sync (2s) when language changes
- [x] Pass detected language to `/api/chat` and `/api/chat/stream`
- [x] Update `useWakeWord.ts`: match `recognition.lang` to sticky language
- [x] Update `offline-commands.ts`: accept `language` param, localize common responses
- [x] **Fix `is_active` column sync** in `/api/family` route (prerequisite for Phase 2 child safety)
- [x] Add `manage_language` tool to tool executor (get/set language for agent access)

### Phase 2: Speaker Identification (End-to-End)

- [x] `npm install meyda` (~30KB, MIT license)
- [x] Create `src/lib/speaker-id-service.ts` (pure logic: MFCC computation, cosine similarity, L2 normalize, identify)
- [x] Create `src/hooks/useSpeakerIdentification.ts` (React wrapper with cleanup useEffect)
- [x] Implement VAD with hysteresis (dual thresholds, consecutive frame counting)
- [x] Implement 16-dimensional feature vector computation (13 MFCC means + 3 spectral)
- [x] Implement sequential handoff: identify once → release mic → start STT
- [x] Add `action: 'enroll_voice'` to `/api/family` POST (save voiceprint to SQLite)
- [x] Add `action: 'voice_switch'` to `/api/family` POST (no PIN, limited permissions)
- [x] Create `src/components/voice-enrollment.tsx` (consent → 3 phrases → pulsing dot → verification)
- [x] Add Voice Profiles section to settings modal
- [x] Integrate in `page.tsx`: call `identifyOnce()` at voice session start
- [x] Apply fail-closed child safety: default child-safe for unknown speakers
- [x] Auto-switch active family member on identification
- [x] Show speaker name badge in main UI
- [x] Inject `[Active Speaker]` into LLM system prompt context
- [x] Tag conversation logs with identified speaker
- [x] Update `VINEGAR_SYSTEM_PROMPT` with speaker ID capabilities
- [x] Include voice enrollment status in `get_family` tool output
- [x] Add CSP header to prevent XSS extraction of voiceprint data

---

## Alternative Approaches Considered

### Language Detection

| Approach | Verdict | Reason |
|----------|---------|--------|
| Script detection only | **Insufficient** | STT transliterates to Latin when lang mismatch — misses language switches from English |
| NLP library (franc/ELD) | Rejected | 200KB+ bundle, Hindi/Marathi still confused on short text |
| Parallel STT instances | Impossible | Browser allows only one SpeechRecognition at a time |
| External API (Google, Azure) | Rejected | Privacy violation, adds latency + cost |
| User always selects language | Current state | Poor UX, the reason for this feature |
| Script + English dictionary check | **Chosen** | Catches transliteration case, zero deps, sub-ms |

### Speaker Identification

| Approach | Verdict | Reason |
|----------|---------|--------|
| Parallel mic (getUserMedia + STT) | **Fails on Android** | Hardware mic exclusive; dual streams crash |
| Sequential handoff (Meyda → STT) | **Chosen** | Works everywhere; ~1s overhead acceptable |
| Neural embeddings (ECAPA-TDNN) | Future | 25MB model, high accuracy but heavy for MVP |
| Server-side processing | Rejected | Privacy violation (audio must stay on device) |
| Voice commands ("Hey Vinegar, this is Dad") | Fallback | Manual, not passive recognition |
| PIN-based switching only | Current state | Works but not hands-free |
| IndexedDB for voiceprints | Rejected | Split-brain with SQLite; MFCC vectors are non-reversible, safe for SQLite |

---

## Acceptance Criteria

### Functional Requirements

- [ ] When user speaks Marathi, Vinegar auto-detects and responds in Marathi (within 1-2 utterances)
- [ ] When user speaks Hindi, same auto-detection behavior
- [ ] When user switches from Marathi to English mid-conversation, detects within 1 utterance
- [ ] When user switches from English to Hindi, detects within 2 utterances (transliteration → dictionary check → switch)
- [ ] Language detection works without any manual settings change
- [ ] Family members can enroll their voice via guided 3-phrase flow with biometric consent
- [ ] After enrollment, Vinegar identifies who is speaking within ~1 second
- [ ] Identified children automatically trigger child safety mode
- [ ] Unknown/unrecognized speakers default to child-safe mode (fail-closed)
- [ ] Active family member auto-switches based on voice identification
- [ ] Voice-based switching has limited permissions (no settings access without PIN)
- [ ] All voice data stays on-device (MFCC vectors in SQLite, never sent to external APIs)
- [ ] Offline responses localized to detected language for common patterns

### Non-Functional Requirements

- [ ] Language detection adds <1ms latency per utterance
- [ ] Speaker identification completes in <1.5 seconds before STT starts
- [ ] Meyda.js bundle adds <50KB to client
- [ ] Speaker identification accuracy >85% for 4-5 family members in quiet conditions
- [ ] Works in Android WebView (Capacitor 5) via native STT plugin
- [ ] Enrollment flow completes in <30 seconds (3 phrases)
- [ ] Meyda analyzer uses bufferSize 2048 (not 512) for reasonable CPU usage on mobile
- [ ] Settings sync debounced (2s) to prevent thundering herd
- [ ] CSP header present to protect stored voiceprint data

---

## Security Requirements

| # | Finding | Severity | Mitigation |
|---|---------|----------|------------|
| S1 | Child safety bypass via speaker misidentification | CRITICAL | Fail-closed: default to child-safe for unknown/unidentified speakers |
| S2 | Voiceprint extraction via XSS | HIGH | Add CSP header; MFCC vectors are non-reversible |
| S3 | Voice-switch bypasses PIN auth | HIGH | Tiered approach: voice_switch = limited perms, PIN = full access |
| S4 | Replay attack with recorded voice | MEDIUM | Basic liveness: check spectral flatness variance (recorded audio has less variance) |
| S5 | getUserMedia permission persistence | MEDIUM | Request permission once at enrollment; check permission state before identification |
| S6 | Enrollment UI XSS via family member names | MEDIUM | Sanitize names before rendering in enrollment component |
| S7 | Biometric data without consent | MEDIUM | Explicit consent dialog before enrollment; store consent timestamp |

---

## Performance Requirements

| # | Concern | Mitigation |
|---|---------|------------|
| P1 | Meyda ScriptProcessorNode on main thread | bufferSize: 2048 (21 callbacks/sec vs 86) |
| P2 | Battery drain from persistent mic | Stop Meyda after identification; don't run continuously |
| P3 | Dual mic streams on Android | Sequential handoff (Meyda first, then STT) |
| P4 | Settings sync thundering herd | Debounce language change sync by 2 seconds |
| P5 | CPU usage from unused features | Extract only MFCC(13) + RMS; drop spectralCentroid/rolloff/flatness from Meyda |
| P6 | Memory from voiceprint cache | Load voiceprints once at session start; 16 floats x 5 members = 320 bytes |

---

## Race Condition Mitigations

| # | Race Condition | Mitigation |
|---|----------------|------------|
| R1 | SpeechRecognition double-start | State machine prevents start in non-IDLE state |
| R2 | Language change during active STT | Set `recognition.lang` in `onend` handler, never during active session |
| R3 | Speaker changes between transcript and API call | Capture `activeMemberId` at `onresult` time, pass directly to LLM |
| R4 | TTS duration estimation unreliable | Wire `onSpeakEnd` callback from `useClientTTS` instead of timer |
| R5 | Multiple hooks fighting over mic | Sequential handoff: only one mic user at a time |
| R6 | Settings thundering herd | Debounce settings sync by 2s |
| R7 | Enrollment failure (AudioContext suspended) | Check `audioContext.state`; call `resume()` after user gesture |

---

## Agent-Native Requirements

These capabilities MUST be accessible via tools (not just UI):

| # | Capability | Tool | Implementation |
|---|-----------|------|----------------|
| A1 | Get/set language | `manage_language` | New tool: `{action: 'get'|'set', language: SupportedLanguage}` |
| A2 | Switch active member | Extend `get_family` | Add `action: 'switch'` with member ID |
| A3 | Active speaker context | System prompt | Inject `[Active Speaker: Name (role)]` into `buildMemoryContext()` |
| A4 | Voice enrollment status | `get_family` response | Include `voice_profile: 'enrolled' | null` per member |
| A5 | Language + member in chat | Request body | Pass `active_member_id` and `detected_language` in chat requests |

---

## Dependencies & Risks

### Dependencies
- **Meyda.js** (`npm install meyda`) — well-maintained, MIT license, ~30KB
- **@capacitor-community/speech-recognition** — needed for Android APK (WebView lacks SpeechRecognition)
- **SQLite `voice_profile` column** — already exists in `family_members` table, unused
- **getUserMedia** — requires HTTPS or capacitor:// scheme (check `androidScheme` setting)

### Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| STT transliteration detection insufficient | Medium | English dictionary check + transliteration patterns; self-corrects on next utterance |
| SpeechRecognition missing in WebView | **Confirmed** | Use @capacitor-community/speech-recognition for Android builds |
| Sequential handoff adds ~1s latency | Expected | Acceptable tradeoff for reliability; identify only at session start, not every utterance |
| Hindi/Marathi marker list insufficient | Low | Marathi-exclusive ळ provides strong signal; markers supplemented by suffix patterns |
| Speaker ID accuracy <85% in noisy rooms | Medium | Don't auto-switch below threshold; manual override always available |
| Meyda.js incompatible with Capacitor WebView | Low | Meyda uses standard WebAudio API; wide compatibility confirmed |
| Biometric regulatory issues | Low | Consent dialog, on-device storage, MFCC non-reversible, delete capability |

---

## Success Metrics

- **Language detection accuracy**: >95% correct language on 2nd+ utterance (self-corrected)
- **Hindi/Marathi distinction**: >85% correct on sentences of 4+ words
- **Transliteration detection**: >80% detection of non-English Latin text via dictionary check
- **Speaker identification accuracy**: >85% in typical home conditions
- **Child safety guarantee**: 100% fail-closed — no unfiltered content to unidentified speakers
- **Zero manual language switches needed**: user never has to open settings to change language
- **Zero PII leaks**: no audio or voiceprint data leaves the device

---

## References & Research

### Internal References
- Voice pipeline: `src/hooks/useBrowserVoice.ts`, `src/hooks/useClientTTS.ts`
- Family members schema: `src/lib/db.ts:60-72` (includes `voice_profile TEXT` column)
- Active member check: `src/lib/llm-middleware.ts:354` (child safety)
- Language prompts: `src/lib/vinegar-context.ts:42-57` (getLanguagePrompt)
- Settings pattern: `src/lib/db.ts:545-552` (getSetting/setSetting)
- Tool registration: `src/lib/tool-executor.ts:32-34` (registerTool)
- Wake word: `src/hooks/useWakeWord.ts:98` (hardcoded en-US)
- Offline commands: `src/lib/offline-commands.ts` (English-only responses)

### External Research
- Web Speech API `recognition.lang` is input-only (does NOT detect language)
- Browser enforces single SpeechRecognition instance
- **SpeechRecognition NOT supported in Android WebView** (Chromium bug #487255)
- **getUserMedia IS supported in Android WebView**
- **SpeechSynthesis IS supported in Android WebView**
- Meyda.js: MIT, 30KB, `createMeydaAnalyzer({audioContext, source, bufferSize, featureExtractors, callback})`
- MFCC + cosine similarity: 85-92% accuracy for 2-5 speakers (IEEE)
- Devanagari Unicode: U+0900-U+097F (main block), U+A8E0-U+A8FF (extended)
- ES2018 Unicode property escapes: `\p{Script=Devanagari}` with `u` flag
- Hindi and Marathi share same Unicode block — morphological distinction required
- `@capacitor-community/speech-recognition`: Native Android speech recognition for Capacitor

### Learnings Applied
- `docs/solutions/project-improvements/2026-02-15-plan-gap-analysis-and-improvements.md`: active member tracking prereqs, child safety wiring
- `docs/solutions/security-issues/2026-02-15-critical-security-fixes-auth-injection-pii.md`: stale closure patterns (useRef for booleans in audio handlers), PIN verification patterns

### Prior Brainstorm
- `docs/brainstorms/2026-02-20-v2-improvements-brainstorm.md` — covers TTS/STT language architecture

---
title: Android WebView Voice System Failures - TTS Callback Hangs, Wake Word Conflicts, Verbose Responses
date: 2026-02-25
category: runtime-errors
tags: [android, webview, speech-api, tts, stt, voice, state-machine, capacitor, web-speech-api]
severity: high
component: voice-system
affected_files:
  - src/hooks/useBrowserVoice.ts
  - src/hooks/useWakeWord.ts
  - src/app/page.tsx
  - src/lib/vinegar-context.ts
  - src/lib/llm-middleware.ts
symptoms:
  - STT dies after 1-2 voice responses, requiring manual voice reactivation
  - Wake word activation conflicts with active voice or fails entirely
  - Voice responses are excessively long, causing extended TTS playback delays
root_causes:
  - Android WebView SpeechSynthesis onend callback fails silently, leaving state machine stuck in SPEAKING state
  - Web Speech API enforces single SpeechRecognition instance; wake word passive listener conflicts with active voice listener
  - System prompt lacked brevity constraints for voice interactions
environment: Android WebView (Capacitor 5)
related_commits:
  - dceea2e
---

# Android WebView Voice System Failures

Three interconnected voice system bugs manifesting on Android WebView (Capacitor 5) that caused the voice assistant to become unresponsive after 1-2 interactions.

## Problem

After deploying the voice system with wake word detection, language detection, and speaker identification, users on Android experienced:

1. **Voice dies after 1-2 responses** — The assistant would answer the first query, then stop listening entirely. The microphone button showed "active" but no speech was being recognized.
2. **Wake word doesn't activate voice** — Saying "Vinegar" was detected but active voice either didn't start or immediately broke.
3. **Responses too long for voice** — When voice did work, the LLM gave 3-4 sentence responses that took too long to speak aloud.

All three bugs were interconnected: the verbose responses made the TTS callback bug more likely to trigger, and the wake word collision made recovery impossible without manual intervention.

---

## Solution

### Bug 1: STT Dies After 1-2 Responses (SPEAKING State Stuck)

#### Investigation

The voice system implements a state machine in `useBrowserVoice.ts`: IDLE → LISTENING → PROCESSING → SPEAKING → IDLE. During testing:

1. Voice works for the first query-response cycle
2. After TTS speaks the response, voice stops listening
3. Console shows state machine stuck in SPEAKING
4. Android WebView's `SpeechSynthesis.onend` callback never fires

#### Root Cause

The state machine relied on the TTS `onend` callback to transition from SPEAKING → IDLE. On Android WebView, this callback silently fails — it simply never fires. The codebase had a duration-estimation fallback, but it was only active when `onSpeakEndProp` was not provided. Since the parent component always provides this callback, the fallback was dead code on the one platform that needed it most.

#### Fix (`src/hooks/useBrowserVoice.ts`)

Added a safety timeout that **always** runs alongside the TTS callback:

```typescript
// Safety timeout ref
const speakingSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

// Clear safety timer when normal callback fires
const notifySpeakEnd = useCallback(() => {
  if (speakingSafetyTimerRef.current) {
    clearTimeout(speakingSafetyTimerRef.current);
    speakingSafetyTimerRef.current = null;
  }
  if (stateRef.current !== "SPEAKING") return;
  transitionTo("IDLE");
  restartListening();
}, []);

// ALWAYS set safety timeout when entering SPEAKING state
const handleSpeak = useCallback((text: string) => {
  if (speakingSafetyTimerRef.current) {
    clearTimeout(speakingSafetyTimerRef.current);
    speakingSafetyTimerRef.current = null;
  }
  transitionTo("SPEAKING");

  if (onSpeak) {
    onSpeak(text);
    // Android WebView TTS callbacks often fail silently
    const maxSpeakMs = Math.max(5000, (text.length / 10) * 1000 / 1.5 + 5000);
    speakingSafetyTimerRef.current = setTimeout(() => {
      speakingSafetyTimerRef.current = null;
      if (stateRef.current === "SPEAKING") {
        console.warn("[Voice] Safety timeout: forcing out of SPEAKING state");
        transitionTo("IDLE");
        restartListening();
      }
    }, maxSpeakMs);
  }
}, [onSpeak, notifySpeakEnd, restartListening]);
```

**Key decisions:**
- Safety timeout is generous (5s minimum + text-length estimate) to avoid cutting off normal TTS
- If the real `notifySpeakEnd` fires first, it clears the safety timer (no double-transition)
- Timer is cleared on disconnect/unmount to prevent memory leaks
- Logging only fires when the safety timeout actually triggers, aiding debugging

**Why it works:** Two parallel paths to exit SPEAKING state. On desktop where `onend` works, the timeout is cleared harmlessly. On Android where `onend` fails, the timeout catches it within a bounded time.

---

### Bug 2: Wake Word Conflicts with Active Voice (SpeechRecognition Collision)

#### Investigation

1. Wake word detected correctly
2. Active voice starts but immediately errors or doesn't listen
3. Web Speech API throws when two SpeechRecognition instances run simultaneously

#### Root Cause

The Web Speech API allows only **one** SpeechRecognition instance per tab. The wake word detector (`useWakeWord.ts`) runs a passive listener continuously. When the wake word is detected, it triggers `handleVoiceActivate()` which creates a new SpeechRecognition instance — but the wake word's passive listener is still running, causing a conflict.

#### Fix (`src/app/page.tsx` — wake word handoff)

```typescript
onWake: () => {
  if (!isActive) {
    // CRITICAL: Stop passive listening BEFORE starting active voice
    stopPassiveListening();
    setTimeout(() => {
      handleVoiceActivate();
    }, 200); // Small delay to let recognition fully stop
  }
},
```

#### Fix (`src/app/page.tsx` — voice toggle with lifecycle management)

```typescript
// When activating voice:
stopPassiveListening();
await new Promise(r => setTimeout(r, 200));
await speakerId.identifyOnce();
await connect();
await startListening();

// When deactivating voice:
disconnect();
setIsActive(false);
if (wakeWordEnabled) {
  setTimeout(() => startPassiveListening(), 500);
}
```

#### Fix (`src/hooks/useWakeWord.ts` — Android recovery)

```typescript
recognition.onend = () => {
  if (isPassiveListeningRef.current) {
    setTimeout(() => {
      if (isPassiveListeningRef.current && recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch {
          // On Android, start() can throw if recognition is in bad state
          // Recreate the instance after a longer delay
          setTimeout(() => {
            if (isPassiveListeningRef.current) {
              const fresh = new SpeechRecognition();
              fresh.continuous = true;
              fresh.interimResults = true;
              fresh.lang = recognitionRef.current?.lang ?? "en-US";
              fresh.onresult = recognitionRef.current?.onresult ?? null;
              fresh.onerror = recognitionRef.current?.onerror ?? null;
              fresh.onend = recognitionRef.current?.onend ?? null;
              recognitionRef.current = fresh;
              try { fresh.start(); } catch {}
            }
          }, 1000);
        }
      }
    }, 300);
  }
};
```

**Key decisions:**
- Explicit stop → delay → start sequencing respects the single-instance constraint
- 200ms delay for normal handoff, 1000ms for error recovery (Android needs longer)
- Passive listening resumes after voice deactivates (500ms delay for cleanup)
- Instance recreation as last resort when `start()` throws on Android

---

### Bug 3: Verbose Voice Responses

#### Root Cause

The system prompt didn't differentiate between text and voice input. Voice responses were treated like text chat, where longer context is expected.

#### Fix (`src/lib/vinegar-context.ts`)

Added explicit RESPONSE STYLE section to the system prompt:

```
RESPONSE STYLE:
- DEFAULT: 1-2 sentences MAX. Be direct. No filler, no preamble, no "Sure!".
- Only give longer answers if explicitly asked "explain", "tell me more", "in detail".
- For actions (set reminder, add grocery): confirm in <10 words.
- For questions: answer directly, then stop. No follow-up suggestions unless asked.
- For weather/traffic: give the key info in one line.
```

#### Fix (`src/lib/llm-middleware.ts`)

When `source: "voice"`, append a CRITICAL brevity instruction to the system prompt:

```typescript
const voiceBrevity = source === 'voice'
  ? '\n\nCRITICAL: This is a VOICE conversation. You MUST respond in 1-2 SHORT sentences only. No lists, no formatting, no explanations unless asked. Be like a human assistant giving a quick spoken answer.'
  : '';
const systemPrompt = `${VINEGAR_SYSTEM_PROMPT}${voiceBrevity}${languagePrompt}...`;
```

Voice requests pass `source: "voice"` from `useBrowserVoice.ts` to the API.

---

## Prevention

### Pattern: Safety Timeouts for Browser API Callbacks

Any browser callback that affects critical state should be paired with a safety timer:

```
1. Create safety timeout (expected duration + generous buffer)
2. In the real callback: clear the timeout immediately
3. If timeout fires: force transition to safe state, log warning
4. On unmount: clear the timeout
```

**Timeout guidelines by API:**

| Browser API | Safety Timeout Formula |
|---|---|
| SpeechSynthesis.onend | `max(5000, textLength/10 * 1000/speed + 5000)` |
| SpeechRecognition.onresult | 5000ms |
| getUserMedia | 5000ms |

### Pattern: Single-Instance Resource Management

When a browser API only allows one instance:

```
Step 1: Stop existing instance
Step 2: Wait 200ms (Android cleanup time)
Step 3: Clear all event handlers, null the ref
Step 4: Create new instance
Step 5: Attach handlers and start()
```

If `start()` throws on Android, wait 1000ms and recreate the instance from scratch.

### Android WebView Gotchas

1. **SpeechSynthesis.onend unreliable** — always pair with safety timeout
2. **SpeechRecognition needs instance recreation on error** — stop, wait 500-1000ms, create fresh
3. **Longer delays needed** — 200-500ms minimum between teardown/creation (vs <50ms on desktop)
4. **getUserMedia and SpeechRecognition conflict** — never run simultaneously; use sequential handoff
5. **cancel() + immediate speak() freezes synthesis** — add 10-50ms delay between
6. **Voice loading is async** — retry 4 times over 5 seconds (`useClientTTS.ts`)

### Testing Checklist

- [ ] Run 5+ consecutive voice query-response cycles on Android — verify state machine returns to IDLE each time
- [ ] Test wake word → active voice → sleep → wake word cycle 3 times rapidly
- [ ] Rapid voice toggle (on/off/on within 2 seconds) — no crashes, no stuck states
- [ ] Long TTS response (10+ seconds) completes naturally, state machine clears
- [ ] Console logs show clean state transitions with no gaps or duplicates
- [ ] Verify safety timeout fires correctly when TTS callback is blocked (mock test)
- [ ] Test error recovery: deny microphone mid-session, re-enable, retry

### Checklist: Before Shipping Voice Features

- [ ] Safety timeouts for all browser API callbacks
- [ ] Single-instance management for SpeechRecognition
- [ ] 200ms+ delay between stop() and new instance (500ms+ for error recovery)
- [ ] Wake word and active voice never run listeners simultaneously
- [ ] Speaker ID and voice input never share microphone concurrently
- [ ] All event handlers cleared before teardown
- [ ] All timers cleaned up on unmount

---

## Cross-References

- **Language detection & speaker ID plan**: `docs/plans/2026-02-21-feat-auto-language-detection-speaker-identification-plan.md` — architecture decisions, race condition mitigations
- **V2 privacy & multi-language plan**: `docs/plans/2026-02-20-feat-v2-privacy-multilang-docs-plan.md` — client-side TTS migration, voice loading retry strategy
- **Visual context panel plan**: `docs/plans/2026-02-22-feat-live-visual-context-panel-plan.md` — voice path integration with visual panel
- **Gap analysis**: `docs/solutions/project-improvements/2026-02-15-plan-gap-analysis-and-improvements.md` — TTS duration estimation heuristic (Section 2.4)
- **V2 brainstorm**: `docs/brainstorms/2026-02-20-v2-improvements-brainstorm.md` — external data leak analysis for TTS
- **Prior voice reliability fix**: commit `3e2fa26` — voice loading retry (4 retries over 5s), `speechSynthesis.cancel()` kick
- **TTS speed fix**: commit `db61572` — voice freezing on Android, TTS speed 1.8x

### Key Source Files

| File | Role |
|---|---|
| `src/hooks/useBrowserVoice.ts` | STT state machine, safety timers, echo gap |
| `src/hooks/useClientTTS.ts` | TTS chunking, voice loading retry, speak queue |
| `src/hooks/useWakeWord.ts` | Passive wake word, Android recovery |
| `src/hooks/useSpeakerIdentification.ts` | MFCC embedding, sequential mic handoff |
| `src/app/page.tsx` | Hook orchestration, lifecycle sequencing |
| `src/lib/vinegar-context.ts` | System prompt with response style rules |
| `src/lib/llm-middleware.ts` | Voice brevity injection |

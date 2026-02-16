# Vinegar App - Build & APK Plan

## Status: COMPLETE (APK ready)

## Overview
"Vinegar" - a family home AI assistant as an Android APK for Samsung tablet.
The APK is a thin WebView client connecting to the desktop Next.js server, so all
settings/features added on desktop auto-reflect in the app.

## Architecture
- **Server**: Next.js 14 running on desktop PC at `http://192.168.1.15:3000`
- **Android App**: Capacitor 5-wrapped WebView pointing to server URL
- **Why**: Any feature/setting change on desktop reflects immediately in app - no rebuild needed

## All Completed Steps
- [x] Rename Jarvis → Vinegar across entire codebase (including jarvis-context.ts → vinegar-context.ts)
- [x] Remove all "Dhruv" and "Jarvis" references from source code
- [x] Create `src/lib/offline-commands.ts` - handles greetings, time, date, math without LLM
- [x] Create `src/hooks/useWakeWord.ts` - Web Speech API wake word detection ("Vinegar")
- [x] Rewrite `src/app/page.tsx` - futuristic dark UI with orb, wake word, offline-first
- [x] Rewrite `src/app/globals.css` - dark futuristic design with glassmorphism
- [x] Add conversation logging (migration v5, conversation-logger.ts)
- [x] PII redaction verified working
- [x] Model routing fixed (only confirmed Euri models: gemini-2.5-flash, gpt-4o-mini, gemini-2.5-pro)
- [x] Token limits increased (8000 input, 2048 output)
- [x] Fix TypeScript build error - added `src/types/speech-recognition.d.ts`
- [x] Build-test passed - all 23 pages generated successfully
- [x] Capacitor 5 project created (Java 17 compatible)
- [x] Android permissions: INTERNET, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS, WAKE_LOCK, ACCESS_NETWORK_STATE
- [x] AndroidManifest.xml: cleartext traffic enabled for local network
- [x] MainActivity.java: auto-grant microphone permission in WebView
- [x] Capacitor config pointed to `http://192.168.1.15:3000`
- [x] APK built successfully: `Vinegar.apk` (3.5MB) at project root
- [x] HTTP file server available for APK transfer at `http://192.168.1.15:8080/Vinegar.apk`

## Remaining (User Manual Steps)
- [x] **Rename folder**: `dhruvjarvis` renamed to `vinegar-home` (DONE)
- [x] **Delete old folder**: `dhruvjarvis` deleted (was locked by orphaned Python HTTP server, fixed 2026-02-15)
- [ ] **Transfer APK**: Connect Samsung tablet via USB, copy `Vinegar.apk` to Downloads, or run `python -m http.server 8080` in vinegar-home and browse to `http://192.168.1.15:8080/Vinegar.apk`
- [ ] **Install APK**: Settings > Biometrics and security > Install unknown apps > allow browser
- [ ] **Start server**: `cd C:\Users\pbkap\Documents\euron\Projects\vinegar-home && npx next dev -H 0.0.0.0`

## How to Use
1. Start the server on your PC: `npx next dev -H 0.0.0.0`
2. Open the Vinegar app on your Samsung tablet
3. The app will connect to the server and show the futuristic UI
4. Say "Vinegar" to activate voice (or tap the orb)
5. Ask questions - simple ones answered offline, complex ones use the LLM

## How to Add Features / Change Settings
All changes are made on your PC in the source code. The tablet app is just a WebView,
so any change you make on the server is immediately reflected in the app.

Examples:
- Change the server code → restart server → tablet auto-updates
- Modify the UI in page.tsx → tablet shows new UI
- Add new API endpoints → tablet can use them immediately
- Change settings via the dashboard at `/dashboard`

## Key Files
- `src/app/page.tsx` - Main UI (futuristic orb, chat, wake word)
- `src/app/globals.css` - Dark theme styling
- `src/hooks/useWakeWord.ts` - Wake word detection hook
- `src/lib/offline-commands.ts` - Offline command handler
- `src/lib/vinegar-context.ts` - System prompt (was jarvis-context.ts)
- `src/lib/llm-middleware.ts` - LLM API calls with PII redaction
- `src/lib/db.ts` - SQLite database (vinegar.db)
- `src/lib/conversation-logger.ts` - Q&A logging
- `capacitor.config.ts` - Capacitor config (server IP here)
- `.env.local` - Contains EURI_API_KEY

## Rebuild APK (if needed)
If you change the server IP or need to rebuild:
```bash
# Update IP in capacitor.config.ts
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at: android/app/build/outputs/apk/debug/app-debug.apk
```

## Tech Stack
- Next.js 14 + React 18 + TailwindCSS + SQLite (better-sqlite3)
- Capacitor 5 (Java 17 compatible) for Android WebView wrapper
- Euri API for LLM (gemini-2.5-flash default, gpt-4o-mini for complex)
- Web Speech API for wake word detection
- PC LAN IP: 192.168.1.15

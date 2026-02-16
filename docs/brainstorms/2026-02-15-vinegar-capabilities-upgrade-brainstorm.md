# Vinegar Capabilities Upgrade - Brainstorm

**Date:** 2026-02-15
**Status:** Ready for planning

## What We're Building

Transform Vinegar from a solid foundation (70-80% of Phase 1-4 done) into a truly powerful, privacy-first home AI assistant with capabilities beyond imagination. All data stays on-premises - nothing personal leaves the server.

## Current State Analysis

### What Works (15 tools, 19 API routes, 16 DB tables)
- Text chat via Euri API (30+ models)
- Voice via Web Speech API (free STT) + Google TTS
- Premium voice via OpenAI Realtime API
- Family profiles with PIN protection
- Calendar CRUD with reminders + scheduler
- Grocery list with auto-categorization
- Task management with priorities
- Meal planning
- Kids' activities + chore system
- Extensible skill system (5 skill types)
- Memory system with vector embeddings
- Offline commands (30-40% of queries = 0 tokens)
- PII redaction pipeline
- Token budget management (200K/day)

### What's Broken / Missing
1. Wake word → sleep → wake cycle (FIXED in this session)
2. Data leaking to git (FIXED - .gitignore hardened)
3. No weather, traffic, store deals APIs
4. No PWA (can't install as mobile app, no push notifications)
5. No response streaming (text chat buffers entire response)
6. Google Calendar OAuth not implemented
7. No morning briefing
8. No proactive suggestions
9. Child safety mode not enforced
10. Skill auto-creation not implemented

## Key Decisions

### 1. Privacy-First: All Data Stays Local
- SQLite database on local server only
- .gitignore blocks all *.db, .env, backups/, logs/
- PII redacted before any external API calls
- Family names redacted for OpenAI (external), kept for Euri (text-only)
- No analytics, no telemetry, no cloud sync

### 2. Wake/Sleep Cycle (IMPLEMENTED)
- Say "Vinegar" → wakes up, activates voice
- Say "you can sleep now" / "go to sleep" / "bye vinegar" etc → sleeps, disconnects voice
- Passive listener keeps running → "Vinegar" wakes again
- Auto-sleep after 60s of silence
- Vinegar says "Going to sleep. Say Vinegar when you need me." on sleep

### 3. Capability Tiers (What to Build Next)

#### Tier 1: Essential (Makes it a real assistant)
- **Weather API** - OpenWeatherMap free tier (1K calls/day)
- **Response Streaming** - SSE for text chat, tokens appear instantly
- **Morning Briefing** - Daily summary: weather + calendar + tasks + grocery count
- **Web Search** - Let Vinegar search the internet for answers
- **Smart Home Awareness** - Time-aware greetings, date-aware reminders

#### Tier 2: Powerful (Beyond basic assistant)
- **Traffic/Commute** - Google Maps API for real-time ETAs
- **Store Deals** - Grocery deal checking
- **Skill Auto-Creation** - "Vinegar, learn a new skill" via voice
- **Proactive Suggestions** - Pattern-based reminders from usage history
- **Child Safety Mode** - Content filtering when child is active user

#### Tier 3: Transformative (Beyond imagination)
- **Compound Skills** - Chain multiple tools into workflows (morning routine)
- **Smart Notifications** - Push alerts for reminders, weather changes, deal alerts
- **Natural Language Scheduling** - "Find me 2 hours to work on the project"
- **Recipe AI** - Suggest meals based on what's in fridge + dietary restrictions
- **Budget Tracking** - Bill reminders, spending categories, subscription tracking
- **Local Whisper** - Private STT, no audio leaves the server

## Architecture Principles
1. Every new capability = a new tool in the registry (extensible)
2. Every tool works via both voice AND text (agent-native)
3. Offline fallbacks where possible (weather cache, etc.)
4. Token-efficient: cache responses, batch API calls
5. Privacy: PII redacted before any external call
6. No external dependencies that require cloud accounts (except API keys user chooses to add)

## Implementation Priority
1. Weather API + get_weather tool
2. Response streaming (SSE)
3. Morning briefing scheduled job
4. Web search tool (via Euri or free search API)
5. Traffic/commute tool
6. Proactive suggestions engine
7. Compound skills / workflows
8. PWA + push notifications

## Open Questions
- None - proceed to planning

## Next Step
Run `/workflows:plan` to create implementation plan from this brainstorm.

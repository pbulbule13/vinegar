/**
 * Server-side initialization.
 * Import this file once to register all tools and start background services.
 * Uses globalThis to prevent re-init on Next.js hot-reload.
 */

const globalForInit = globalThis as unknown as { __vinegarInitialized?: boolean };

if (!globalForInit.__vinegarInitialized) {
  globalForInit.__vinegarInitialized = true;

  // Register Phase 2 tools (calendar, reminders, family) via scheduler.ts side-effects
  require('./scheduler');

  // Register Phase 3 tools (grocery, meals, activities, chores, skills)
  require('./household-tools');

  // Start the scheduler (reminder evaluation loop)
  const { startScheduler } = require('./scheduler');
  startScheduler();

  // Start background worker (embeddings, backups, recurring events)
  const { startBackgroundWorker } = require('./background-worker');
  startBackgroundWorker();

  console.log('[Vinegar] Initialized: tools registered, scheduler started, background worker running');
}

export {};

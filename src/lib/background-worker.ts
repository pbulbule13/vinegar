/**
 * Phase 6: Background Worker System
 *
 * Manages periodic background tasks:
 * - Embedding generation (queue-based)
 * - Recurring event extension (weekly)
 * - Database backup (daily)
 * - Episode summarization
 */

import { db, generateId } from './db';
import { embedAllMemories } from './embeddings';
import { scanForSuggestions } from './suggestion-engine';
import * as fs from 'fs';
import * as path from 'path';

const globalForWorker = globalThis as unknown as { __vinegarWorkerStarted?: boolean };

const WORKER_INTERVAL_MS = 60000; // Check every minute
let workerId: ReturnType<typeof setInterval> | null = null;

interface Job {
  name: string;
  interval: number; // seconds between runs
  lastRun: number;
  handler: () => Promise<void>;
}

const jobs: Job[] = [
  {
    name: 'embed_memories',
    interval: 300, // Every 5 minutes
    lastRun: 0,
    handler: async () => {
      try {
        const result = await embedAllMemories();
        if (result.embedded > 0) {
          console.log(`[Worker] Embedded ${result.embedded} memories (${result.failed} failed)`);
        }
      } catch (err) {
        console.error('[Worker] Embedding job failed:', err);
      }
    },
  },
  {
    name: 'extend_recurring_events',
    interval: 86400, // Daily
    lastRun: 0,
    handler: async () => {
      try {
        // Find recurring activities that need extension (events ending in next 7 days)
        const oneWeek = Math.floor(Date.now() / 1000) + (7 * 86400);
        const twoWeeks = oneWeek + (7 * 86400);

        const recurring = db.prepare(`
          SELECT DISTINCT title, recurring, family_member_id, location
          FROM calendar_events
          WHERE recurring IS NOT NULL AND source = 'skill'
          AND start_time < ? AND start_time > ?
        `).all(oneWeek, Math.floor(Date.now() / 1000) - 86400) as Array<{
          title: string; recurring: string; family_member_id: string; location: string;
        }>;

        for (const event of recurring) {
          try {
            const config = JSON.parse(event.recurring);
            const days = config.day_of_week as number[];
            const [startH, startM] = (config.start_time || '16:00').split(':').map(Number);
            const [endH, endM] = (config.end_time || '17:00').split(':').map(Number);

            const now = new Date();
            for (let week = 2; week <= 3; week++) {
              for (const day of days) {
                const eventDate = new Date(now);
                const currentDay = eventDate.getDay();
                const daysUntil = ((day - currentDay + 7) % 7) + (week * 7);
                eventDate.setDate(eventDate.getDate() + daysUntil);

                const startTs = new Date(eventDate); startTs.setHours(startH, startM, 0, 0);
                const endTs = new Date(eventDate); endTs.setHours(endH, endM, 0, 0);

                const exists = db.prepare(
                  'SELECT id FROM calendar_events WHERE title = ? AND start_time = ?'
                ).get(event.title, Math.floor(startTs.getTime() / 1000));

                if (!exists) {
                  db.prepare(`
                    INSERT INTO calendar_events (id, title, start_time, end_time, location, family_member_id, source, recurring)
                    VALUES (?, ?, ?, ?, ?, ?, 'skill', ?)
                  `).run(
                    generateId('act'),
                    event.title,
                    Math.floor(startTs.getTime() / 1000),
                    Math.floor(endTs.getTime() / 1000),
                    event.location || null,
                    event.family_member_id,
                    event.recurring
                  );
                }
              }
            }
          } catch {}
        }

        console.log('[Worker] Extended recurring events');
      } catch (err) {
        console.error('[Worker] Event extension failed:', err);
      }
    },
  },
  {
    name: 'db_backup',
    interval: 86400, // Daily
    lastRun: 0,
    handler: async () => {
      try {
        const dbPath = path.join(process.cwd(), 'vinegar.db');
        const backupDir = path.join(process.cwd(), 'backups');

        if (!fs.existsSync(dbPath)) return;
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

        const date = new Date().toISOString().split('T')[0];
        const backupPath = path.join(backupDir, `vinegar-${date}.db`);

        // Skip if today's backup already exists
        if (fs.existsSync(backupPath)) {
          console.log(`[Worker] Backup already exists for ${date}, skipping`);
          return;
        }

        // Use SQLite backup API via VACUUM INTO
        db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);

        // Keep only last 7 backups
        const backups = fs.readdirSync(backupDir)
          .filter(f => f.startsWith('vinegar-') && f.endsWith('.db'))
          .sort()
          .reverse();

        for (const old of backups.slice(7)) {
          fs.unlinkSync(path.join(backupDir, old));
        }

        console.log(`[Worker] Database backed up to ${backupPath}`);
      } catch (err) {
        console.error('[Worker] Backup failed:', err);
      }
    },
  },
  {
    name: 'cleanup_old_logs',
    interval: 86400, // Daily
    lastRun: 0,
    handler: async () => {
      try {
        const thirtyDaysAgo = Math.floor(Date.now() / 1000) - (30 * 86400);

        // Clean old skill logs
        db.prepare('DELETE FROM skill_logs WHERE executed_at < ?').run(thirtyDaysAgo);

        // Clean old usage logs (keep 90 days)
        const ninetyDaysAgo = Math.floor(Date.now() / 1000) - (90 * 86400);
        db.prepare('DELETE FROM usage_logs WHERE created_at < ?').run(ninetyDaysAgo);

        console.log('[Worker] Cleaned old logs');
      } catch {}
    },
  },
  {
    name: 'proactive_suggestions',
    interval: 1800, // Every 30 minutes
    lastRun: 0,
    handler: async () => {
      try {
        scanForSuggestions();
      } catch (err) {
        console.error('[Worker] Suggestion scan failed:', err);
      }
    },
  },
  {
    name: 'morning_briefing_cache',
    interval: 3600, // Every hour
    lastRun: 0,
    handler: async () => {
      // Cache weather data during morning hours (6-10 AM) for fast briefing
      const hour = new Date().getHours();
      if (hour >= 6 && hour <= 10) {
        try {
          // Trigger weather cache refresh via tool executor
          const { executeTool } = require('./tool-executor');
          await executeTool('get_weather', {});
        } catch {}
      }
    },
  },
];

export function startBackgroundWorker(): void {
  if (globalForWorker.__vinegarWorkerStarted) return;
  globalForWorker.__vinegarWorkerStarted = true;

  console.log('[Worker] Starting background worker');

  workerId = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000);

    for (const job of jobs) {
      if (now - job.lastRun >= job.interval) {
        job.lastRun = now;
        try {
          await job.handler();
        } catch (err) {
          console.error(`[Worker] Job ${job.name} failed:`, err);
        }
      }
    }
  }, WORKER_INTERVAL_MS);
}

export function stopBackgroundWorker(): void {
  if (workerId) {
    clearInterval(workerId);
    workerId = null;
    globalForWorker.__vinegarWorkerStarted = false;
    console.log('[Worker] Stopped');
  }
}

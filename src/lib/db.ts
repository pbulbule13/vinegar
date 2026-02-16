/**
 * Vinegar SQLite Database
 * Single-file local database replacing JSON file storage.
 * Uses globalThis singleton for Next.js dev mode hot-reload safety.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DB_PATH = process.env.DATABASE_PATH || path.join(process.cwd(), 'vinegar.db');

function createDatabase(): Database.Database {
  const db = new Database(DB_PATH);

  // Busy timeout must come first — allows waiting when another process holds the lock
  db.pragma('busy_timeout = 5000');

  // Performance PRAGMAs
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');     // 64MB
  db.pragma('foreign_keys = ON');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');   // 256MB

  return db;
}

// globalThis singleton for dev mode hot-reload safety
const globalForDb = globalThis as unknown as { __vinegarDb?: Database.Database };

export const db: Database.Database = globalForDb.__vinegarDb ?? createDatabase();

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__vinegarDb = db;
}

// ─── Migration System ───

interface Migration {
  version: number;
  description: string;
  up: (db: Database.Database) => void;
}

const migrations: Migration[] = [
  {
    version: 1,
    description: 'Initial schema: schema_version, family_members, memories, tasks, usage_logs, settings',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
          version INTEGER PRIMARY KEY,
          applied_at INTEGER DEFAULT (unixepoch()),
          description TEXT
        );

        CREATE TABLE IF NOT EXISTS family_members (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('parent', 'child')),
          age INTEGER,
          birthday TEXT,
          pin_hash TEXT,
          voice_profile TEXT,
          dietary_restrictions TEXT,
          preferences TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS memories (
          id TEXT PRIMARY KEY,
          topic TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('fact','preference','routine','decision','person','conversation')),
          importance TEXT NOT NULL DEFAULT 'medium' CHECK(importance IN ('low','medium','high')),
          tags TEXT,
          family_member_id TEXT,
          access_count INTEGER DEFAULT 0,
          last_accessed INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance);
        CREATE INDEX IF NOT EXISTS idx_memories_topic ON memories(topic);
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed','cancelled')),
          priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','urgent')),
          assigned_to TEXT,
          due_date INTEGER,
          due_time TEXT,
          recurring TEXT,
          category TEXT,
          points INTEGER DEFAULT 0,
          completed_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (assigned_to) REFERENCES family_members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

        CREATE TABLE IF NOT EXISTS usage_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL,
          audio_input_tokens INTEGER DEFAULT 0,
          audio_output_tokens INTEGER DEFAULT 0,
          text_input_tokens INTEGER DEFAULT 0,
          text_output_tokens INTEGER DEFAULT 0,
          cost REAL DEFAULT 0,
          source TEXT DEFAULT 'voice' CHECK(source IN ('voice','text')),
          created_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER DEFAULT (unixepoch())
        );
      `);
    },
  },
  {
    version: 2,
    description: 'Phase 2: calendar_events, calendar_event_attendees, special_dates, scheduled_reminders',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS calendar_events (
          id TEXT PRIMARY KEY,
          external_id TEXT,
          title TEXT NOT NULL,
          description TEXT,
          start_time INTEGER NOT NULL,
          end_time INTEGER NOT NULL,
          all_day INTEGER DEFAULT 0,
          location TEXT,
          source TEXT NOT NULL DEFAULT 'manual'
            CHECK(source IN ('google','caldav','manual','holiday','birthday','skill')),
          calendar_name TEXT,
          family_member_id TEXT,
          reminder_minutes INTEGER,
          reminder_sent INTEGER DEFAULT 0,
          recurring TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_cal_start ON calendar_events(start_time);
        CREATE INDEX IF NOT EXISTS idx_cal_external ON calendar_events(external_id);
        CREATE INDEX IF NOT EXISTS idx_cal_member ON calendar_events(family_member_id);

        CREATE TABLE IF NOT EXISTS calendar_event_attendees (
          event_id TEXT NOT NULL,
          family_member_id TEXT NOT NULL,
          PRIMARY KEY (event_id, family_member_id),
          FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE,
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );

        CREATE TABLE IF NOT EXISTS special_dates (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          date TEXT NOT NULL,
          year_started INTEGER,
          family_member_id TEXT,
          reminder_days_before INTEGER DEFAULT 7,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );

        CREATE TABLE IF NOT EXISTS scheduled_reminders (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          message TEXT NOT NULL,
          cron_expression TEXT,
          next_fire_time INTEGER,
          target_member_id TEXT,
          source_type TEXT,
          source_id TEXT,
          is_active INTEGER DEFAULT 1,
          delivery_status TEXT DEFAULT 'pending',
          acknowledged_at INTEGER,
          snooze_count INTEGER DEFAULT 0,
          escalation_count INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (target_member_id) REFERENCES family_members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_reminders_next ON scheduled_reminders(next_fire_time);
        CREATE INDEX IF NOT EXISTS idx_reminders_active ON scheduled_reminders(is_active);
      `);
    },
  },
  {
    version: 3,
    description: 'Phase 3: grocery_items, meal_plans, skills, skill_logs',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS grocery_items (
          id TEXT PRIMARY KEY,
          item TEXT NOT NULL,
          quantity INTEGER DEFAULT 1,
          unit TEXT,
          category TEXT,
          added_by TEXT,
          completed INTEGER DEFAULT 0,
          completed_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (added_by) REFERENCES family_members(id)
        );

        CREATE TABLE IF NOT EXISTS meal_plans (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          meal_type TEXT NOT NULL CHECK(meal_type IN ('breakfast','lunch','dinner','snack')),
          recipe TEXT NOT NULL,
          ingredients TEXT,
          notes TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS skills (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          type TEXT NOT NULL,
          trigger_phrases TEXT NOT NULL,
          config TEXT NOT NULL,
          schedule TEXT,
          is_active INTEGER DEFAULT 1,
          created_by TEXT,
          last_used_at INTEGER,
          use_count INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (created_by) REFERENCES family_members(id)
        );

        CREATE TABLE IF NOT EXISTS skill_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          skill_id TEXT NOT NULL,
          executed_at INTEGER DEFAULT (unixepoch()),
          result TEXT,
          success INTEGER DEFAULT 1,
          error TEXT,
          FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );
      `);
    },
  },
  {
    version: 4,
    description: 'Phase 4: memory_embeddings, episodes',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS memory_embeddings (
          memory_id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          model TEXT NOT NULL,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS episodes (
          id TEXT PRIMARY KEY,
          event_type TEXT NOT NULL,
          summary TEXT NOT NULL,
          details TEXT,
          family_member_id TEXT,
          session_id TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );
      `);
    },
  },
  {
    version: 5,
    description: 'Phase 6: conversation_logs for full Q&A history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT,
          role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
          content TEXT NOT NULL,
          model TEXT,
          source TEXT DEFAULT 'text' CHECK(source IN ('text','stream','voice')),
          tools_used TEXT,
          tokens_in INTEGER DEFAULT 0,
          tokens_out INTEGER DEFAULT 0,
          family_member_id TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (family_member_id) REFERENCES family_members(id)
        );
        CREATE INDEX IF NOT EXISTS idx_convo_session ON conversation_logs(session_id);
        CREATE INDEX IF NOT EXISTS idx_convo_created ON conversation_logs(created_at);
        CREATE INDEX IF NOT EXISTS idx_convo_role ON conversation_logs(role);
      `);
    },
  },
  {
    version: 6,
    description: 'Phase 7: budget tracking, bills, kids activities log',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS budget_items (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL CHECK(type IN ('bill','subscription','expense','income')),
          name TEXT NOT NULL,
          amount REAL NOT NULL,
          category TEXT,
          frequency TEXT DEFAULT 'monthly' CHECK(frequency IN ('one_time','weekly','monthly','yearly')),
          due_date INTEGER,
          is_paid INTEGER DEFAULT 0,
          auto_remind INTEGER DEFAULT 1,
          notes TEXT,
          created_at INTEGER DEFAULT (unixepoch()),
          updated_at INTEGER DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_budget_type ON budget_items(type);
        CREATE INDEX IF NOT EXISTS idx_budget_due ON budget_items(due_date);

        CREATE TABLE IF NOT EXISTS kids_activity_log (
          id TEXT PRIMARY KEY,
          child_name TEXT NOT NULL,
          activity TEXT NOT NULL,
          date TEXT NOT NULL,
          duration_minutes INTEGER,
          notes TEXT,
          created_at INTEGER DEFAULT (unixepoch())
        );
      `);
    },
  },
];

export function runMigrations(): void {
  // Ensure schema_version table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER DEFAULT (unixepoch()),
      description TEXT
    );
  `);

  const currentVersion = (db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null })?.v ?? 0;

  const pending = migrations.filter(m => m.version > currentVersion);
  if (pending.length === 0) return;

  const runMigration = db.transaction(() => {
    for (const migration of pending) {
      // Re-check inside transaction to handle concurrent workers
      const alreadyApplied = db.prepare('SELECT 1 FROM schema_version WHERE version = ?').get(migration.version);
      if (alreadyApplied) continue;

      migration.up(db);
      db.prepare('INSERT OR IGNORE INTO schema_version (version, description) VALUES (?, ?)').run(
        migration.version,
        migration.description
      );
      console.log(`[DB] Migration ${migration.version}: ${migration.description}`);
    }
  });

  runMigration();
  console.log(`[DB] Migrations complete. Current version: ${pending[pending.length - 1].version}`);
}

// ─── JSON Import (one-time migration from legacy files) ───

export function importLegacyData(): void {
  const alreadyImported = db.prepare("SELECT value FROM settings WHERE key = 'legacy_import_done'").get();
  if (alreadyImported) return;

  const importTransaction = db.transaction(() => {
    // Import memories
    const memoryFile = path.join(process.cwd(), 'memory-data.json');
    if (fs.existsSync(memoryFile)) {
      try {
        const memories = JSON.parse(fs.readFileSync(memoryFile, 'utf-8'));
        const insertMemory = db.prepare(`
          INSERT OR IGNORE INTO memories (id, topic, content, type, importance, tags, access_count, last_accessed, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const m of memories) {
          const createdAt = m.timestamp ? Math.floor(new Date(m.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);
          const lastAccessed = m.lastAccessed ? Math.floor(new Date(m.lastAccessed).getTime() / 1000) : createdAt;
          insertMemory.run(
            m.id, m.topic, m.content,
            m.type || 'fact', m.importance || 'medium',
            JSON.stringify(m.tags || []),
            m.accessCount || 0, lastAccessed,
            createdAt, createdAt
          );
        }
        console.log(`[DB] Imported ${memories.length} memories from JSON`);
      } catch (err) {
        console.error('[DB] Failed to import memories:', err);
      }
    }

    // Import tasks
    const tasksFile = path.join(process.cwd(), 'tasks-data.json');
    if (fs.existsSync(tasksFile)) {
      try {
        const tasksList = JSON.parse(fs.readFileSync(tasksFile, 'utf-8'));
        const insertTask = db.prepare(`
          INSERT OR IGNORE INTO tasks (id, title, description, status, priority, due_date, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const t of tasksList) {
          const createdAt = t.createdAt ? Math.floor(new Date(t.createdAt).getTime() / 1000) : Math.floor(Date.now() / 1000);
          const updatedAt = t.updatedAt ? Math.floor(new Date(t.updatedAt).getTime() / 1000) : createdAt;
          const dueDate = t.dueDate ? Math.floor(new Date(t.dueDate).getTime() / 1000) : null;
          insertTask.run(
            t.id, t.title, t.description || null,
            t.status || 'pending', t.priority || 'medium',
            dueDate, createdAt, updatedAt
          );
        }
        console.log(`[DB] Imported ${tasksList.length} tasks from JSON`);
      } catch (err) {
        console.error('[DB] Failed to import tasks:', err);
      }
    }

    // Import usage logs
    const usageFile = path.join(process.cwd(), 'usage-data.json');
    if (fs.existsSync(usageFile)) {
      try {
        const usageList = JSON.parse(fs.readFileSync(usageFile, 'utf-8'));
        const insertUsage = db.prepare(`
          INSERT INTO usage_logs (model, audio_input_tokens, audio_output_tokens, text_input_tokens, text_output_tokens, cost, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const u of usageList) {
          const createdAt = u.timestamp ? Math.floor(new Date(u.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000);
          insertUsage.run(
            u.model, u.audioInputTokens || 0, u.audioOutputTokens || 0,
            u.textInputTokens || 0, u.textOutputTokens || 0,
            u.cost || 0, 'voice', createdAt
          );
        }
        console.log(`[DB] Imported ${usageList.length} usage logs from JSON`);
      } catch (err) {
        console.error('[DB] Failed to import usage logs:', err);
      }
    }

    // Mark import as done
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('legacy_import_done', '1')").run();
  });

  importTransaction();
}

// ─── Helper Functions ───

export function generateId(prefix: string = ''): string {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex').substring(0, 7);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch())').run(key, value);
}

// Run migrations on import (with retry for concurrent build workers)
try {
  runMigrations();
  importLegacyData();
} catch (err) {
  // During next build, multiple workers may race on DB — this is safe to ignore
  if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'SQLITE_BUSY') {
    console.warn('[DB] Migration skipped (database busy — likely concurrent build worker)');
  } else {
    throw err;
  }
}

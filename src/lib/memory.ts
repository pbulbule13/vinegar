/**
 * Vinegar Memory System — SQLite-backed
 *
 * SHORT-TERM: In-memory session buffer (last 20 exchanges, auto-clears)
 * LONG-TERM:  SQLite persistent storage
 * WORKING:    Compiled context injected into each AI call
 */

import { db, generateId } from './db';

// ─── Types ───

export type MemoryType = 'fact' | 'preference' | 'routine' | 'decision' | 'person' | 'conversation';

export interface MemoryEntry {
  id: string;
  topic: string;
  content: string;
  type: MemoryType;
  importance: 'low' | 'medium' | 'high';
  tags: string[];
  family_member_id?: string;
  access_count: number;
  last_accessed: number;
  created_at: number;
  updated_at: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to?: string;
  due_date?: number;
  due_time?: string;
  category?: string;
  points: number;
  completed_at?: number;
  created_at: number;
  updated_at: number;
}

// ─── Memory Store (SQLite) ───

class MemoryStore {
  private shortTerm: MemoryEntry[] = [];
  private maxShortTerm = 20;

  add(entry: {
    topic: string;
    content: string;
    type?: MemoryType;
    importance?: 'low' | 'medium' | 'high';
    tags?: string[];
    family_member_id?: string;
  }): MemoryEntry {
    const type = entry.type || 'fact';
    const importance = entry.importance || 'medium';
    const tags = entry.tags || [entry.topic.toLowerCase(), type];

    if (type === 'conversation') {
      // Short-term: in-memory only
      const newEntry: MemoryEntry = {
        id: generateId('mem'),
        topic: entry.topic,
        content: entry.content,
        type,
        importance,
        tags,
        access_count: 0,
        last_accessed: Math.floor(Date.now() / 1000),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };
      this.shortTerm.unshift(newEntry);
      if (this.shortTerm.length > this.maxShortTerm) {
        const overflow = this.shortTerm.splice(this.maxShortTerm);
        for (const item of overflow) {
          if (item.importance === 'high') {
            item.type = 'fact';
            this.saveToDB(item);
          }
        }
      }
      return newEntry;
    }

    // Long-term: check for duplicates, save to SQLite
    const existing = db.prepare(
      'SELECT id FROM memories WHERE topic = ? AND type = ? COLLATE NOCASE'
    ).get(entry.topic, type) as { id: string } | undefined;

    if (existing) {
      db.prepare(`
        UPDATE memories SET content = ?, importance = ?, tags = ?, access_count = access_count + 1,
        last_accessed = unixepoch(), updated_at = unixepoch() WHERE id = ?
      `).run(entry.content, importance, JSON.stringify(tags), existing.id);

      return this.getById(existing.id)!;
    }

    const id = generateId('mem');
    db.prepare(`
      INSERT INTO memories (id, topic, content, type, importance, tags, family_member_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(id, entry.topic, entry.content, type, importance, JSON.stringify(tags), entry.family_member_id || null);

    return this.getById(id)!;
  }

  private saveToDB(entry: MemoryEntry): void {
    db.prepare(`
      INSERT OR IGNORE INTO memories (id, topic, content, type, importance, tags, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.topic, entry.content, entry.type, entry.importance, JSON.stringify(entry.tags), entry.created_at, entry.updated_at);
  }

  private getById(id: string): MemoryEntry | null {
    const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToEntry(row);
  }

  private rowToEntry(row: Record<string, unknown>): MemoryEntry {
    return {
      id: row.id as string,
      topic: row.topic as string,
      content: row.content as string,
      type: row.type as MemoryType,
      importance: row.importance as 'low' | 'medium' | 'high',
      tags: row.tags ? JSON.parse(row.tags as string) : [],
      family_member_id: row.family_member_id as string | undefined,
      access_count: row.access_count as number,
      last_accessed: row.last_accessed as number,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }

  search(query: string, type?: MemoryType): MemoryEntry[] {
    const q = `%${query}%`;
    const results = db.prepare(`
      SELECT * FROM memories
      WHERE (content LIKE ? OR topic LIKE ? OR tags LIKE ?)
      ${type ? 'AND type = ?' : ''}
      ORDER BY
        CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
        created_at DESC
      LIMIT 10
    `).all(...(type ? [q, q, q, type] : [q, q, q])) as Record<string, unknown>[];

    // Track access
    if (results.length > 0) {
      db.prepare(`
        UPDATE memories SET access_count = access_count + 1, last_accessed = unixepoch()
        WHERE content LIKE ? OR topic LIKE ?
      `).run(q, q);
    }

    return [
      ...this.shortTerm.filter(e => {
        const text = `${e.content} ${e.topic} ${e.tags.join(' ')}`.toLowerCase();
        return text.includes(query.toLowerCase());
      }),
      ...results.map(r => this.rowToEntry(r)),
    ];
  }

  getByType(type: MemoryType): MemoryEntry[] {
    const rows = db.prepare('SELECT * FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT 20').all(type) as Record<string, unknown>[];
    return rows.map(r => this.rowToEntry(r));
  }

  getRecent(count = 10): MemoryEntry[] {
    const rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC LIMIT ?').all(count) as Record<string, unknown>[];
    return [...this.shortTerm.slice(0, count), ...rows.map(r => this.rowToEntry(r))].slice(0, count);
  }

  getAll(): MemoryEntry[] {
    const rows = db.prepare('SELECT * FROM memories ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToEntry(r));
  }

  clearSession(): void {
    this.shortTerm = [];
  }

  getMemoryContext(query?: string): string {
    const sections: string[] = [];

    // Level 0: Family members
    try {
      const members = db.prepare('SELECT name, role FROM family_members').all() as { name: string; role: string }[];
      if (members.length > 0) {
        sections.push(`[Family] ${members.map(m => `${m.name} (${m.role})`).join(', ')}`);
      }
    } catch {}

    // Short-term
    if (this.shortTerm.length > 0) {
      sections.push('[Session Context]');
      this.shortTerm.slice(0, 5).forEach(e => sections.push(`- ${e.topic}: ${e.content}`));
    }

    if (query) {
      const q = `%${query}%`;
      const scored = db.prepare(`
        SELECT topic, content, type, importance FROM memories
        WHERE content LIKE ? OR topic LIKE ? OR tags LIKE ?
        ORDER BY
          CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
          created_at DESC
        LIMIT 8
      `).all(q, q, q) as { topic: string; content: string; type: string; importance: string }[];

      if (scored.length > 0) {
        sections.push('[Relevant Memory]');
        scored.forEach(e => sections.push(`- [${e.type}] ${e.topic}: ${e.content}`));
      }
    } else {
      const typeOrder = [
        { type: 'person', label: 'People', limit: 5 },
        { type: 'preference', label: 'Preferences', limit: 5 },
        { type: 'routine', label: 'Routines', limit: 5 },
        { type: 'decision', label: 'Decisions', limit: 3 },
        { type: 'fact', label: 'Facts', limit: 5 },
      ];

      for (const { type, label, limit } of typeOrder) {
        const items = db.prepare(`
          SELECT topic, content FROM memories WHERE type = ?
          ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at DESC
          LIMIT ?
        `).all(type, limit) as { topic: string; content: string }[];

        if (items.length > 0) {
          sections.push(`[${label}]`);
          items.forEach(e => sections.push(`- ${e.topic}: ${e.content}`));
        }
      }
    }

    if (sections.length === 0) return '';
    return '\n--- VINEGAR MEMORY ---\n' + sections.join('\n') + '\n--- END MEMORY ---';
  }
}

// ─── Task Store (SQLite) ───

class TaskStore {
  create(title: string, description?: string, priority: Task['priority'] = 'medium', dueDate?: string): Task {
    const id = generateId('task');
    const dueDateTs = dueDate ? Math.floor(new Date(dueDate).getTime() / 1000) : null;

    db.prepare(`
      INSERT INTO tasks (id, title, description, priority, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
    `).run(id, title, description || null, priority, dueDateTs);

    return this.getById(id)!;
  }

  update(idOrTitle: string, updates: Partial<Pick<Task, 'status' | 'title' | 'description' | 'priority'>>): Task | null {
    const task = db.prepare(
      'SELECT id FROM tasks WHERE id = ? OR title LIKE ?'
    ).get(idOrTitle, `%${idOrTitle}%`) as { id: string } | undefined;

    if (!task) return null;

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.status) { setClauses.push('status = ?'); values.push(updates.status); }
    if (updates.title) { setClauses.push('title = ?'); values.push(updates.title); }
    if (updates.description) { setClauses.push('description = ?'); values.push(updates.description); }
    if (updates.priority) { setClauses.push('priority = ?'); values.push(updates.priority); }
    if (updates.status === 'completed') { setClauses.push('completed_at = unixepoch()'); }
    setClauses.push('updated_at = unixepoch()');
    values.push(task.id);

    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(task.id);
  }

  list(status?: Task['status']): Task[] {
    const query = status
      ? 'SELECT * FROM tasks WHERE status = ? ORDER BY due_date ASC NULLS LAST, created_at DESC'
      : "SELECT * FROM tasks WHERE status != 'completed' AND status != 'cancelled' ORDER BY due_date ASC NULLS LAST, created_at DESC";

    const rows = status
      ? db.prepare(query).all(status)
      : db.prepare(query).all();

    return (rows as Record<string, unknown>[]).map(r => this.rowToTask(r));
  }

  getAll(): Task[] {
    const rows = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all() as Record<string, unknown>[];
    return rows.map(r => this.rowToTask(r));
  }

  private getById(id: string): Task | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToTask(row);
  }

  private rowToTask(row: Record<string, unknown>): Task {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | undefined,
      status: row.status as Task['status'],
      priority: row.priority as Task['priority'],
      assigned_to: row.assigned_to as string | undefined,
      due_date: row.due_date as number | undefined,
      due_time: row.due_time as string | undefined,
      category: row.category as string | undefined,
      points: (row.points as number) || 0,
      completed_at: row.completed_at as number | undefined,
      created_at: row.created_at as number,
      updated_at: row.updated_at as number,
    };
  }
}

// ─── Exports (Singleton) ───

const globalForMemory = globalThis as unknown as { __vinegarMemory?: MemoryStore; __vinegarTasks?: TaskStore };

export const memory: MemoryStore = globalForMemory.__vinegarMemory ?? new MemoryStore();
export const tasks: TaskStore = globalForMemory.__vinegarTasks ?? new TaskStore();

if (process.env.NODE_ENV !== 'production') {
  globalForMemory.__vinegarMemory = memory;
  globalForMemory.__vinegarTasks = tasks;
}

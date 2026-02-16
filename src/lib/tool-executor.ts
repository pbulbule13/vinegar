/**
 * Unified Tool Executor
 * Single registry for voice + text + custom skills.
 * All tool calls go through executeTool().
 */

import { db, generateId } from './db';
import { vinegarEvents } from './events';

// ─── Types ───

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message?: string;
  error?: string;
}

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

interface RegisteredTool {
  name: string;
  description: string;
  handler: ToolHandler;
  source: 'builtin' | 'skill';
}

// ─── Tool Registry ───

const tools = new Map<string, RegisteredTool>();

export function registerTool(name: string, description: string, handler: ToolHandler, source: 'builtin' | 'skill' = 'builtin'): void {
  tools.set(name, { name, description, handler, source });
}

export function getRegisteredTools(): RegisteredTool[] {
  return Array.from(tools.values());
}

// ─── Execute ───

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const tool = tools.get(name);
  if (!tool) {
    // Try skill matching
    const skillResult = await executeSkillMatch(name, args);
    if (skillResult) return skillResult;
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    const result = await tool.handler(args);
    vinegarEvents.emit('tool:executed', { name, args, result });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Tool execution failed';
    return { success: false, error: message };
  }
}

// ─── Skill Matching ───

async function executeSkillMatch(query: string, args: Record<string, unknown>): Promise<ToolResult | null> {
  try {
    const skills = db.prepare('SELECT * FROM skills WHERE is_active = 1').all() as Array<{
      id: string; name: string; type: string; trigger_phrases: string; config: string;
    }>;

    for (const skill of skills) {
      const phrases = JSON.parse(skill.trigger_phrases) as string[];
      const queryLower = query.toLowerCase();
      const matched = phrases.some(p => queryLower.includes(p.toLowerCase()));
      if (matched) {
        return await executeSkill(skill, args);
      }
    }
  } catch {
    // Skills table might not exist yet
  }
  return null;
}

// SSRF protection: block requests to internal/private IPs
function isUrlSafe(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    // Block localhost, private IPs, link-local, and metadata endpoints
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '0.0.0.0') return false;
    if (hostname.startsWith('10.') || hostname.startsWith('172.') || hostname.startsWith('192.168.')) return false;
    if (hostname === '169.254.169.254') return false; // cloud metadata
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return true;
  } catch {
    return false;
  }
}

async function executeSkill(skill: { id: string; name: string; type: string; config: string }, args: Record<string, unknown>): Promise<ToolResult> {
  const config = JSON.parse(skill.config);
  const startTime = Date.now();

  try {
    let result: unknown;

    switch (skill.type) {
      case 'web_scraper': {
        const url = config.url || args.url;
        if (!url) return { success: false, error: 'No URL configured for scraper skill' };
        if (!isUrlSafe(url as string)) return { success: false, error: 'URL blocked: skills cannot access local or private network addresses' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url as string, { signal: controller.signal });
        clearTimeout(timeout);
        result = await res.text();
        // Truncate HTML for LLM processing
        if (typeof result === 'string' && result.length > 5000) {
          result = (result as string).substring(0, 5000);
        }
        break;
      }
      case 'api_caller': {
        const url = config.endpoint || args.url;
        if (!url) return { success: false, error: 'No endpoint configured for API skill' };
        if (!isUrlSafe(url as string)) return { success: false, error: 'URL blocked: skills cannot access local or private network addresses' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url as string, {
          method: config.method || 'GET',
          headers: config.headers || {},
          signal: controller.signal,
        });
        clearTimeout(timeout);
        result = await res.json();
        break;
      }
      case 'data_lookup': {
        const query = config.query || args.query;
        if (!query) return { success: false, error: 'No query configured for data lookup' };
        // Security: strict validation for data_lookup queries
        const queryStr = String(query).trim();
        const upperQuery = queryStr.toUpperCase();

        // Must start with SELECT
        if (!upperQuery.startsWith('SELECT')) {
          return { success: false, error: 'Data lookup skills only support SELECT queries' };
        }
        // Block ALL non-read keywords (comprehensive blocklist)
        if (/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA|REINDEX|VACUUM|LOAD_EXTENSION|REPLACE|SAVEPOINT|RELEASE|ROLLBACK|COMMIT|BEGIN)\b/i.test(queryStr)) {
          return { success: false, error: 'Data lookup skills cannot modify data or change database state' };
        }
        // Block access to sensitive tables
        const sensitiveTablePattern = /\b(family_members|settings|conversation_logs|usage_logs|skill_logs|memories)\b/i;
        if (sensitiveTablePattern.test(queryStr)) {
          return { success: false, error: 'Data lookup cannot access sensitive tables (family_members, settings, conversation_logs, memories). Use dedicated tools instead.' };
        }
        // Block subqueries that access sqlite internals
        if (/sqlite_master|sqlite_schema|sqlite_temp_master/i.test(queryStr)) {
          return { success: false, error: 'Data lookup cannot access SQLite system tables' };
        }
        // Limit result size
        if (!upperQuery.includes('LIMIT')) {
          return { success: false, error: 'Data lookup queries must include a LIMIT clause (max 100)' };
        }
        try {
          const rows = db.prepare(queryStr).all();
          result = Array.isArray(rows) && rows.length > 100 ? rows.slice(0, 100) : rows;
        } catch (sqlErr) {
          return { success: false, error: `Query error: ${sqlErr instanceof Error ? sqlErr.message : 'Unknown SQL error'}` };
        }
        break;
      }
      default:
        return { success: false, error: `Unsupported skill type: ${skill.type}` };
    }

    // Log execution
    db.prepare('INSERT INTO skill_logs (skill_id, result, success) VALUES (?, ?, 1)').run(skill.id, JSON.stringify(result));
    db.prepare('UPDATE skills SET last_used_at = unixepoch(), use_count = use_count + 1 WHERE id = ?').run(skill.id);

    return { success: true, data: result, message: `Skill "${skill.name}" executed successfully` };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Skill execution failed';
    try {
      db.prepare('INSERT INTO skill_logs (skill_id, success, error) VALUES (?, 0, ?)').run(skill.id, errorMsg);
    } catch {}
    return { success: false, error: errorMsg };
  }
}

// ─── Register Built-in Tools ───

// save_memory
registerTool('save_memory', 'Save information to persistent memory', (args) => {
  const { topic, content, type = 'fact', importance = 'medium', tags } = args as {
    topic: string; content: string; type?: string; importance?: string; tags?: string[];
  };

  if (!topic || !content) return { success: false, error: 'topic and content required' };

  const id = generateId('mem');
  const tagsJson = JSON.stringify(tags || [topic.toLowerCase(), type]);

  // Check for duplicates
  const existing = db.prepare('SELECT id FROM memories WHERE topic = ? AND type = ? COLLATE NOCASE').get(topic, type) as { id: string } | undefined;

  if (existing) {
    db.prepare('UPDATE memories SET content = ?, importance = ?, tags = ?, access_count = access_count + 1, last_accessed = unixepoch(), updated_at = unixepoch() WHERE id = ?')
      .run(content, importance, tagsJson, existing.id);
    return { success: true, data: { id: existing.id }, message: `Updated memory: ${topic}` };
  }

  db.prepare('INSERT INTO memories (id, topic, content, type, importance, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())')
    .run(id, topic, content, type, importance, tagsJson);

  vinegarEvents.emit('memory:saved', { id, topic, type });
  return { success: true, data: { id }, message: `Saved: ${topic}` };
});

// recall_memory
registerTool('recall_memory', 'Search memory for previously saved info', (args) => {
  const { query, type } = args as { query?: string; type?: string };

  let results;
  if (query) {
    const q = `%${query}%`;
    results = db.prepare(`
      SELECT topic, content, type, importance, created_at FROM memories
      WHERE (content LIKE ? OR topic LIKE ? OR tags LIKE ?)
      ${type ? 'AND type = ?' : ''}
      ORDER BY importance DESC, created_at DESC
      LIMIT 10
    `).all(...(type ? [q, q, q, type] : [q, q, q]));
  } else if (type) {
    results = db.prepare('SELECT topic, content, type, importance, created_at FROM memories WHERE type = ? ORDER BY created_at DESC LIMIT 10').all(type);
  } else {
    results = db.prepare('SELECT topic, content, type, importance, created_at FROM memories ORDER BY created_at DESC LIMIT 10').all();
  }

  // Update access counts
  if (query) {
    db.prepare(`UPDATE memories SET access_count = access_count + 1, last_accessed = unixepoch() WHERE content LIKE ? OR topic LIKE ?`).run(`%${query}%`, `%${query}%`);
  }

  return { success: true, data: { count: (results as unknown[]).length, memories: results } };
});

// manage_task
registerTool('manage_task', 'Create, update, or list tasks', (args) => {
  const { action = 'list', title, description, priority, status, due_date, category } = args as {
    action?: string; title?: string; description?: string; priority?: string; status?: string; due_date?: string; category?: string;
  };

  switch (action) {
    case 'create': {
      if (!title) return { success: false, error: 'title required' };
      const id = generateId('task');
      const dueDate = due_date ? Math.floor(new Date(due_date).getTime() / 1000) : null;
      db.prepare('INSERT INTO tasks (id, title, description, priority, due_date, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())')
        .run(id, title, description || null, priority || 'medium', dueDate, category || null);
      vinegarEvents.emit('task:created', { id, title, dueDate });
      return { success: true, data: { id, title }, message: `Task created: ${title}` };
    }
    case 'update': {
      if (!title) return { success: false, error: 'title required to find task' };
      const task = db.prepare('SELECT id, title FROM tasks WHERE title LIKE ? OR id = ?').get(`%${title}%`, title) as { id: string; title: string } | undefined;
      if (!task) return { success: false, error: `Task not found: ${title}` };

      const updates: string[] = [];
      const values: unknown[] = [];
      if (status) { updates.push('status = ?'); values.push(status); }
      if (priority) { updates.push('priority = ?'); values.push(priority); }
      if (description) { updates.push('description = ?'); values.push(description); }
      if (status === 'completed') { updates.push('completed_at = unixepoch()'); }
      updates.push('updated_at = unixepoch()');
      values.push(task.id);

      db.prepare(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      vinegarEvents.emit('task:updated', { id: task.id, status });
      return { success: true, data: { id: task.id, title: task.title, status }, message: `Task updated: ${task.title} -> ${status || 'updated'}` };
    }
    case 'list':
    default: {
      const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
      const filterStatus = status && validStatuses.includes(status) ? status : null;
      const tasks = filterStatus
        ? db.prepare(`
            SELECT id, title, description, status, priority, due_date, category, created_at
            FROM tasks WHERE status != 'cancelled' AND status = ?
            ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
              due_date ASC NULLS LAST, created_at DESC
            LIMIT 20
          `).all(filterStatus)
        : db.prepare(`
            SELECT id, title, description, status, priority, due_date, category, created_at
            FROM tasks WHERE status != 'cancelled'
            ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
              due_date ASC NULLS LAST, created_at DESC
            LIMIT 20
          `).all();
      return { success: true, data: { count: (tasks as unknown[]).length, tasks } };
    }
  }
});

// ─── Calendar Tools ───

// get_calendar
registerTool('get_calendar', 'Read calendar events for a date range', (args) => {
  const { start, end, family_member_id } = args as { start?: string; end?: string; family_member_id?: string };

  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400);
  const startTs = start ? Math.floor(new Date(start as string).getTime() / 1000) : dayStart;
  const endTs = end ? Math.floor(new Date(end as string).getTime() / 1000) : startTs + 7 * 86400; // default: next 7 days

  let query = 'SELECT id, title, description, start_time, end_time, all_day, location, source, family_member_id FROM calendar_events WHERE end_time >= ? AND start_time <= ?';
  const params: unknown[] = [startTs, endTs];

  if (family_member_id) {
    query += ' AND (family_member_id = ? OR family_member_id IS NULL)';
    params.push(family_member_id);
  }

  query += ' ORDER BY start_time ASC LIMIT 50';
  const events = db.prepare(query).all(...params) as Record<string, unknown>[];

  const formatted = events.map(e => ({
    ...e,
    all_day: Boolean(e.all_day),
    start: new Date((e.start_time as number) * 1000).toISOString(),
    end: new Date((e.end_time as number) * 1000).toISOString(),
  }));

  return { success: true, data: { count: formatted.length, events: formatted } };
});

// create_event
registerTool('create_event', 'Create a new calendar event', (args) => {
  const { title, start_time, end_time, description, location, all_day, reminder_minutes, family_member_id } = args as {
    title: string; start_time: string; end_time: string; description?: string; location?: string;
    all_day?: boolean; reminder_minutes?: number; family_member_id?: string;
  };

  if (!title || !start_time || !end_time) return { success: false, error: 'title, start_time, and end_time required' };

  const id = generateId('evt');
  const startTs = Math.floor(new Date(start_time).getTime() / 1000);
  const endTs = Math.floor(new Date(end_time).getTime() / 1000);

  if (isNaN(startTs) || isNaN(endTs)) return { success: false, error: 'Invalid date format. Use ISO format (e.g., 2026-02-15T10:00:00)' };

  db.prepare(`
    INSERT INTO calendar_events (id, title, description, start_time, end_time, all_day, location, family_member_id, reminder_minutes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(id, title, description || null, startTs, endTs, all_day ? 1 : 0, location || null, family_member_id || null, reminder_minutes || null);

  // Auto-create reminder if specified
  if (reminder_minutes && reminder_minutes > 0) {
    const remId = generateId('rem');
    const reminderTime = startTs - (reminder_minutes * 60);
    db.prepare(`
      INSERT INTO scheduled_reminders (id, type, message, next_fire_time, source_type, source_id)
      VALUES (?, 'one_time', ?, ?, 'calendar', ?)
    `).run(remId, `Reminder: ${title} in ${reminder_minutes} minutes`, reminderTime, id);
  }

  vinegarEvents.emit('calendar:event_created', { id, title, startTs });
  return { success: true, data: { id }, message: `Event created: ${title}` };
});

// update_event
registerTool('update_event', 'Update an existing calendar event', (args) => {
  const { id, title, start_time, end_time, description, location } = args as {
    id: string; title?: string; start_time?: string; end_time?: string; description?: string; location?: string;
  };

  if (!id) return { success: false, error: 'Event id required' };

  // Look up by id or title match
  let event = db.prepare('SELECT id, title FROM calendar_events WHERE id = ?').get(id) as { id: string; title: string } | undefined;
  if (!event) {
    event = db.prepare('SELECT id, title FROM calendar_events WHERE title LIKE ? ORDER BY start_time DESC LIMIT 1').get(`%${id}%`) as { id: string; title: string } | undefined;
  }
  if (!event) return { success: false, error: `Event not found: ${id}` };

  const updates: string[] = [];
  const values: unknown[] = [];

  if (title) { updates.push('title = ?'); values.push(title); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (start_time) { updates.push('start_time = ?'); values.push(Math.floor(new Date(start_time).getTime() / 1000)); }
  if (end_time) { updates.push('end_time = ?'); values.push(Math.floor(new Date(end_time).getTime() / 1000)); }
  if (location !== undefined) { updates.push('location = ?'); values.push(location); }

  if (updates.length === 0) return { success: false, error: 'No updates provided' };
  updates.push('updated_at = unixepoch()');
  values.push(event.id);

  db.prepare(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  vinegarEvents.emit('calendar:event_updated', { id: event.id });
  return { success: true, data: { id: event.id }, message: `Event updated: ${event.title}` };
});

// delete_event
registerTool('delete_event', 'Delete/cancel a calendar event', (args) => {
  const { id, scope = 'this_instance' } = args as { id: string; scope?: string };

  if (!id) return { success: false, error: 'Event id required' };

  let event = db.prepare('SELECT id, title, recurring FROM calendar_events WHERE id = ?').get(id) as { id: string; title: string; recurring: string | null } | undefined;
  if (!event) {
    event = db.prepare('SELECT id, title, recurring FROM calendar_events WHERE title LIKE ? ORDER BY start_time DESC LIMIT 1').get(`%${id}%`) as { id: string; title: string; recurring: string | null } | undefined;
  }
  if (!event) return { success: false, error: `Event not found: ${id}` };

  if (scope === 'entire_series' && event.recurring) {
    // Delete all events with the same recurring config
    const count = db.prepare('DELETE FROM calendar_events WHERE recurring = ? AND title = ?').run(event.recurring, event.title);
    db.prepare("DELETE FROM scheduled_reminders WHERE source_type = 'calendar' AND source_id IN (SELECT id FROM calendar_events WHERE recurring = ? AND title = ?)").run(event.recurring, event.title);
    return { success: true, message: `Deleted entire series: ${event.title}` };
  } else if (scope === 'all_future') {
    const eventData = db.prepare('SELECT start_time FROM calendar_events WHERE id = ?').get(event.id) as { start_time: number };
    db.prepare('DELETE FROM calendar_events WHERE title = ? AND start_time >= ?').run(event.title, eventData.start_time);
    return { success: true, message: `Deleted this and all future: ${event.title}` };
  }

  // Default: delete single instance
  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(event.id);
  db.prepare("DELETE FROM scheduled_reminders WHERE source_type = 'calendar' AND source_id = ?").run(event.id);
  vinegarEvents.emit('calendar:event_deleted', { id: event.id });
  return { success: true, message: `Event deleted: ${event.title}` };
});

// ─── Reminder Tool ───

// set_reminder
registerTool('set_reminder', 'Create a reminder or alarm', (args) => {
  const { message, time, type = 'one_time', target_member } = args as {
    message: string; time: string; type?: string; target_member?: string;
  };

  if (!message || !time) return { success: false, error: 'message and time required' };

  // Parse time - support relative times like "in 30 minutes", "in 2 hours"
  let fireTime: number;
  const relativeMatch = time.match(/^in\s+(\d+)\s*(minute|min|hour|hr|second|sec|day)s?$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const multipliers: Record<string, number> = { minute: 60, min: 60, hour: 3600, hr: 3600, second: 1, sec: 1, day: 86400 };
    fireTime = Math.floor(Date.now() / 1000) + (amount * (multipliers[unit] || 60));
  } else {
    fireTime = Math.floor(new Date(time).getTime() / 1000);
    if (isNaN(fireTime)) return { success: false, error: 'Invalid time format. Use ISO date or "in X minutes"' };
  }

  // Resolve target member name to ID
  let targetMemberId: string | null = null;
  if (target_member) {
    const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${target_member}%`) as { id: string } | undefined;
    targetMemberId = member?.id || null;
  }

  const id = generateId('rem');
  db.prepare(`
    INSERT INTO scheduled_reminders (id, type, message, next_fire_time, target_member_id, source_type)
    VALUES (?, ?, ?, ?, ?, 'manual')
  `).run(id, type, message, fireTime, targetMemberId);

  const fireDate = new Date(fireTime * 1000);
  vinegarEvents.emit('reminder:created', { id, message, fireTime });
  return { success: true, data: { id }, message: `Reminder set: "${message}" at ${fireDate.toLocaleString()}` };
});

// ─── Grocery Tool ───

const GROCERY_CATEGORIES: Record<string, string> = {
  milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy', cream: 'dairy', eggs: 'dairy',
  apple: 'produce', banana: 'produce', lettuce: 'produce', tomato: 'produce', onion: 'produce',
  potato: 'produce', carrot: 'produce', broccoli: 'produce', spinach: 'produce', avocado: 'produce',
  bread: 'bakery', bagel: 'bakery', muffin: 'bakery', cake: 'bakery',
  chicken: 'meat', beef: 'meat', pork: 'meat', fish: 'seafood', shrimp: 'seafood', salmon: 'seafood',
  rice: 'grains', pasta: 'grains', cereal: 'grains', oats: 'grains',
  juice: 'beverages', soda: 'beverages', water: 'beverages', coffee: 'beverages', tea: 'beverages',
  chips: 'snacks', cookies: 'snacks', crackers: 'snacks',
  soap: 'household', paper: 'household', detergent: 'household', trash: 'household',
};

function detectGroceryCategory(item: string): string {
  const lower = item.toLowerCase();
  for (const [keyword, cat] of Object.entries(GROCERY_CATEGORIES)) {
    if (lower.includes(keyword)) return cat;
  }
  return 'other';
}

// manage_grocery
registerTool('manage_grocery', 'Add, remove, complete, or list grocery items', (args) => {
  const { action = 'list', item, quantity, unit, category } = args as {
    action?: string; item?: string; quantity?: number; unit?: string; category?: string;
  };

  switch (action) {
    case 'add': {
      if (!item) return { success: false, error: 'item required' };
      const normalized = item.toLowerCase().trim().replace(/s$/, '');

      // Dedup: check for existing uncompleted item
      const existing = db.prepare('SELECT id, quantity FROM grocery_items WHERE LOWER(item) LIKE ? AND completed = 0').get(`%${normalized}%`) as { id: string; quantity: number } | undefined;
      if (existing) {
        const newQty = existing.quantity + (quantity || 1);
        db.prepare('UPDATE grocery_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
        return { success: true, data: { id: existing.id }, message: `Updated ${item} quantity to ${newQty}` };
      }

      const id = generateId('groc');
      const autoCategory = category || detectGroceryCategory(item);
      db.prepare('INSERT INTO grocery_items (id, item, quantity, unit, category) VALUES (?, ?, ?, ?, ?)')
        .run(id, item, quantity || 1, unit || null, autoCategory);

      vinegarEvents.emit('grocery:added', { id, item });
      return { success: true, data: { id }, message: `Added ${item} to grocery list` };
    }
    case 'complete': {
      if (!item) return { success: false, error: 'item name required' };
      const result = db.prepare('UPDATE grocery_items SET completed = 1, completed_at = unixepoch() WHERE item LIKE ? AND completed = 0').run(`%${item}%`);
      return result.changes > 0
        ? { success: true, message: `Marked ${item} as done` }
        : { success: false, error: `Item not found: ${item}` };
    }
    case 'remove': {
      if (!item) return { success: false, error: 'item name required' };
      db.prepare('DELETE FROM grocery_items WHERE item LIKE ?').run(`%${item}%`);
      return { success: true, message: `Removed ${item}` };
    }
    case 'clear_completed': {
      const result = db.prepare('DELETE FROM grocery_items WHERE completed = 1').run();
      return { success: true, message: `Cleared ${result.changes} completed items` };
    }
    case 'list':
    default: {
      const items = db.prepare('SELECT id, item, quantity, unit, category FROM grocery_items WHERE completed = 0 ORDER BY category, item').all();
      return { success: true, data: { count: (items as unknown[]).length, items } };
    }
  }
});

// ─── Meals Tool ───

// manage_meals
registerTool('manage_meals', 'Plan meals for specific dates', (args) => {
  const { action = 'get', date, meal_type, recipe, ingredients } = args as {
    action?: string; date?: string; meal_type?: string; recipe?: string; ingredients?: string[];
  };

  switch (action) {
    case 'plan': {
      if (!date || !meal_type || !recipe) return { success: false, error: 'date, meal_type, and recipe required' };

      // Upsert: replace if same date+meal_type exists
      const existing = db.prepare('SELECT id FROM meal_plans WHERE date = ? AND meal_type = ?').get(date, meal_type) as { id: string } | undefined;
      if (existing) {
        db.prepare('UPDATE meal_plans SET recipe = ?, ingredients = ? WHERE id = ?')
          .run(recipe, ingredients ? JSON.stringify(ingredients) : null, existing.id);

        return { success: true, data: { id: existing.id }, message: `Updated ${meal_type} for ${date}: ${recipe}` };
      }

      const id = generateId('meal');
      db.prepare('INSERT INTO meal_plans (id, date, meal_type, recipe, ingredients) VALUES (?, ?, ?, ?, ?)')
        .run(id, date, meal_type, recipe, ingredients ? JSON.stringify(ingredients) : null);

      // Auto-add ingredients to grocery list
      if (ingredients && ingredients.length > 0) {
        for (const ingredient of ingredients) {
          const exists = db.prepare('SELECT id FROM grocery_items WHERE LOWER(item) LIKE ? AND completed = 0').get(`%${ingredient.toLowerCase().trim()}%`);
          if (!exists) {
            db.prepare('INSERT INTO grocery_items (id, item, category) VALUES (?, ?, ?)').run(generateId('groc'), ingredient, 'other');
          }
        }
      }

      vinegarEvents.emit('meal:planned', { id, date, meal_type, recipe });
      return { success: true, data: { id }, message: `Planned ${recipe} for ${meal_type} on ${date}` };
    }
    case 'get': {
      const queryDate = date || new Date().toISOString().split('T')[0];
      const meals = db.prepare('SELECT id, date, meal_type, recipe, ingredients, notes FROM meal_plans WHERE date = ? ORDER BY CASE meal_type WHEN \'breakfast\' THEN 1 WHEN \'lunch\' THEN 2 WHEN \'dinner\' THEN 3 WHEN \'snack\' THEN 4 END').all(queryDate) as Record<string, unknown>[];
      const formatted = meals.map(m => ({ ...m, ingredients: m.ingredients ? JSON.parse(m.ingredients as string) : [] }));
      return { success: true, data: { date: queryDate, count: formatted.length, meals: formatted } };
    }
    case 'list': {
      // List this week's meals
      const today = new Date();
      const dayOfWeek = today.getDay();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - dayOfWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      const startStr = weekStart.toISOString().split('T')[0];
      const endStr = weekEnd.toISOString().split('T')[0];

      const meals = db.prepare('SELECT * FROM meal_plans WHERE date BETWEEN ? AND ? ORDER BY date, CASE meal_type WHEN \'breakfast\' THEN 1 WHEN \'lunch\' THEN 2 WHEN \'dinner\' THEN 3 WHEN \'snack\' THEN 4 END').all(startStr, endStr) as Record<string, unknown>[];
      const formatted = meals.map(m => ({ ...m, ingredients: m.ingredients ? JSON.parse(m.ingredients as string) : [] }));
      return { success: true, data: { week: `${startStr} to ${endStr}`, count: formatted.length, meals: formatted } };
    }
    default:
      return { success: false, error: `Unknown action: ${action}. Use plan, get, or list.` };
  }
});

// ─── Activity Tool ───

// manage_activity
registerTool('manage_activity', 'Manage kids\' recurring activities', (args) => {
  const { action = 'list', title, child_name, day_of_week, start_time, end_time, location } = args as {
    action?: string; title?: string; child_name?: string; day_of_week?: number[];
    start_time?: string; end_time?: string; location?: string;
  };

  switch (action) {
    case 'create': {
      if (!title || !child_name || !day_of_week || !start_time || !end_time) {
        return { success: false, error: 'title, child_name, day_of_week, start_time, and end_time required' };
      }

      // Resolve child name to ID
      const child = db.prepare('SELECT id, name FROM family_members WHERE name LIKE ?').get(`%${child_name}%`) as { id: string; name: string } | undefined;
      if (!child) return { success: false, error: `Family member not found: ${child_name}` };

      // Create calendar events for the next 4 weeks
      const now = new Date();
      const eventIds: string[] = [];

      for (let week = 0; week < 4; week++) {
        for (const day of day_of_week) {
          const eventDate = new Date(now);
          const currentDay = eventDate.getDay();
          const daysUntil = ((day - currentDay + 7) % 7) + (week * 7);
          eventDate.setDate(eventDate.getDate() + daysUntil);

          if (eventDate < now && week === 0) continue;

          const [startH, startM] = start_time.split(':').map(Number);
          const [endH, endM] = end_time.split(':').map(Number);

          const startTs = new Date(eventDate);
          startTs.setHours(startH, startM, 0, 0);
          const endTs = new Date(eventDate);
          endTs.setHours(endH, endM, 0, 0);

          const id = generateId('act');
          db.prepare(`
            INSERT INTO calendar_events (id, title, start_time, end_time, location, family_member_id, source, recurring)
            VALUES (?, ?, ?, ?, ?, ?, 'skill', ?)
          `).run(
            id, title,
            Math.floor(startTs.getTime() / 1000), Math.floor(endTs.getTime() / 1000),
            location || null, child.id,
            JSON.stringify({ day_of_week, start_time, end_time })
          );
          eventIds.push(id);
        }
      }

      vinegarEvents.emit('activity:created', { title, child: child.name, events: eventIds.length });
      return { success: true, data: { eventsCreated: eventIds.length }, message: `Activity "${title}" created for ${child.name} with ${eventIds.length} events over 4 weeks` };
    }
    case 'get_today': {
      const now = Math.floor(Date.now() / 1000);
      const dayStart = now - (now % 86400);
      const dayEnd = dayStart + 86400;

      let query = "SELECT ce.*, fm.name as child_name FROM calendar_events ce LEFT JOIN family_members fm ON ce.family_member_id = fm.id WHERE (ce.source = 'skill' OR ce.recurring IS NOT NULL) AND ce.start_time BETWEEN ? AND ?";
      const params: unknown[] = [dayStart, dayEnd];

      if (child_name) {
        const child = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${child_name}%`) as { id: string } | undefined;
        if (child) {
          query += ' AND ce.family_member_id = ?';
          params.push(child.id);
        }
      }

      query += ' ORDER BY ce.start_time ASC';
      const activities = db.prepare(query).all(...params) as Record<string, unknown>[];

      return { success: true, data: { count: activities.length, activities: activities.map(a => ({
        title: a.title,
        child: a.child_name,
        start: new Date((a.start_time as number) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        end: new Date((a.end_time as number) * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        location: a.location,
      })) } };
    }
    case 'cancel': {
      if (!title) return { success: false, error: 'title required to cancel activity' };
      const now = Math.floor(Date.now() / 1000);
      const result = db.prepare("DELETE FROM calendar_events WHERE title LIKE ? AND (source = 'skill' OR recurring IS NOT NULL) AND start_time > ?").run(`%${title}%`, now);
      return { success: true, message: `Cancelled ${result.changes} future events for "${title}"` };
    }
    case 'list':
    default: {
      // List distinct activities (grouped by title + recurring config)
      const activities = db.prepare(`
        SELECT ce.title, ce.recurring, ce.location, fm.name as child_name,
          MIN(ce.start_time) as next_occurrence, COUNT(*) as event_count
        FROM calendar_events ce
        LEFT JOIN family_members fm ON ce.family_member_id = fm.id
        WHERE (ce.source = 'skill' OR ce.recurring IS NOT NULL) AND ce.start_time > ?
        GROUP BY ce.title, ce.family_member_id
        ORDER BY next_occurrence ASC
      `).all(Math.floor(Date.now() / 1000)) as Record<string, unknown>[];

      return { success: true, data: { count: activities.length, activities: activities.map(a => ({
        title: a.title,
        child: a.child_name,
        location: a.location,
        upcoming_events: a.event_count,
        next: new Date((a.next_occurrence as number) * 1000).toLocaleDateString(),
        schedule: a.recurring ? JSON.parse(a.recurring as string) : null,
      })) } };
    }
  }
});

// ─── Chore Tool ───

// manage_chore
registerTool('manage_chore', 'Assign and track chores for family members', (args) => {
  const { action = 'list', title, assigned_to, points = 1 } = args as {
    action?: string; title?: string; assigned_to?: string; points?: number;
  };

  switch (action) {
    case 'create': {
      if (!title) return { success: false, error: 'title required' };

      // Resolve member name to ID
      let memberId: string | null = null;
      let memberName = assigned_to || 'unassigned';
      if (assigned_to) {
        const member = db.prepare('SELECT id, name FROM family_members WHERE name LIKE ?').get(`%${assigned_to}%`) as { id: string; name: string } | undefined;
        if (member) { memberId = member.id; memberName = member.name; }
      }

      const id = generateId('chore');
      db.prepare(`
        INSERT INTO tasks (id, title, status, priority, assigned_to, category, points, created_at, updated_at)
        VALUES (?, ?, 'pending', 'medium', ?, 'chore', ?, unixepoch(), unixepoch())
      `).run(id, title, memberId, points);

      vinegarEvents.emit('chore:created', { id, title, assignedTo: memberName });
      return { success: true, data: { id }, message: `Chore "${title}" assigned to ${memberName} (${points} points)` };
    }
    case 'complete': {
      if (!title) return { success: false, error: 'title required' };
      const chore = db.prepare("SELECT id, title, points, assigned_to FROM tasks WHERE title LIKE ? AND category = 'chore' AND status = 'pending'").get(`%${title}%`) as { id: string; title: string; points: number; assigned_to: string | null } | undefined;
      if (!chore) return { success: false, error: `Chore not found: ${title}` };

      db.prepare("UPDATE tasks SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").run(chore.id);

      vinegarEvents.emit('chore:completed', { id: chore.id, title: chore.title, points: chore.points });
      return { success: true, data: { id: chore.id, points: chore.points }, message: `Chore "${chore.title}" completed! +${chore.points} points!` };
    }
    case 'approve': {
      if (!title) return { success: false, error: 'title required' };
      const chore = db.prepare("SELECT id, title FROM tasks WHERE title LIKE ? AND category = 'chore'").get(`%${title}%`) as { id: string; title: string } | undefined;
      if (!chore) return { success: false, error: `Chore not found: ${title}` };

      db.prepare("UPDATE tasks SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").run(chore.id);
      return { success: true, message: `Chore "${chore.title}" approved!` };
    }
    case 'list':
    default: {
      const chores = db.prepare(`
        SELECT t.id, t.title, t.status, t.points, fm.name as assigned_to
        FROM tasks t
        LEFT JOIN family_members fm ON t.assigned_to = fm.id
        WHERE t.category = 'chore' AND t.status = 'pending'
        ORDER BY t.created_at DESC
        LIMIT 20
      `).all();

      // Points leaderboard
      const leaderboard = db.prepare(`
        SELECT fm.name, COALESCE(SUM(t.points), 0) as total_points
        FROM family_members fm
        LEFT JOIN tasks t ON t.assigned_to = fm.id AND t.category = 'chore' AND t.status = 'completed'
        GROUP BY fm.id
        ORDER BY total_points DESC
      `).all();

      return { success: true, data: { count: (chores as unknown[]).length, chores, leaderboard } };
    }
  }
});

// ─── Skill Tool ───

// manage_skill
registerTool('manage_skill', 'Create and manage custom skills', async (args) => {
  const { action = 'list', name, description, type, trigger_phrases, url, schedule } = args as {
    action?: string; name?: string; description?: string; type?: string;
    trigger_phrases?: string[]; url?: string; schedule?: string;
  };

  switch (action) {
    case 'create': {
      if (!name || !description || !type || !trigger_phrases || trigger_phrases.length === 0) {
        return { success: false, error: 'name, description, type, and trigger_phrases required' };
      }

      const validTypes = ['web_scraper', 'api_caller', 'scheduled', 'data_lookup', 'composite'];
      if (!validTypes.includes(type)) return { success: false, error: `Invalid type. Use: ${validTypes.join(', ')}` };

      const config: Record<string, unknown> = {};
      if (type === 'web_scraper' && url) config.url = url;
      if (type === 'api_caller' && url) config.endpoint = url;
      if (schedule) config.schedule = schedule;

      const id = generateId('skill');
      db.prepare(`
        INSERT INTO skills (id, name, description, type, trigger_phrases, config, schedule)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, name, description, type, JSON.stringify(trigger_phrases), JSON.stringify(config), schedule || null);

      vinegarEvents.emit('skill:created', { id, name, type });
      return { success: true, data: { id }, message: `Skill "${name}" created! Try saying: "${trigger_phrases[0]}"` };
    }
    case 'test': {
      if (!name) return { success: false, error: 'name required to test skill' };
      const skill = db.prepare('SELECT * FROM skills WHERE name LIKE ? AND is_active = 1').get(`%${name}%`) as Record<string, unknown> | undefined;
      if (!skill) return { success: false, error: `Skill not found: ${name}` };

      const result = await executeSkill(
        { id: skill.id as string, name: skill.name as string, type: skill.type as string, config: skill.config as string },
        {}
      );
      return result;
    }
    case 'delete': {
      if (!name) return { success: false, error: 'name required' };
      const skill = db.prepare('SELECT id, name FROM skills WHERE name LIKE ?').get(`%${name}%`) as { id: string; name: string } | undefined;
      if (!skill) return { success: false, error: `Skill not found: ${name}` };

      db.prepare('DELETE FROM skills WHERE id = ?').run(skill.id);
      vinegarEvents.emit('skill:deleted', { id: skill.id, name: skill.name });
      return { success: true, message: `Skill "${skill.name}" deleted` };
    }
    case 'list':
    default: {
      const skills = db.prepare('SELECT id, name, description, type, is_active, use_count, trigger_phrases FROM skills ORDER BY use_count DESC').all() as Record<string, unknown>[];
      const formatted = skills.map(s => ({
        ...s,
        trigger_phrases: JSON.parse(s.trigger_phrases as string),
        is_active: Boolean(s.is_active),
      }));
      return { success: true, data: { count: formatted.length, skills: formatted } };
    }
  }
});

// ─── Family Tool ───

// get_family
registerTool('get_family', 'List all family members and their info', () => {
  const members = db.prepare('SELECT id, name, role, age, birthday, dietary_restrictions, preferences FROM family_members ORDER BY role, name').all() as Record<string, unknown>[];
  const activeId = db.prepare("SELECT value FROM settings WHERE key = 'active_family_member'").get() as { value: string } | undefined;

  const formatted = members.map(m => ({
    id: m.id,
    name: m.name,
    role: m.role,
    age: m.age,
    birthday: m.birthday,
    dietary_restrictions: m.dietary_restrictions ? JSON.parse(m.dietary_restrictions as string) : [],
    isActive: m.id === activeId?.value,
  }));

  return { success: true, data: { count: formatted.length, members: formatted, activeId: activeId?.value || null } };
});

// ─── Usage Tool ───

registerTool('get_usage', 'Get token usage statistics and cost summary', (args) => {
  const { period = 'today' } = args as { period?: string };

  const now = Math.floor(Date.now() / 1000);
  let since: number;

  switch (period) {
    case 'week': since = now - 7 * 86400; break;
    case 'month': since = now - 30 * 86400; break;
    case 'today':
    default: since = now - (now % 86400); break;
  }

  const stats = db.prepare(`
    SELECT model, COUNT(*) as calls,
      SUM(text_input_tokens) as input_tokens,
      SUM(text_output_tokens) as output_tokens,
      SUM(text_input_tokens + text_output_tokens) as total_tokens
    FROM usage_logs WHERE created_at >= ?
    GROUP BY model ORDER BY total_tokens DESC
  `).all(since) as Array<{ model: string; calls: number; input_tokens: number; output_tokens: number; total_tokens: number }>;

  const totalTokens = stats.reduce((sum, s) => sum + (s.total_tokens || 0), 0);
  const totalCalls = stats.reduce((sum, s) => sum + s.calls, 0);

  // Euri free tier: $0 cost, but show token budget usage
  const dailyLimit = 200000;
  const todayUsed = period === 'today' ? totalTokens : 0;

  const conversations = db.prepare('SELECT COUNT(*) as count FROM conversation_logs WHERE created_at >= ?').get(since) as { count: number };

  return {
    success: true,
    data: {
      period,
      totalTokens,
      totalCalls,
      conversations: conversations.count,
      modelBreakdown: stats.map(s => ({
        model: s.model,
        calls: s.calls,
        tokens: s.total_tokens,
      })),
      budget: period === 'today' ? {
        used: todayUsed,
        limit: dailyLimit,
        remaining: dailyLimit - todayUsed,
        percentUsed: Math.round((todayUsed / dailyLimit) * 100),
      } : undefined,
      estimatedCost: '$0.00 (Euri free tier)',
    },
  };
});

// ─── Tool Schema for LLM ───

export function getToolSchemas(): Array<{ type: string; name: string; description: string; parameters: Record<string, unknown> }> {
  return [
    {
      type: 'function',
      name: 'save_memory',
      description: 'Save information to persistent memory. Auto-save preferences, routines, facts, and decisions.',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: 'Short identifier for the memory' },
          content: { type: 'string', description: 'Detailed info to remember' },
          type: { type: 'string', description: 'fact, preference, decision, routine, or person' },
          importance: { type: 'string', description: 'high, medium, or low' },
        },
        required: ['topic', 'content'],
      },
    },
    {
      type: 'function',
      name: 'recall_memory',
      description: 'Search memory for previously saved info. Use when asked "do you remember" or when past context helps.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          type: { type: 'string', description: 'Optional filter: fact, preference, decision, routine, person' },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_task',
      description: 'Create, update, or list tasks. ALWAYS call this for any task/todo/reminder request.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create, update, or list' },
          title: { type: 'string', description: 'Task title' },
          description: { type: 'string', description: 'Task details' },
          priority: { type: 'string', description: 'low, medium, high, or urgent' },
          status: { type: 'string', description: 'pending, in_progress, completed, or cancelled' },
          due_date: { type: 'string', description: 'Due date in ISO format' },
          category: { type: 'string', description: 'Task category' },
        },
      },
    },
    {
      type: 'function',
      name: 'get_calendar',
      description: 'Read calendar events for a date range. Returns upcoming events.',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Start date (ISO format)' },
          end: { type: 'string', description: 'End date (ISO format)' },
          family_member_id: { type: 'string', description: 'Filter by family member' },
        },
      },
    },
    {
      type: 'function',
      name: 'create_event',
      description: 'Create a new calendar event.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Event title' },
          start_time: { type: 'string', description: 'Start time (ISO format)' },
          end_time: { type: 'string', description: 'End time (ISO format)' },
          description: { type: 'string', description: 'Event description' },
          location: { type: 'string', description: 'Event location' },
          all_day: { type: 'boolean', description: 'Is this an all-day event?' },
          reminder_minutes: { type: 'number', description: 'Minutes before event to remind' },
        },
        required: ['title', 'start_time', 'end_time'],
      },
    },
    {
      type: 'function',
      name: 'update_event',
      description: 'Update an existing calendar event.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Event ID to update' },
          title: { type: 'string' },
          start_time: { type: 'string' },
          end_time: { type: 'string' },
          description: { type: 'string' },
          location: { type: 'string' },
        },
        required: ['id'],
      },
    },
    {
      type: 'function',
      name: 'delete_event',
      description: 'Delete/cancel a calendar event.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Event ID to delete' },
          scope: { type: 'string', description: 'this_instance, all_future, or entire_series' },
        },
        required: ['id'],
      },
    },
    {
      type: 'function',
      name: 'set_reminder',
      description: 'Create a reminder or alarm.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Reminder message' },
          time: { type: 'string', description: 'When to remind (ISO format or relative like "in 30 minutes")' },
          type: { type: 'string', description: 'one_time, daily, weekly, or custom' },
          target_member: { type: 'string', description: 'Who to remind (family member name)' },
        },
        required: ['message', 'time'],
      },
    },
    {
      type: 'function',
      name: 'manage_grocery',
      description: 'Add, remove, complete, or list grocery items.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'add, complete, remove, list, or clear_completed' },
          item: { type: 'string', description: 'Grocery item name' },
          quantity: { type: 'number', description: 'Quantity to add' },
          unit: { type: 'string', description: 'Unit (e.g., lbs, oz, gallon)' },
          category: { type: 'string', description: 'Category (dairy, produce, etc.)' },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_meals',
      description: 'Plan meals for specific dates.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'plan, get, or list' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          meal_type: { type: 'string', description: 'breakfast, lunch, dinner, or snack' },
          recipe: { type: 'string', description: 'Meal/recipe name' },
          ingredients: { type: 'array', description: 'List of ingredients', items: { type: 'string' } },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_activity',
      description: 'Manage kids\' recurring activities (sports, lessons, etc).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create, list, cancel, or get_today' },
          title: { type: 'string', description: 'Activity name' },
          child_name: { type: 'string', description: 'Child name' },
          day_of_week: { type: 'array', description: 'Days (0=Sun, 1=Mon, etc)', items: { type: 'number' } },
          start_time: { type: 'string', description: 'Start time (HH:MM)' },
          end_time: { type: 'string', description: 'End time (HH:MM)' },
          location: { type: 'string', description: 'Activity location' },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_chore',
      description: 'Assign and track chores for family members.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create, complete, list, or approve' },
          title: { type: 'string', description: 'Chore name' },
          assigned_to: { type: 'string', description: 'Family member name' },
          points: { type: 'number', description: 'Points/stars for completing' },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_skill',
      description: 'Create and manage custom skills that Vinegar can learn.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'create, list, delete, or test' },
          name: { type: 'string', description: 'Skill name' },
          description: { type: 'string', description: 'What the skill does' },
          type: { type: 'string', description: 'web_scraper, api_caller, scheduled, data_lookup, or composite' },
          trigger_phrases: { type: 'array', description: 'Phrases that activate this skill', items: { type: 'string' } },
          url: { type: 'string', description: 'URL for web_scraper or api_caller' },
          schedule: { type: 'string', description: 'Cron expression for scheduled skills' },
        },
      },
    },
    {
      type: 'function',
      name: 'get_family',
      description: 'List all family members and their info.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      type: 'function',
      name: 'get_usage',
      description: 'Get token usage statistics and cost summary.',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', description: 'today, week, or month' },
        },
      },
    },
  ];
}

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
        // Block UNION, WITH (CTE), and subqueries to prevent filter bypass
        if (/\b(UNION|WITH)\b/i.test(queryStr)) {
          return { success: false, error: 'Data lookup does not support UNION or WITH clauses' };
        }
        // Block parenthesized SELECT (subqueries)
        if (/\(\s*SELECT\b/i.test(queryStr)) {
          return { success: false, error: 'Data lookup does not support subqueries' };
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
      case 'composite': {
        // Compound skill: chain multiple tool calls in sequence
        const steps = config.steps as Array<{ tool: string; args?: Record<string, unknown> }>;
        if (!steps || !Array.isArray(steps) || steps.length === 0) {
          return { success: false, error: 'Composite skill has no steps configured' };
        }
        if (steps.length > 10) {
          return { success: false, error: 'Composite skills limited to 10 steps' };
        }

        const results: unknown[] = [];
        for (const step of steps) {
          if (!step.tool) continue;
          // Allow args to reference $prev (result of previous step)
          const stepArgs = { ...(step.args || {}), ...(args || {}) };
          if (results.length > 0) {
            stepArgs._previous_result = results[results.length - 1];
          }
          const stepResult = await executeTool(step.tool, stepArgs);
          results.push(stepResult);
          if (!stepResult.success) {
            return { success: false, error: `Step "${step.tool}" failed: ${stepResult.error}`, data: { completedSteps: results.length - 1, results } };
          }
        }
        result = { steps: results.length, results };
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
      if (dueDate !== null && isNaN(dueDate)) return { success: false, error: 'Invalid due_date format. Use ISO format (e.g., 2026-02-15)' };
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

// ─── Workflow Tool (compound tool calls) ───

registerTool('run_workflow', 'Run multiple tools in sequence as a workflow. Use for compound requests like "morning routine", "plan my day", etc.', async (args) => {
  const { steps } = args as { steps?: Array<{ tool: string; args?: Record<string, unknown> }> };

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return { success: false, error: 'steps array required: [{tool: "tool_name", args: {...}}, ...]' };
  }
  if (steps.length > 5) {
    return { success: false, error: 'Workflows limited to 5 steps' };
  }

  const results: Array<{ tool: string; result: unknown }> = [];
  for (const step of steps) {
    if (!step.tool || typeof step.tool !== 'string') continue;
    const result = await executeTool(step.tool, step.args || {});
    results.push({ tool: step.tool, result });
    if (!result.success) break;
  }

  const allSuccess = results.every(r => (r.result as { success: boolean }).success);
  const messages = results
    .map(r => (r.result as { message?: string }).message)
    .filter(Boolean);

  return {
    success: allSuccess,
    data: { steps: results.length, results },
    message: messages.join('\n'),
  };
});

// ─── Find Free Time Tool (Natural Language Scheduling) ───

registerTool('find_free_time', 'Find available time slots in calendar. Use when asked "find me time to...", "when am I free", "schedule X for me".', (args) => {
  const { duration_minutes = 60, start_date, end_date, preferred_time } = args as {
    duration_minutes?: number; start_date?: string; end_date?: string; preferred_time?: string;
  };

  const now = Math.floor(Date.now() / 1000);
  const durationSec = Math.min(Math.max(15, duration_minutes), 480) * 60; // 15min-8hr
  const startTs = start_date ? Math.floor(new Date(start_date).getTime() / 1000) : now;
  const endTs = end_date ? Math.floor(new Date(end_date).getTime() / 1000) : startTs + (7 * 86400); // Default: next 7 days

  if (isNaN(startTs) || isNaN(endTs)) return { success: false, error: 'Invalid date format' };

  // Get all events in the range
  const events = db.prepare(`
    SELECT start_time, end_time FROM calendar_events
    WHERE end_time > ? AND start_time < ?
    ORDER BY start_time ASC
  `).all(startTs, endTs) as Array<{ start_time: number; end_time: number }>;

  // Business hours: 8am-9pm (configurable via preferred_time)
  let dayStart = 8, dayEnd = 21;
  if (preferred_time === 'morning') { dayStart = 6; dayEnd = 12; }
  else if (preferred_time === 'afternoon') { dayStart = 12; dayEnd = 17; }
  else if (preferred_time === 'evening') { dayStart = 17; dayEnd = 22; }

  // Find gaps between events within business hours
  const freeSlots: Array<{ start: string; end: string; duration_minutes: number }> = [];
  const searchStart = Math.max(startTs, now);

  for (let dayOffset = 0; dayOffset < 7 && freeSlots.length < 5; dayOffset++) {
    const dayBase = searchStart + (dayOffset * 86400);
    const dayDate = new Date(dayBase * 1000);
    dayDate.setHours(dayStart, 0, 0, 0);
    const windowStart = Math.floor(dayDate.getTime() / 1000);
    dayDate.setHours(dayEnd, 0, 0, 0);
    const windowEnd = Math.floor(dayDate.getTime() / 1000);

    if (windowEnd <= now) continue;

    // Get events for this day
    const dayEvents = events.filter(e => e.start_time < windowEnd && e.end_time > windowStart);
    dayEvents.sort((a, b) => a.start_time - b.start_time);

    let cursor = Math.max(windowStart, now);
    for (const event of dayEvents) {
      if (event.start_time - cursor >= durationSec) {
        freeSlots.push({
          start: new Date(cursor * 1000).toISOString(),
          end: new Date(event.start_time * 1000).toISOString(),
          duration_minutes: Math.round((event.start_time - cursor) / 60),
        });
        if (freeSlots.length >= 5) break;
      }
      cursor = Math.max(cursor, event.end_time);
    }

    // Check remaining time after last event
    if (cursor < windowEnd && windowEnd - cursor >= durationSec && freeSlots.length < 5) {
      freeSlots.push({
        start: new Date(cursor * 1000).toISOString(),
        end: new Date(windowEnd * 1000).toISOString(),
        duration_minutes: Math.round((windowEnd - cursor) / 60),
      });
    }
  }

  if (freeSlots.length === 0) {
    return { success: true, data: { slots: [] }, message: 'No free slots found in the next 7 days matching your criteria.' };
  }

  const summary = freeSlots.map(s => {
    const start = new Date(s.start);
    return `${start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${s.duration_minutes} min)`;
  }).join('\n');

  return {
    success: true,
    data: { count: freeSlots.length, slots: freeSlots },
    message: `Found ${freeSlots.length} free slot${freeSlots.length > 1 ? 's' : ''}:\n${summary}`,
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
    {
      type: 'function',
      name: 'get_weather',
      description: 'Get current weather for a location. Use when asked about weather, temperature, or conditions.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name (defaults to configured city)' },
        },
      },
    },
    {
      type: 'function',
      name: 'get_forecast',
      description: 'Get weather forecast for upcoming days (1-5 day forecast).',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City name' },
          days: { type: 'number', description: 'Number of days (1-5, default 3)' },
        },
      },
    },
    {
      type: 'function',
      name: 'web_search',
      description: 'Search the web for information. Use for current events, facts, how-to questions, or anything not in memory.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
        },
        required: ['query'],
      },
    },
    {
      type: 'function',
      name: 'get_briefing',
      description: 'Get a daily briefing with weather, calendar, tasks, and grocery list. Use for "morning briefing", "what\'s my day look like", "daily summary".',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      type: 'function',
      name: 'run_workflow',
      description: 'Run multiple tools in sequence. Use for compound requests.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'Array of {tool, args} objects to run in sequence',
            items: {
              type: 'object',
              properties: {
                tool: { type: 'string', description: 'Tool name' },
                args: { type: 'object', description: 'Tool arguments' },
              },
              required: ['tool'],
            },
          },
        },
        required: ['steps'],
      },
    },
    {
      type: 'function',
      name: 'find_free_time',
      description: 'Find available time slots in calendar. Use when asked "find me time to...", "when am I free".',
      parameters: {
        type: 'object',
        properties: {
          duration_minutes: { type: 'number', description: 'How many minutes needed (default 60)' },
          start_date: { type: 'string', description: 'Start search from (ISO date)' },
          end_date: { type: 'string', description: 'Search until (ISO date)' },
          preferred_time: { type: 'string', description: 'morning, afternoon, evening, or any' },
        },
      },
    },
    {
      type: 'function',
      name: 'suggest_recipe',
      description: 'Suggest recipes based on available groceries. Use when asked "what should I cook", "suggest a recipe".',
      parameters: {
        type: 'object',
        properties: {
          dietary_restrictions: { type: 'string', description: 'Dietary restrictions (vegetarian, gluten-free, etc.)' },
          cuisine: { type: 'string', description: 'Preferred cuisine (Italian, Mexican, etc.)' },
          meal_type: { type: 'string', description: 'breakfast, lunch, dinner, or snack' },
          servings: { type: 'number', description: 'Number of servings (default 4)' },
        },
      },
    },
    {
      type: 'function',
      name: 'manage_budget',
      description: 'Track bills, subscriptions, expenses, and income. Use for budget-related requests.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'add, paid, list, upcoming, delete, or summary' },
          name: { type: 'string', description: 'Bill/expense name' },
          amount: { type: 'number', description: 'Amount in dollars' },
          category: { type: 'string', description: 'Category (utilities, food, entertainment, etc.)' },
          type: { type: 'string', description: 'bill, subscription, expense, or income' },
          frequency: { type: 'string', description: 'one_time, weekly, monthly, or yearly' },
          due_date: { type: 'string', description: 'Due date in ISO format' },
          notes: { type: 'string', description: 'Additional notes' },
        },
      },
    },
  ];
}

/**
 * Shared Prompt Builder
 * Single source of truth for buildMemoryContext() and getToolInstructions().
 * Used by both /api/chat (llm-middleware) and /api/chat/stream routes.
 */

import { db } from './db';
import { getRecentConversations } from './conversation-logger';

// ─── Context Sanitization ───

/** Strip tool_call patterns from injected context to prevent prompt injection */
function sanitizeContext(text: string): string {
  return text
    .replace(/```(?:tool_call|tool_code|tool|json)\s*\n/gi, '``` ')
    .replace(/\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"/g, '{"_name": "$1", "_arguments"');
}

// ─── Tool Instructions ───

export function getToolInstructions(): string {
  return `
TOOLS: Call tools via \`\`\`tool_call\n{"name":"TOOL","arguments":{...}}\n\`\`\` format. One tool per call. ALWAYS use tools for actions.

Tools: manage_grocery({action,item,quantity,unit,category}), create_event({title,start_time,end_time,description,location,reminder_minutes}), get_calendar({start,end}), update_event({id,title,start_time,end_time}), delete_event({id}), set_reminder({message,time,type,target_member}), manage_task({action,title,priority,status,due_date}), manage_chore({action,title,assigned_to,points}), manage_meals({action,date,meal_type,recipe,ingredients[]}), manage_activity({action,title,child_name,day_of_week[],start_time,end_time,location}), save_memory({topic,content,type,importance}), recall_memory({query,type}), manage_skill({action,name,type,trigger_phrases[],url}), get_family({}), get_usage({period}), get_weather({location}), get_forecast({location,days}), web_search({query}), get_briefing({}), run_workflow({steps:[{tool,args}]}), find_free_time({duration_minutes,preferred_time}), suggest_recipe({dietary_restrictions,cuisine,meal_type,servings}), manage_budget({action,name,amount,category,type,frequency,due_date}), get_traffic({from,to}), find_nearby({query,type,near,radius_miles}), check_deals({store,item,zip_code}), show_visual({query,card_type}), manage_routine({action,name,type,steps:[{tool,args}],trigger_time,trigger_phrase}), manage_homework({action,title,subject,child_name,due_date,status,notes})
`;
}

// ─── Keyword Patterns (compiled once) ───

const calendarKeywords = /\b(calendar|schedule|event|meeting|appointment|plan|today|tomorrow|week|free|busy|when)\b/i;
const gapKeywords = /\b(skill gap|unanswered|couldn't answer|couldn't help|improve|improvement|what.*missing|review.*logs?|what.*can't)\b/i;
const taskKeywords = /\b(task|todo|chore|homework|errand|remind|due|overdue)\b/i;
const groceryKeywords = /\b(grocery|groceries|shopping|buy|milk|bread|food|meal|dinner|lunch|breakfast|cook|recipe)\b/i;
const budgetKeywords = /\b(budget|bill|bills|expense|subscription|payment|due|money|cost|spend|spending)\b/i;

// ─── Batched Context Query ───

interface ContextRow {
  _source: string;
  col1: string;
  col2: string | null;
  col3: string | null;
  col4: string | null;
  col5: number | null;
}

/**
 * Build full memory context using batched queries based on keyword matching.
 * Shared between streaming and non-streaming routes.
 */
export function buildMemoryContext(
  userMessage: string,
  activeMemberId?: string,
  visualContext?: string
): string {
  const sections: string[] = [];

  // Inject current date/time for time-aware responses
  const now = new Date();
  sections.push(`[Now] ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

  // Determine which keyword groups matched — build a single batched query
  const needCalendar = calendarKeywords.test(userMessage);
  const needGaps = gapKeywords.test(userMessage);
  const needTasks = taskKeywords.test(userMessage);
  const needGrocery = groceryKeywords.test(userMessage);
  const needBudget = budgetKeywords.test(userMessage);

  // ─── Single batched query via UNION ALL ───
  // Each sub-SELECT is tagged with _source for routing
  const unions: string[] = [];
  const params: unknown[] = [];

  // Always: family members
  unions.push(`SELECT 'family' as _source, id as col1, name as col2, role as col3, NULL as col4, NULL as col5 FROM family_members`);

  // Always: relevant memories (LIKE match on user message)
  const q = `%${userMessage}%`;
  unions.push(`SELECT 'memory' as _source, type as col1, topic as col2, content as col3, NULL as col4, NULL as col5
    FROM memories WHERE content LIKE ? OR topic LIKE ? OR tags LIKE ?
    ORDER BY CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END, created_at DESC LIMIT 8`);
  params.push(q, q, q);

  if (needCalendar) {
    const nowTs = Math.floor(Date.now() / 1000);
    const dayStart = nowTs - (nowTs % 86400);
    const dayEnd = dayStart + 86400;
    unions.push(`SELECT 'calendar' as _source, title as col1, location as col2, NULL as col3, NULL as col4, start_time as col5
      FROM calendar_events WHERE start_time BETWEEN ? AND ? ORDER BY start_time ASC LIMIT 5`);
    params.push(dayStart, dayEnd);
  }

  if (needGaps) {
    unions.push(`SELECT 'gap' as _source, content as col1, NULL as col2, NULL as col3, NULL as col4, created_at as col5
      FROM memories WHERE type = 'fact' AND tags LIKE '%skill_gap%' ORDER BY created_at DESC LIMIT 10`);
  }

  if (needTasks) {
    unions.push(`SELECT 'task' as _source, title as col1, priority as col2, NULL as col3, NULL as col4, due_date as col5
      FROM tasks WHERE status = 'pending' ORDER BY due_date ASC NULLS LAST, priority DESC LIMIT 5`);
  }

  if (needGrocery) {
    unions.push(`SELECT 'grocery' as _source, item as col1, CAST(quantity AS TEXT) as col2, unit as col3, NULL as col4, NULL as col5
      FROM grocery_items WHERE completed = 0 ORDER BY created_at DESC LIMIT 10`);
    const today = new Date().toISOString().split('T')[0];
    unions.push(`SELECT 'meal' as _source, meal_type as col1, recipe as col2, NULL as col3, NULL as col4, NULL as col5
      FROM meal_plans WHERE date = ?`);
    params.push(today);
  }

  if (needBudget) {
    const nowTs = Math.floor(Date.now() / 1000);
    unions.push(`SELECT 'budget' as _source, name as col1, CAST(amount AS TEXT) as col2, NULL as col3, NULL as col4, due_date as col5
      FROM budget_items WHERE is_paid = 0 AND due_date IS NOT NULL AND due_date BETWEEN ? AND ?
      ORDER BY due_date ASC LIMIT 5`);
    params.push(nowTs, nowTs + (30 * 86400));
  }

  // Execute batched query
  try {
    const batchedSQL = unions.join(' UNION ALL ');
    const rows = db.prepare(batchedSQL).all(...params) as ContextRow[];

    // Route results into sections
    const familyMembers: { id: string; name: string; role: string }[] = [];
    const memories: { type: string; topic: string; content: string }[] = [];
    const events: { title: string; location: string | null; start_time: number }[] = [];
    const gaps: { content: string; created_at: number }[] = [];
    const tasks: { title: string; priority: string; due_date: number | null }[] = [];
    const groceries: { item: string; quantity: number; unit: string | null }[] = [];
    const meals: { meal_type: string; recipe: string }[] = [];
    const bills: { name: string; amount: number; due_date: number }[] = [];

    for (const row of rows) {
      switch (row._source) {
        case 'family':
          familyMembers.push({ id: row.col1, name: row.col2!, role: row.col3! });
          break;
        case 'memory':
          memories.push({ type: row.col1, topic: row.col2!, content: row.col3! });
          break;
        case 'calendar':
          events.push({ title: row.col1, location: row.col2, start_time: row.col5! });
          break;
        case 'gap':
          gaps.push({ content: row.col1, created_at: row.col5! });
          break;
        case 'task':
          tasks.push({ title: row.col1, priority: row.col2!, due_date: row.col5 });
          break;
        case 'grocery':
          groceries.push({ item: row.col1, quantity: parseFloat(row.col2!) || 1, unit: row.col3 });
          break;
        case 'meal':
          meals.push({ meal_type: row.col1, recipe: row.col2! });
          break;
        case 'budget':
          bills.push({ name: row.col1, amount: parseFloat(row.col2!) || 0, due_date: row.col5! });
          break;
      }
    }

    // Format sections
    if (familyMembers.length > 0) {
      sections.push(`[Family] ${familyMembers.map(m => `${m.name} (${m.role})`).join(', ')}`);

      if (activeMemberId) {
        const active = familyMembers.find(m => m.id === activeMemberId);
        if (active) sections.push(`[Active Speaker] ${active.name} (${active.role})`);
      }
    }

    if (memories.length > 0) {
      sections.push('[Relevant Memory]');
      for (const m of memories) sections.push(`- [${m.type}] ${m.topic}: ${m.content}`);
    }

    if (events.length > 0) {
      sections.push("[Today's Schedule]");
      for (const e of events) {
        const start = new Date(e.start_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sections.push(`- ${start}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
      }
    }

    if (gaps.length > 0) {
      sections.push("[Skill Gaps - Questions I Couldn't Answer]");
      for (const g of gaps) {
        const date = new Date(g.created_at * 1000).toLocaleDateString();
        sections.push(`- (${date}) ${g.content}`);
      }
    }

    if (tasks.length > 0) {
      sections.push('[Pending Tasks]');
      for (const t of tasks) {
        const due = t.due_date ? ` (due: ${new Date(t.due_date * 1000).toLocaleDateString()})` : '';
        sections.push(`- [${t.priority}] ${t.title}${due}`);
      }
    }

    if (groceries.length > 0) {
      sections.push('[Grocery List]');
      for (const i of groceries) {
        sections.push(`- ${i.item}${i.quantity > 1 ? ` (${i.quantity}${i.unit ? ' ' + i.unit : ''})` : ''}`);
      }
    }

    if (meals.length > 0) {
      sections.push("[Today's Meals]");
      for (const m of meals) sections.push(`- ${m.meal_type}: ${m.recipe}`);
    }

    if (bills.length > 0) {
      sections.push('[Upcoming Bills]');
      for (const b of bills) {
        const due = new Date(b.due_date * 1000).toLocaleDateString();
        sections.push(`- ${b.name}: $${b.amount} (due ${due})`);
      }
    }
  } catch {
    // DB not ready or query error — degrade gracefully with minimal context
    try {
      const members = db.prepare('SELECT name, role FROM family_members').all() as { name: string; role: string }[];
      if (members.length > 0) sections.push(`[Family] ${members.map(m => `${m.name} (${m.role})`).join(', ')}`);
    } catch {}
  }

  // Inject per-member tasks and reminders when speaker is identified
  if (activeMemberId) {
    try {
      // Tasks assigned to this member
      const memberTasks = db.prepare(`
        SELECT title, priority, due_date FROM tasks
        WHERE assigned_to = ? AND status = 'pending'
        ORDER BY due_date ASC NULLS LAST LIMIT 3
      `).all(activeMemberId) as Array<{ title: string; priority: string; due_date: number | null }>;

      if (memberTasks.length > 0) {
        sections.push('[Your Tasks]');
        for (const t of memberTasks) {
          const due = t.due_date ? ` (due: ${new Date(t.due_date * 1000).toLocaleDateString()})` : '';
          sections.push(`- [${t.priority}] ${t.title}${due}`);
        }
      }

      // Reminders targeted at this member
      const memberReminders = db.prepare(`
        SELECT message, next_fire_time FROM scheduled_reminders
        WHERE target_member_id = ? AND is_active = 1 AND delivery_status = 'pending'
          AND next_fire_time BETWEEN ? AND ?
        ORDER BY next_fire_time ASC LIMIT 3
      `).all(activeMemberId, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000) + 86400) as Array<{ message: string; next_fire_time: number }>;

      if (memberReminders.length > 0) {
        sections.push('[Your Reminders]');
        for (const r of memberReminders) {
          const time = new Date(r.next_fire_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sections.push(`- ${time}: ${r.message}`);
        }
      }

      // Homework for child speakers
      const memberRole = db.prepare('SELECT role FROM family_members WHERE id = ?').get(activeMemberId) as { role: string } | undefined;
      if (memberRole?.role === 'child') {
        const homework = db.prepare(`
          SELECT title, subject, due_date, status FROM assignments
          WHERE child_id = ? AND status IN ('pending', 'in_progress', 'overdue')
          ORDER BY due_date ASC NULLS LAST LIMIT 3
        `).all(activeMemberId) as Array<{ title: string; subject: string; due_date: number | null; status: string }>;

        if (homework.length > 0) {
          sections.push('[Your Homework]');
          for (const h of homework) {
            const due = h.due_date ? ` (due: ${new Date(h.due_date * 1000).toLocaleDateString()})` : '';
            sections.push(`- [${h.status}] ${h.title}${h.subject ? ` (${h.subject})` : ''}${due}`);
          }
        }
      }
    } catch {}
  }

  // Inject recent conversation history for continuity
  try {
    const recent = getRecentConversations(10); // last 10 messages
    if (recent.length > 0) {
      const recentPairs: string[] = [];
      // Reverse to chronological order, limit to ~500 chars total
      let charBudget = 500;
      for (const entry of recent.reverse()) {
        const prefix = entry.role === 'user' ? 'You' : 'Vinegar';
        const snippet = entry.content.length > 100 ? entry.content.slice(0, 100) + '...' : entry.content;
        if (charBudget <= 0) break;
        recentPairs.push(`${prefix}: ${snippet}`);
        charBudget -= snippet.length;
      }
      if (recentPairs.length > 0) {
        sections.push('[Recent Conversation]');
        recentPairs.forEach(p => sections.push(`- ${p}`));
      }
    }
  } catch {}

  // Inject visual panel state so LLM can reference what the user sees
  if (visualContext) {
    sections.push(`[Visual Panel] Currently showing: ${visualContext}`);
  }

  if (sections.length === 0) return '';
  return sanitizeContext('\n--- VINEGAR MEMORY ---\n' + sections.join('\n') + '\n--- END MEMORY ---');
}

// ─── Tool Call Parser (handles LLM format variations) ───

export function parseToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
  // Reject if the content is just echoing back context (prompt injection defense)
  if (/--- VINEGAR MEMORY ---/.test(content) || /--- END MEMORY ---/.test(content)) return null;

  // 1. Standard format: ```tool_call\n{JSON}\n```
  const jsonFenceMatch = content.match(/```(?:tool_call|tool_code|json|tool)\s*\n?([\s\S]*?)\n?```/);
  if (jsonFenceMatch) {
    try {
      const parsed = JSON.parse(jsonFenceMatch[1].trim());
      if (parsed.name) return { name: parsed.name, arguments: parsed.arguments || {} };
    } catch {
      // Not valid JSON, try other formats
    }
  }

  // 2. Python-style: print(tool_name(arg1='val1', arg2='val2'))
  const pythonMatch = content.match(/(?:print\()?(\w+)\(([^)]*)\)\)?/);
  if (pythonMatch) {
    const toolName = pythonMatch[1];
    const knownTools = ['save_memory', 'recall_memory', 'manage_task', 'get_calendar', 'create_event',
      'update_event', 'delete_event', 'set_reminder', 'manage_grocery', 'manage_meals',
      'manage_activity', 'manage_chore', 'manage_skill', 'get_family', 'get_usage',
      'get_weather', 'get_forecast', 'web_search', 'get_briefing', 'run_workflow', 'find_free_time',
      'suggest_recipe', 'manage_budget', 'get_traffic', 'find_nearby', 'check_deals', 'show_visual',
      'manage_routine', 'manage_homework'];
    if (knownTools.includes(toolName)) {
      const args: Record<string, unknown> = {};
      const kwargRegex = /(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\[[^\]]*\])|(\{[^}]*\})|([^,\s)]+))/g;
      let match;
      while ((match = kwargRegex.exec(pythonMatch[2])) !== null) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
        try { args[key] = JSON.parse(value); } catch { args[key] = value; }
      }
      return { name: toolName, arguments: args };
    }
  }

  // 3. Inline JSON (no fence): {"name": "...", "arguments": {...}}
  const inlineMatch = content.match(/\{\s*"name"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[\s\S]*?\})\s*\}/);
  if (inlineMatch) {
    try {
      const args = JSON.parse(inlineMatch[2]);
      return { name: inlineMatch[1], arguments: args };
    } catch {}
  }

  return null;
}

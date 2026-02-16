/**
 * LLM Middleware
 * Unified pipeline for all text LLM calls:
 * 1. Inject tiered context
 * 2. Redact PII
 * 3. Token budget enforcement
 * 4. Call Euri API (with timeout)
 * 5. Rehydrate PII
 * 6. Log usage
 * 7. Return response
 */

import { db, generateId } from './db';
import { redact, rehydrate } from './pii-redactor';
import { VINEGAR_SYSTEM_PROMPT, CHILD_SAFE_PROMPT } from './vinegar-context';
import { executeTool, getToolSchemas } from './tool-executor';
import { checkDailyBudget, trimToFit, selectModel } from './token-budget';
import { logToolUsage } from './episodes';
import { logConversation } from './conversation-logger';

const EURI_BASE_URL = 'https://api.euron.one/api/v1/euri';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_TOOL_ITERATIONS = 3;

// ─── Response Cache (saves tokens on repeated queries) ───

interface CacheEntry {
  result: LLMResult;
  timestamp: number;
}

const responseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 50;

function getCacheKey(userMsg: string): string {
  // Normalize: lowercase, trim, collapse whitespace
  return userMsg.toLowerCase().trim().replace(/\s+/g, ' ');
}

function getCachedResponse(userMsg: string): LLMResult | null {
  const key = getCacheKey(userMsg);
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCachedResponse(userMsg: string, result: LLMResult): void {
  // Don't cache tool-using responses (they may have side effects)
  if (result.toolsUsed && result.toolsUsed.length > 0) return;
  // Don't cache very short responses (likely errors)
  if (result.content.length < 10) return;

  const key = getCacheKey(userMsg);

  // Evict oldest if at capacity
  if (responseCache.size >= CACHE_MAX_SIZE) {
    const entries = Array.from(responseCache.entries());
    const oldest = entries.sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }

  responseCache.set(key, { result, timestamp: Date.now() });
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  enableTools?: boolean;
  apiKey: string;
}

interface LLMResult {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  toolsUsed?: string[];
}

// ─── Context Sanitization ───

// Strip tool_call patterns from injected context to prevent prompt injection
function sanitizeContext(text: string): string {
  return text
    .replace(/```(?:tool_call|tool_code|tool|json)\s*\n/gi, '``` ')
    .replace(/\{"name"\s*:\s*"(\w+)"\s*,\s*"arguments"/g, '{"_name": "$1", "_arguments"');
}

// ─── Context Builder ───

function buildMemoryContext(userMessage: string): string {
  const sections: string[] = [];

  // Level 0: Family names (always injected)
  try {
    const members = db.prepare('SELECT name, role FROM family_members').all() as { name: string; role: string }[];
    if (members.length > 0) {
      sections.push(`[Family] ${members.map(m => `${m.name} (${m.role})`).join(', ')}`);
    }
  } catch {}

  // Level 1: Relevant memories (match query keywords)
  try {
    const q = `%${userMessage}%`;
    const memories = db.prepare(`
      SELECT topic, content, type FROM memories
      WHERE content LIKE ? OR topic LIKE ? OR tags LIKE ?
      ORDER BY
        CASE importance WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 END,
        created_at DESC
      LIMIT 8
    `).all(q, q, q) as { topic: string; content: string; type: string }[];

    if (memories.length > 0) {
      sections.push('[Relevant Memory]');
      for (const m of memories) {
        sections.push(`- [${m.type}] ${m.topic}: ${m.content}`);
      }
    }
  } catch {}

  // Level 2: Today's calendar + upcoming (within 2hr window)
  const calendarKeywords = /\b(calendar|schedule|event|meeting|appointment|plan|today|tomorrow|week|free|busy|when)\b/i;
  if (calendarKeywords.test(userMessage)) {
    try {
      const now = Math.floor(Date.now() / 1000);
      const twoHoursLater = now + 7200;
      const dayStart = now - (now % 86400);
      const dayEnd = dayStart + 86400;

      const events = db.prepare(`
        SELECT title, start_time, end_time, location FROM calendar_events
        WHERE start_time BETWEEN ? AND ?
        ORDER BY start_time ASC LIMIT 5
      `).all(dayStart, dayEnd) as { title: string; start_time: number; end_time: number; location: string }[];

      if (events.length > 0) {
        sections.push('[Today\'s Schedule]');
        for (const e of events) {
          const start = new Date(e.start_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sections.push(`- ${start}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
        }
      }
    } catch {}
  }

  // Skill gap review keywords
  const gapKeywords = /\b(skill gap|unanswered|couldn't answer|couldn't help|improve|improvement|what.*missing|review.*logs?|what.*can't)\b/i;
  if (gapKeywords.test(userMessage)) {
    try {
      const gaps = db.prepare(`
        SELECT content, created_at FROM memories
        WHERE type = 'fact' AND tags LIKE '%skill_gap%'
        ORDER BY created_at DESC LIMIT 10
      `).all() as { content: string; created_at: number }[];

      if (gaps.length > 0) {
        sections.push('[Skill Gaps - Questions I Couldn\'t Answer]');
        for (const g of gaps) {
          const date = new Date(g.created_at * 1000).toLocaleDateString();
          sections.push(`- (${date}) ${g.content}`);
        }
      }
    } catch {}
  }

  // Task keywords → inject pending tasks
  const taskKeywords = /\b(task|todo|chore|homework|errand|remind|due|overdue)\b/i;
  if (taskKeywords.test(userMessage)) {
    try {
      const tasks = db.prepare(`
        SELECT title, priority, due_date FROM tasks
        WHERE status = 'pending'
        ORDER BY due_date ASC NULLS LAST, priority DESC
        LIMIT 5
      `).all() as { title: string; priority: string; due_date: number | null }[];

      if (tasks.length > 0) {
        sections.push('[Pending Tasks]');
        for (const t of tasks) {
          const due = t.due_date ? ` (due: ${new Date(t.due_date * 1000).toLocaleDateString()})` : '';
          sections.push(`- [${t.priority}] ${t.title}${due}`);
        }
      }
    } catch {}
  }

  // Grocery/meal keywords
  const groceryKeywords = /\b(grocery|groceries|shopping|buy|milk|bread|food|meal|dinner|lunch|breakfast|cook|recipe)\b/i;
  if (groceryKeywords.test(userMessage)) {
    try {
      const items = db.prepare('SELECT item, quantity, unit FROM grocery_items WHERE completed = 0 ORDER BY created_at DESC LIMIT 10').all() as { item: string; quantity: number; unit: string }[];
      if (items.length > 0) {
        sections.push('[Grocery List]');
        for (const i of items) {
          sections.push(`- ${i.item}${i.quantity > 1 ? ` (${i.quantity}${i.unit ? ' ' + i.unit : ''})` : ''}`);
        }
      }
    } catch {}

    try {
      const today = new Date().toISOString().split('T')[0];
      const meals = db.prepare('SELECT meal_type, recipe FROM meal_plans WHERE date = ?').all(today) as { meal_type: string; recipe: string }[];
      if (meals.length > 0) {
        sections.push('[Today\'s Meals]');
        for (const m of meals) {
          sections.push(`- ${m.meal_type}: ${m.recipe}`);
        }
      }
    } catch {}
  }

  // Weather context: inject current date/time for time-aware responses
  const now = new Date();
  sections.unshift(`[Now] ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);

  if (sections.length === 0) return '';
  return sanitizeContext('\n--- VINEGAR MEMORY ---\n' + sections.join('\n') + '\n--- END MEMORY ---');
}

// ─── Tool Instructions for Text Mode ───

function getToolInstructions(): string {
  return `
TOOLS: Call tools via \`\`\`tool_call\n{"name":"TOOL","arguments":{...}}\n\`\`\` format. One tool per call. ALWAYS use tools for actions.

Tools: manage_grocery({action,item,quantity,unit,category}), create_event({title,start_time,end_time,description,location,reminder_minutes}), get_calendar({start,end,family_member_id}), update_event({id,title,start_time,end_time,description,location}), delete_event({id,scope}), set_reminder({message,time,type,target_member}), manage_task({action,title,priority,status,due_date}), manage_chore({action,title,assigned_to,points}), manage_meals({action,date,meal_type,recipe,ingredients[]}), manage_activity({action,title,child_name,day_of_week[],start_time,end_time,location}), save_memory({topic,content,type,importance}), recall_memory({query,type}), manage_skill({action,name,type,trigger_phrases[],url}), get_family({}), get_usage({period}), get_weather({location}), get_forecast({location,days}), web_search({query}), get_briefing({}), run_workflow({steps:[{tool,args}]}), find_free_time({duration_minutes,start_date,end_date,preferred_time})
`;
}

// ─── Tool Call Parser (handles LLM format variations) ───

function parseToolCall(content: string): { name: string; arguments: Record<string, unknown> } | null {
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
      'get_weather', 'get_forecast', 'web_search', 'get_briefing', 'run_workflow', 'find_free_time'];
    if (knownTools.includes(toolName)) {
      const args: Record<string, unknown> = {};
      // Parse Python kwargs: key='value' or key="value" or key=value
      const kwargRegex = /(\w+)\s*=\s*(?:'([^']*)'|"([^"]*)"|(\[[^\]]*\])|(\{[^}]*\})|([^,\s)]+))/g;
      let match;
      while ((match = kwargRegex.exec(pythonMatch[2])) !== null) {
        const key = match[1];
        const value = match[2] ?? match[3] ?? match[4] ?? match[5] ?? match[6];
        // Try to parse as JSON for arrays/objects/numbers
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

// ─── Main Middleware Function ───

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions
): Promise<LLMResult> {
  const { model: requestedModel = 'gemini-2.5-flash', temperature = 0.7, maxTokens = 2048, enableTools = true, apiKey } = options;

  // 0. Check daily budget
  const budget = checkDailyBudget();
  if (!budget.allowed) {
    return {
      content: `I've reached the daily token limit (${budget.used.toLocaleString()} tokens used). Please try again tomorrow, or switch to a more efficient model.`,
      model: requestedModel,
    };
  }

  // 1. Get the last user message for context routing
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

  // 1.1 Check response cache (skip LLM call for repeated queries)
  const cached = getCachedResponse(lastUserMsg);
  if (cached) {
    logConversation({ role: 'user', content: lastUserMsg, source: 'text' });
    logConversation({ role: 'assistant', content: cached.content, model: cached.model, source: 'text', tokensIn: 0, tokensOut: 0 });
    return { ...cached, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
  }

  // 1.5. Model routing: select optimal model based on query
  const model = selectModel(lastUserMsg, requestedModel);

  // 2. Build context
  const memoryContext = buildMemoryContext(lastUserMsg);
  const toolInstructions = enableTools ? getToolInstructions() : '';

  // 2.5 Check if active user is a child (for content filtering)
  let childSafetyAddendum = '';
  try {
    const activeChild = db.prepare("SELECT id FROM family_members WHERE role = 'child' AND is_active = 1 LIMIT 1").get();
    if (activeChild) childSafetyAddendum = CHILD_SAFE_PROMPT;
  } catch {}

  // 3. Build system prompt with static content FIRST (for prompt caching)
  const systemPrompt = `${VINEGAR_SYSTEM_PROMPT}${childSafetyAddendum}${toolInstructions}${memoryContext}`;

  // 3.5 Trim messages to fit token budget
  const { messages: trimmedMsgs } = trimToFit(systemPrompt, messages, memoryContext);

  // 4. Redact PII in user messages
  const redactedMessages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...trimmedMsgs.map(m => {
      if (m.role === 'user') {
        const { redacted } = redact(m.content);
        return { ...m, content: redacted } as LLMMessage;
      }
      return m as LLMMessage;
    }),
  ];

  // Log user question (redact sensitive PII like SSN, CC, but keep family names for readability)
  const { redacted: redactedForLog } = redact(lastUserMsg);
  logConversation({ role: 'user', content: redactedForLog, source: 'text' });

  // 5. Call API with tool loop
  const toolsUsed: string[] = [];
  let finalContent = '';
  let finalUsage: LLMResult['usage'];
  let currentMessages = [...redactedMessages];

  for (let iteration = 0; iteration <= MAX_TOOL_ITERATIONS; iteration++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${EURI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: currentMessages,
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Euri API error (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      finalUsage = data.usage;

      let content = data.choices?.[0]?.message?.content || '';
      if (Array.isArray(content)) {
        content = content.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('');
      }

      // Check for tool calls in response (flexible matching for LLM variations)
      const toolCallParsed = parseToolCall(content);
      if (toolCallParsed && enableTools && iteration < MAX_TOOL_ITERATIONS) {
        try {
          // Rehydrate PII tokens in tool arguments before executing
          // (LLM sees redacted names but DB needs real names)
          const rehydratedArgs: Record<string, unknown> = {};
          for (const [key, value] of Object.entries(toolCallParsed.arguments || {})) {
            if (typeof value === 'string') {
              rehydratedArgs[key] = rehydrate(value);
            } else if (Array.isArray(value)) {
              rehydratedArgs[key] = value.map(v => typeof v === 'string' ? rehydrate(v) : v);
            } else {
              rehydratedArgs[key] = value;
            }
          }
          const toolResult = await executeTool(toolCallParsed.name, rehydratedArgs);
          toolsUsed.push(toolCallParsed.name);

          // Log tool usage as episode
          try { logToolUsage(toolCallParsed.name, toolCallParsed.arguments || {}); } catch {}

          // Add tool result to conversation and continue
          currentMessages.push({ role: 'assistant', content });
          currentMessages.push({
            role: 'user',
            content: `Tool result for ${toolCallParsed.name}: ${JSON.stringify(toolResult)}. Now respond naturally to the user based on this result.`,
          });
          continue;
        } catch {
          // Invalid tool call, treat as normal response
        }
      }

      // 6. Rehydrate PII
      finalContent = rehydrate(content);
      break;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Request timed out after 30 seconds');
      }
      throw err;
    }
  }

  // 6.5 Detect unanswered/unable-to-help responses and log them as skill gaps
  const unablePatterns = /\b(I don't have access|I cannot|I'm not able|I'm sorry.*don't have|I'm not equipped|unable to|don't have the ability|can't check|no access to)\b/i;
  if (unablePatterns.test(finalContent) && toolsUsed.length === 0) {
    try {
      db.prepare(`
        INSERT INTO memories (id, topic, content, type, importance, tags, created_at, updated_at)
        VALUES (?, 'Skill Gap', ?, 'fact', 'medium', '["skill_gap","unanswered","improvement"]', unixepoch(), unixepoch())
      `).run(
        generateId('gap'),
        `User asked: "${lastUserMsg}" — Vinegar couldn't help. Consider adding a skill or API for this.`
      );
    } catch {}
  }

  // 7. Log usage
  try {
    const textIn = finalUsage?.prompt_tokens || 0;
    const textOut = finalUsage?.completion_tokens || 0;
    db.prepare('INSERT INTO usage_logs (model, text_input_tokens, text_output_tokens, cost, source, created_at) VALUES (?, ?, ?, 0, ?, unixepoch())')
      .run(model, textIn, textOut, 'text');
  } catch {}

  // Log assistant response
  logConversation({
    role: 'assistant',
    content: finalContent,
    model,
    source: 'text',
    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
    tokensIn: finalUsage?.prompt_tokens || 0,
    tokensOut: finalUsage?.completion_tokens || 0,
  });

  const result: LLMResult = {
    content: finalContent,
    model,
    usage: finalUsage,
    toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
  };

  // Cache the response for repeated queries
  setCachedResponse(lastUserMsg, result);

  return result;
}

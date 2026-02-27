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
import { VINEGAR_SYSTEM_PROMPT, CHILD_SAFE_PROMPT, getLanguagePrompt } from './vinegar-context';
import { executeTool, getToolSchemas } from './tool-executor';
import { checkDailyBudget, trimToFit, selectModel } from './token-budget';
import { logToolUsage } from './episodes';
import { logConversation } from './conversation-logger';
import { buildMemoryContext, getToolInstructions, parseToolCall } from './prompt-builder';

const EURI_BASE_URL = process.env.EURI_BASE_URL || 'https://api.euron.one/api/v1/euri';
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
  language?: string; // "en-US" | "hi-IN" | "mr-IN" etc.
  activeMemberId?: string; // From speaker identification (overrides DB query)
  visualContext?: string; // Current visual panel state, e.g. "weather card for Fremont"
  source?: "voice" | "text"; // Interaction source — voice gets ultra-concise responses
}

interface LLMResult {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  toolsUsed?: string[];
}

// buildMemoryContext, getToolInstructions, parseToolCall now imported from prompt-builder.ts

// ─── Main Middleware Function ───

export async function callLLM(
  messages: LLMMessage[],
  options: LLMOptions
): Promise<LLMResult> {
  const { model: requestedModel = 'gemini-2.5-flash', temperature = 0.7, maxTokens = 2048, enableTools = true, apiKey, language, activeMemberId, visualContext, source = 'text' } = options;

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
  const memoryContext = buildMemoryContext(lastUserMsg, activeMemberId, visualContext);
  const toolInstructions = enableTools ? getToolInstructions() : '';

  // 2.5 Check if active user is a child (for content filtering)
  // If activeMemberId is provided (from speaker ID), use it directly.
  // Fail-closed: if speaker ID was attempted but no match, default to child-safe.
  let childSafetyAddendum = '';
  try {
    if (activeMemberId) {
      // Speaker identified — check their role directly
      const member = db.prepare("SELECT role FROM family_members WHERE id = ?").get(activeMemberId) as { role: string } | undefined;
      if (member?.role === 'child') childSafetyAddendum = CHILD_SAFE_PROMPT;
    } else {
      // No speaker ID — fall back to DB is_active check
      const activeChild = db.prepare("SELECT id FROM family_members WHERE role = 'child' AND is_active = 1 LIMIT 1").get();
      if (activeChild) childSafetyAddendum = CHILD_SAFE_PROMPT;
    }
  } catch {}

  // 3. Build system prompt with static content FIRST (for prompt caching)
  const languagePrompt = language ? getLanguagePrompt(language) : '';
  const voiceBrevity = source === 'voice'
    ? '\n\nCRITICAL: This is a VOICE conversation. You MUST respond in 1-2 SHORT sentences only. No lists, no formatting, no explanations unless asked. Be like a human assistant giving a quick spoken answer.'
    : '';
  const systemPrompt = `${VINEGAR_SYSTEM_PROMPT}${voiceBrevity}${languagePrompt}${childSafetyAddendum}${toolInstructions}${memoryContext}`;

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
  logConversation({ role: 'user', content: redactedForLog, source: 'text', familyMemberId: activeMemberId });

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
    familyMemberId: activeMemberId,
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

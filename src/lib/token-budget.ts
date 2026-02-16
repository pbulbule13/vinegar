/**
 * Phase 6: Token Budget Management
 *
 * Enforces token limits per request and daily budget.
 * Trim order: chat history -> calendar -> memories -> never trim system prompt.
 */

import { db } from './db';

// Budget limits
const MAX_INPUT_TOKENS = 8000;
const DAILY_TOKEN_LIMIT = 200000;

// Rough token estimation (~4 chars per token for English)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Check if daily budget allows another request.
 */
export function checkDailyBudget(): { allowed: boolean; used: number; remaining: number } {
  try {
    const todayStart = Math.floor(Date.now() / 1000) - (Math.floor(Date.now() / 1000) % 86400);
    const result = db.prepare(`
      SELECT COALESCE(SUM(text_input_tokens + text_output_tokens + audio_input_tokens + audio_output_tokens), 0) as total
      FROM usage_logs
      WHERE created_at >= ?
    `).get(todayStart) as { total: number };

    const used = result.total;
    return {
      allowed: used < DAILY_TOKEN_LIMIT,
      used,
      remaining: Math.max(0, DAILY_TOKEN_LIMIT - used),
    };
  } catch {
    return { allowed: true, used: 0, remaining: DAILY_TOKEN_LIMIT };
  }
}

/**
 * Trim messages to fit within token budget.
 * Priority: system prompt (never trim) > user message > memories > calendar > chat history
 */
export function trimToFit(
  systemPrompt: string,
  chatMessages: Array<{ role: string; content: string }>,
  memoryContext: string
): { messages: Array<{ role: string; content: string }>; trimmed: boolean } {
  const systemTokens = estimateTokens(systemPrompt);
  const memoryTokens = estimateTokens(memoryContext);
  let budget = MAX_INPUT_TOKENS - systemTokens;
  let trimmed = false;

  // First, try to fit everything
  const allTokens = chatMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0) + memoryTokens;

  if (allTokens <= budget) {
    return { messages: chatMessages, trimmed: false };
  }

  // Need to trim. Start with oldest chat history
  trimmed = true;
  let trimmedMessages = [...chatMessages];

  // Keep at least the last 2 messages (current exchange)
  while (trimmedMessages.length > 2) {
    const totalTokens = trimmedMessages.reduce((sum, m) => sum + estimateTokens(m.content), 0) + memoryTokens;
    if (totalTokens <= budget) break;
    trimmedMessages.shift();
  }

  // If still over budget, truncate memory context (handled by caller via memoryContext param)
  return { messages: trimmedMessages, trimmed };
}

/**
 * Select optimal model based on query complexity.
 * Uses only models confirmed to work on the Euri API.
 */
export function selectModel(userMessage: string, defaultModel: string): string {
  const complex = /\b(explain|analyze|compare|think|help me|write|create a plan|design|suggest a detailed|recommend|why does|how do)\b/i;

  // Complex reasoning with long messages -> smart model
  if (complex.test(userMessage) && userMessage.length > 100) {
    return 'gpt-4o-mini';
  }

  // Default: gemini-2.5-flash for everything else (fast + capable)
  return defaultModel;
}

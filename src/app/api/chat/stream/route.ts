/**
 * Streaming chat endpoint.
 * Returns Server-Sent Events (SSE) for progressive text rendering.
 * Includes offline command interception, tool execution, and PII handling.
 * Uses shared prompt-builder for context (same as non-streaming route).
 */

import { cookies } from "next/headers";
import { chatRequestSchema } from "@/lib/validators";
import { VINEGAR_SYSTEM_PROMPT, getLanguagePrompt } from "@/lib/vinegar-context";
import { redact, rehydrate } from "@/lib/pii-redactor";
import { checkDailyBudget, selectModel } from "@/lib/token-budget";
import { logConversation } from "@/lib/conversation-logger";
import { tryOfflineResponse } from "@/lib/offline-commands";
import { executeTool } from "@/lib/tool-executor";
import { logToolUsage } from "@/lib/episodes";
import { buildMemoryContext, getToolInstructions, parseToolCall } from "@/lib/prompt-builder";
import { db } from "@/lib/db";
import '@/lib/init';

const EURI_BASE_URL = process.env.EURI_BASE_URL || "https://api.euron.one/api/v1/euri";
const MAX_TOOL_ITERATIONS = 3;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const userApiKey = cookieStore.get("euri_api_key")?.value;
  const apiKey = userApiKey || process.env.EURI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: "No API key" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  const budget = checkDailyBudget();
  if (!budget.allowed) {
    return new Response(JSON.stringify({ error: "Daily token limit reached" }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  try {
    const body = await request.json();
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const { messages, model: requestedModel, language, visualContext } = parsed.data;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Check offline commands first - saves tokens
    const offlineResult = tryOfflineResponse(lastUserMsg, language as import("@/types/language").SupportedLanguage);
    if (offlineResult) {
      logConversation({ role: 'user', content: lastUserMsg, source: 'offline' });
      logConversation({ role: 'assistant', content: offlineResult.response, source: 'offline', tokensIn: 0, tokensOut: 0 });
      const encoder = new TextEncoder();
      const offlineStream = new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ content: offlineResult.response })}\n\n`));
          ctrl.enqueue(encoder.encode('data: [DONE]\n\n'));
          ctrl.close();
        },
      });
      return new Response(offlineStream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
      });
    }

    const model = selectModel(lastUserMsg, requestedModel || 'gemini-2.5-flash');
    // Use shared buildMemoryContext (same full context as non-streaming route)
    const memoryContext = buildMemoryContext(lastUserMsg, undefined, visualContext);
    const toolInstructions = getToolInstructions();
    const languagePrompt = language ? getLanguagePrompt(language) : '';
    const systemPrompt = `${VINEGAR_SYSTEM_PROMPT}${languagePrompt}${toolInstructions}${memoryContext}`;

    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => {
        if (m.role === 'user') {
          const { redacted } = redact(m.content);
          return { role: m.role, content: redacted };
        }
        return { role: m.role, content: m.content };
      }),
    ];

    // Log user question (redacted for PII safety)
    const { redacted: redactedForLog } = redact(lastUserMsg);
    logConversation({ role: 'user', content: redactedForLog, source: 'stream' });

    const encoder = new TextEncoder();
    const toolsUsed: string[] = [];

    // ─── Helper: Non-streaming LLM call for tool follow-up ───
    async function callLLMNonStreaming(msgs: { role: string; content: string }[]): Promise<string> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(`${EURI_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model, messages: msgs, max_tokens: 2048, temperature: 0.7 }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return '';
        const data = await res.json();
        let content = data.choices?.[0]?.message?.content || '';
        if (Array.isArray(content)) {
          content = content.filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('');
        }
        return content;
      } catch {
        clearTimeout(timeout);
        return '';
      }
    }

    // ─── Helper: Execute tool call with PII rehydration ───
    async function executeToolWithPII(toolCall: { name: string; arguments: Record<string, unknown> }): Promise<import("@/lib/tool-executor").ToolResult> {
      const rehydratedArgs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(toolCall.arguments || {})) {
        if (typeof value === 'string') {
          rehydratedArgs[key] = rehydrate(value);
        } else if (Array.isArray(value)) {
          rehydratedArgs[key] = value.map(v => typeof v === 'string' ? rehydrate(v) : v);
        } else {
          rehydratedArgs[key] = value;
        }
      }
      // Inject active member ID for per-user tools
      try {
        const activeMember = db.prepare("SELECT id FROM family_members WHERE is_active = 1 LIMIT 1").get() as { id: string } | undefined;
        if (activeMember) rehydratedArgs._active_member_id = activeMember.id;
      } catch {}
      const result = await executeTool(toolCall.name, rehydratedArgs);
      toolsUsed.push(toolCall.name);
      try { logToolUsage(toolCall.name, toolCall.arguments || {}); } catch {}
      return result;
    }

    // ─── Main streaming logic ───
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = '';
        try {
          // Phase 1: Stream initial LLM response
          const abortCtrl = new AbortController();
          const timeout = setTimeout(() => abortCtrl.abort(), 30000);

          const res = await fetch(`${EURI_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({ model, messages: apiMessages, stream: true, max_tokens: 2048, temperature: 0.7 }),
            signal: abortCtrl.signal,
          });
          clearTimeout(timeout);

          if (!res.ok || !res.body) {
            const err = await res.text();
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `Error: ${err}` })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
            return;
          }

          // Read streamed response
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    const rehydrated = rehydrate(content);
                    fullResponse += rehydrated;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: rehydrated })}\n\n`));
                  }
                } catch {
                  // Malformed SSE chunk — skip
                }
              }
            }
          }

          // Phase 2: Check for tool calls in the accumulated response
          const toolCall = parseToolCall(fullResponse);
          if (toolCall) {
            // Clear the streamed tool_call text — replace with execution feedback
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: '\n', clearPrevious: true })}\n\n`));

            let currentMessages = [...apiMessages];
            let toolResponse = fullResponse;
            let finalContent = '';

            for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
              const currentToolCall = parseToolCall(toolResponse);
              if (!currentToolCall) break;

              // Execute the tool
              const toolResult = await executeToolWithPII(currentToolCall);

              // Send a brief status update to the client
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                content: '',
                toolExecution: { name: currentToolCall.name, success: toolResult.success }
              })}\n\n`));

              // Build follow-up messages for LLM
              currentMessages = [
                ...currentMessages,
                { role: 'assistant', content: toolResponse },
                { role: 'user', content: `Tool result for ${currentToolCall.name}: ${JSON.stringify(toolResult)}. Now respond naturally to the user based on this result.` },
              ];

              // Get LLM's natural language response (non-streaming for tool follow-up)
              toolResponse = await callLLMNonStreaming(currentMessages);

              // Check if this response also has a tool call
              const nextToolCall = parseToolCall(toolResponse);
              if (!nextToolCall) {
                // Final response — stream it to client
                finalContent = rehydrate(toolResponse);
                break;
              }
              // Otherwise, loop continues with next tool call
            }

            // Stream the final natural language response
            if (finalContent) {
              // Clear the previous tool_call text and send the clean response
              fullResponse = finalContent;
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: finalContent, replaceAll: true })}\n\n`));
            }
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Stream failed';
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: `Connection issue: ${msg}` })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } finally {
          // Log the full response and usage
          if (fullResponse) {
            logConversation({
              role: 'assistant',
              content: fullResponse,
              model,
              source: 'stream',
              toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
            });
            try {
              const estIn = estimateTokens(systemPrompt + messages.map(m => m.content).join(''));
              const estOut = estimateTokens(fullResponse);
              db.prepare('INSERT INTO usage_logs (model, text_input_tokens, text_output_tokens, cost, source, created_at) VALUES (?, ?, ?, 0, ?, unixepoch())')
                .run(model, estIn, estOut, 'text');
            } catch {}
          }
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Stream failed";
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}

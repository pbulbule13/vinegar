/**
 * Streaming chat endpoint.
 * Returns Server-Sent Events (SSE) for progressive text rendering.
 * Includes offline command interception, tool instructions, and PII handling.
 */

import { cookies } from "next/headers";
import { chatRequestSchema } from "@/lib/validators";
import { VINEGAR_SYSTEM_PROMPT } from "@/lib/vinegar-context";
import { redact, rehydrate } from "@/lib/pii-redactor";
import { checkDailyBudget, selectModel } from "@/lib/token-budget";
import { logConversation } from "@/lib/conversation-logger";
import { tryOfflineResponse } from "@/lib/offline-commands";
import { db } from "@/lib/db";
import '@/lib/init';

const EURI_BASE_URL = "https://api.euron.one/api/v1/euri";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getToolInstructions(): string {
  return `
TOOLS: Call tools via \`\`\`tool_call\n{"name":"TOOL","arguments":{...}}\n\`\`\` format. One tool per call. ALWAYS use tools for actions.

Tools: manage_grocery({action,item,quantity,unit,category}), create_event({title,start_time,end_time,description,location,reminder_minutes}), get_calendar({start,end,family_member_id}), update_event({id,title,start_time,end_time,description,location}), delete_event({id,scope}), set_reminder({message,time,type,target_member}), manage_task({action,title,priority,status,due_date}), manage_chore({action,title,assigned_to,points}), manage_meals({action,date,meal_type,recipe,ingredients[]}), manage_activity({action,title,child_name,day_of_week[],start_time,end_time,location}), save_memory({topic,content,type,importance}), recall_memory({query,type}), manage_skill({action,name,type,trigger_phrases[],url}), get_family({}), get_usage({period}), get_weather({location}), get_forecast({location,days}), web_search({query}), get_briefing({}), run_workflow({steps:[{tool,args}]}), find_free_time({duration_minutes,start_date,end_date,preferred_time})
`;
}

function buildMemoryContext(userMessage: string): string {
  const sections: string[] = [];
  try {
    const members = db.prepare('SELECT name, role FROM family_members').all() as { name: string; role: string }[];
    if (members.length > 0) sections.push(`[Family] ${members.map(m => `${m.name} (${m.role})`).join(', ')}`);
  } catch {}

  try {
    const q = `%${userMessage}%`;
    const memories = db.prepare('SELECT topic, content, type FROM memories WHERE content LIKE ? OR topic LIKE ? ORDER BY created_at DESC LIMIT 5').all(q, q) as { topic: string; content: string; type: string }[];
    if (memories.length > 0) {
      sections.push('[Memory]');
      memories.forEach(m => sections.push(`- [${m.type}] ${m.topic}: ${m.content}`));
    }
  } catch {}

  return sections.length > 0 ? '\n---\n' + sections.join('\n') + '\n---' : '';
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

    const { messages, model: requestedModel } = parsed.data;
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // Check offline commands first - saves tokens
    const offlineResult = tryOfflineResponse(lastUserMsg);
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
    const memoryContext = buildMemoryContext(lastUserMsg);
    const toolInstructions = getToolInstructions();
    const systemPrompt = `${VINEGAR_SYSTEM_PROMPT}${toolInstructions}${memoryContext}`;

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

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const res = await fetch(`${EURI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: apiMessages, stream: true, max_tokens: 2048, temperature: 0.7 }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok || !res.body) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), { status: res.status, headers: { "Content-Type": "application/json" } });
    }

    // Transform SSE stream: rehydrate PII in each chunk
    const reader = res.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = '';
        let fullResponse = ''; // Accumulate for logging
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  continue;
                }
                try {
                  const parsed = JSON.parse(data);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    const rehydrated = rehydrate(content);
                    fullResponse += rehydrated;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: rehydrated })}\n\n`));
                  }
                } catch {}
              }
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          // Log the full assistant response and usage
          if (fullResponse) {
            logConversation({ role: 'assistant', content: fullResponse, model, source: 'stream' });
            // Log estimated usage for budget tracking
            try {
              const estIn = estimateTokens(systemPrompt + messages.map(m => m.content).join(''));
              const estOut = estimateTokens(fullResponse);
              db.prepare('INSERT INTO usage_logs (model, text_input_tokens, text_output_tokens, cost, source, created_at) VALUES (?, ?, ?, 0, ?, unixepoch())')
                .run(model, estIn, estOut, 'stream');
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

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { callLLM } from "@/lib/llm-middleware";
import { chatRequestSchema } from "@/lib/validators";
import { tryOfflineResponse } from "@/lib/offline-commands";
import { logConversation } from "@/lib/conversation-logger";

const DEFAULT_MODEL = "gemini-2.5-flash";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const userApiKey = cookieStore.get("euri_api_key")?.value;
  const apiKey = userApiKey || process.env.EURI_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: "No Euri API key. Go to Settings to add yours." },
      { status: 500 }
    );
  }

  try {
    const body = await request.json();

    // Validate input
    const parsed = chatRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { messages, model, language, source } = parsed.data;

    // Check offline commands first - saves tokens for simple queries
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const offlineResult = tryOfflineResponse(lastUserMsg, language as import("@/types/language").SupportedLanguage);
    if (offlineResult) {
      // Log offline interaction (zero tokens)
      logConversation({ role: 'user', content: lastUserMsg, source: 'offline' });
      logConversation({ role: 'assistant', content: offlineResult.response, source: 'offline', tokensIn: 0, tokensOut: 0 });
      return NextResponse.json({
        content: offlineResult.response,
        model: 'offline',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    // Call through unified middleware (handles PII, context, tools, logging)
    const result = await callLLM(
      messages.map(m => ({ role: m.role, content: m.content })),
      {
        model: model || DEFAULT_MODEL,
        apiKey,
        enableTools: true,
        language,
        source: source || "text",
      }
    );

    return NextResponse.json({
      content: result.content || "I couldn't generate a response.",
      model: result.model,
      usage: result.usage,
      toolsUsed: result.toolsUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get response";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

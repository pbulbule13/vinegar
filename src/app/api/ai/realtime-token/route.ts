import { NextResponse } from "next/server";
import { VINEGAR_SYSTEM_PROMPT } from "@/lib/vinegar-context";
import { memory } from "@/lib/memory";
import { redact } from "@/lib/pii-redactor";
import { getToolSchemas } from "@/lib/tool-executor";
import { cookies } from "next/headers";
export const dynamic = 'force-dynamic';

const DEFAULT_REALTIME_MODEL = "gpt-4o-mini-realtime-preview-2024-12-17";
const ALLOWED_MODELS = [
  "gpt-4o-mini-realtime-preview-2024-12-17",
  "gpt-4o-realtime-preview-2024-12-17",
  "gpt-realtime-mini",
  "gpt-realtime",
];

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const userApiKey = cookieStore.get("openai_api_key")?.value;
  const apiKey = userApiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "No OpenAI API key. Go to Settings to add yours." }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const voice = body.voice || "ash";
    const REALTIME_MODEL = ALLOWED_MODELS.includes(body.model) ? body.model : DEFAULT_REALTIME_MODEL;

    // Build memory context and redact PII from it
    const memoryContext = memory.getMemoryContext();
    const rawInstructions = memoryContext
      ? `${VINEGAR_SYSTEM_PROMPT}\n\n${memoryContext}`
      : VINEGAR_SYSTEM_PROMPT;

    // Redact PII from system prompt memory context (including family names for external OpenAI API)
    const { redacted: instructions } = redact(rawInstructions, { redactFamilyNames: true });

    const realtimeTools = getToolSchemas().slice(0, 3); // save_memory, recall_memory, manage_task for voice

    const sessionConfig = {
      type: "realtime" as const,
      model: REALTIME_MODEL,
      instructions,
      tools: realtimeTools,
      audio: {
        output: { voice },
      },
    };

    // Creating realtime session

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ session: sessionConfig }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      // client_secrets failed - return generic error to client

      // SECURITY FIX: Never return raw API key to browser
      return NextResponse.json(
        { error: "Failed to create voice session. Check your OpenAI API key." },
        { status: 502 }
      );
    }

    const data = await response.json();
    // Ephemeral token created successfully

    // SECURITY: Don't return full instructions to client - they contain system prompt details
    return NextResponse.json({
      token: data.client_secret?.value || data.value,
      type: "ephemeral",
      expiresAt: data.client_secret?.expires_at || data.expires_at,
      model: REALTIME_MODEL,
      voice,
      tools: realtimeTools,
    });
  } catch (err) {
    // Token route error - return generic message
    // SECURITY FIX: Never expose API key in error fallback
    return NextResponse.json(
      { error: "Failed to initialize voice session" },
      { status: 500 }
    );
  }
}

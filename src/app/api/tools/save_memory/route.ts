import { NextResponse } from "next/server";
import { executeTool } from "@/lib/tool-executor";
import { saveMemorySchema } from "@/lib/validators";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = saveMemorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
    }

    const result = await executeTool('save_memory', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to save memory" }, { status: 500 });
  }
}

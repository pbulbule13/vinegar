import { NextResponse } from "next/server";
import { executeTool } from "@/lib/tool-executor";
import { recallMemorySchema } from "@/lib/validators";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = recallMemorySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
    }

    const result = await executeTool('recall_memory', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to recall memory" }, { status: 500 });
  }
}

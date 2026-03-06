import { NextResponse } from "next/server";
import { executeTool } from "@/lib/tool-executor";
import { manageTaskSchema } from "@/lib/validators";

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = manageTaskSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.issues }, { status: 400 });
    }

    const result = await executeTool('manage_task', parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to manage task" }, { status: 500 });
  }
}

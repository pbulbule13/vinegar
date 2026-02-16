import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { calculateRealtimeCost } from "@/lib/pricing";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { model, usage } = body;

    if (!model) {
      return NextResponse.json({ error: "model required" }, { status: 400 });
    }

    const audioIn = usage?.input_token_details?.audio_tokens || 0;
    const audioOut = usage?.output_token_details?.audio_tokens || 0;
    const textIn = usage?.input_token_details?.text_tokens || usage?.input_tokens || 0;
    const textOut = usage?.output_token_details?.text_tokens || usage?.output_tokens || 0;

    const cost = calculateRealtimeCost(model, audioIn, audioOut, textIn, textOut);

    db.prepare(`
      INSERT INTO usage_logs (model, audio_input_tokens, audio_output_tokens, text_input_tokens, text_output_tokens, cost, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'voice', unixepoch())
    `).run(model, audioIn, audioOut, textIn, textOut, cost);

    return NextResponse.json({ success: true, cost });
  } catch {
    return NextResponse.json({ error: "Failed to log usage" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const totalRow = db.prepare('SELECT COUNT(*) as count, COALESCE(SUM(cost), 0) as total FROM usage_logs').get() as { count: number; total: number };

    const todayStart = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    const todayRow = db.prepare('SELECT COALESCE(SUM(cost), 0) as total FROM usage_logs WHERE created_at >= ?').get(todayStart) as { total: number };

    return NextResponse.json({
      totalConversations: totalRow.count,
      totalCost: Math.round(totalRow.total * 10000) / 10000,
      todayCost: Math.round(todayRow.total * 10000) / 10000,
    });
  } catch {
    return NextResponse.json({ totalConversations: 0, totalCost: 0, todayCost: 0 });
  }
}

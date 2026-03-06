/**
 * Briefing API Route
 * GET /api/briefing - Get the daily briefing
 */

import { NextResponse } from 'next/server';
import '@/lib/init';
import { generateBriefing } from '@/lib/briefing-tools';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const briefing = await generateBriefing();
    return NextResponse.json(briefing);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Briefing generation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Conversation Logs API
 * GET: Retrieve conversation history
 * POST: Log a voice/external conversation entry
 */

import { NextResponse } from 'next/server';
import { logConversation, getRecentConversations, searchConversations } from '@/lib/conversation-logger';
import { z } from 'zod';

const logSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(50000),
  source: z.enum(['text', 'stream', 'voice']).default('voice'),
  model: z.string().max(100).optional(),
});

const querySchema = z.object({
  q: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query' }, { status: 400 });
    }

    const { q, limit } = parsed.data;
    const logs = q
      ? searchConversations(q, limit)
      : getRecentConversations(limit);

    return NextResponse.json({ conversations: logs, count: logs.length });
  } catch (err) {
    console.error('[Conversations] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = logSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid log entry' }, { status: 400 });
    }

    logConversation({
      role: parsed.data.role,
      content: parsed.data.content,
      source: parsed.data.source,
      model: parsed.data.model,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Conversations] POST error:', err);
    return NextResponse.json({ error: 'Failed to log conversation' }, { status: 500 });
  }
}

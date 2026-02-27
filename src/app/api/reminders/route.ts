import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { reminderSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const active = searchParams.get('active') !== 'false';
    const memberId = searchParams.get('member_id');

    let query = 'SELECT * FROM scheduled_reminders WHERE 1=1';
    const params: unknown[] = [];

    if (active) { query += ' AND is_active = 1'; }
    if (memberId) { query += ' AND target_member_id = ?'; params.push(memberId); }

    query += ' ORDER BY next_fire_time ASC LIMIT 50';

    const reminders = db.prepare(query).all(...params);
    return NextResponse.json({ reminders });
  } catch (err) {
    console.error('[API /reminders]', err instanceof Error ? err.message : err);
    return NextResponse.json({ reminders: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Snooze action
    if (body.action === 'snooze') {
      const { id } = body;
      const minutes = typeof body.minutes === 'number' && body.minutes > 0 && body.minutes <= 1440 ? body.minutes : 5;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

      const reminder = db.prepare('SELECT * FROM scheduled_reminders WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!reminder) return NextResponse.json({ error: 'Reminder not found' }, { status: 404 });
      if ((reminder.snooze_count as number) >= 3) return NextResponse.json({ error: 'Max snoozes reached' }, { status: 400 });

      const newFireTime = Math.floor(Date.now() / 1000) + (minutes * 60);
      db.prepare('UPDATE scheduled_reminders SET next_fire_time = ?, snooze_count = snooze_count + 1, delivery_status = ? WHERE id = ?')
        .run(newFireTime, 'pending', id);

      return NextResponse.json({ success: true, message: `Snoozed for ${minutes} minutes` });
    }

    // Acknowledge action
    if (body.action === 'acknowledge') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      db.prepare("UPDATE scheduled_reminders SET acknowledged_at = unixepoch(), delivery_status = 'delivered', is_active = 0 WHERE id = ?").run(id);
      return NextResponse.json({ success: true });
    }

    // Create new reminder
    const parsed = reminderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { type, message, cron_expression, next_fire_time, target_member_id, source_type, source_id } = parsed.data;
    const id = generateId('rem');

    db.prepare(`
      INSERT INTO scheduled_reminders (id, type, message, cron_expression, next_fire_time, target_member_id, source_type, source_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, type, message, cron_expression || null, next_fire_time || null, target_member_id || null, source_type || 'manual', source_id || null);

    return NextResponse.json({ success: true, id, message: `Reminder set: ${message}` });
  } catch (err) {
    console.error('[API /reminders]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to manage reminder' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    db.prepare('UPDATE scheduled_reminders SET is_active = 0 WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[API /reminders]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to delete reminder' }, { status: 500 });
  }
}

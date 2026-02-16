import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { calendarEventSchema, calendarEventUpdateSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const start = searchParams.get('start');
    const end = searchParams.get('end');
    const memberId = searchParams.get('member_id');

    let query = 'SELECT * FROM calendar_events WHERE 1=1';
    const params: unknown[] = [];

    if (start) { query += ' AND end_time >= ?'; params.push(Number(start)); }
    if (end) { query += ' AND start_time <= ?'; params.push(Number(end)); }
    if (memberId) { query += ' AND (family_member_id = ? OR family_member_id IS NULL)'; params.push(memberId); }

    query += ' ORDER BY start_time ASC LIMIT 100';

    const events = db.prepare(query).all(...params) as Record<string, unknown>[];

    return NextResponse.json({
      events: events.map(e => ({
        ...e,
        all_day: Boolean(e.all_day),
      })),
    });
  } catch {
    return NextResponse.json({ events: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = calendarEventSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { title, description, start_time, end_time, all_day, location, family_member_id, reminder_minutes, recurring } = parsed.data;
    const id = generateId('evt');

    db.prepare(`
      INSERT INTO calendar_events (id, title, description, start_time, end_time, all_day, location, family_member_id, reminder_minutes, recurring, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(id, title, description || null, start_time, end_time, all_day ? 1 : 0, location || null, family_member_id || null, reminder_minutes || null, recurring || null);

    // Add attendees if specified
    if (body.attendees && Array.isArray(body.attendees)) {
      const insertAttendee = db.prepare('INSERT OR IGNORE INTO calendar_event_attendees (event_id, family_member_id) VALUES (?, ?)');
      for (const attendeeId of body.attendees) {
        insertAttendee.run(id, attendeeId);
      }
    }

    // Auto-create reminder if specified
    if (reminder_minutes && reminder_minutes > 0) {
      const reminderId = generateId('rem');
      const reminderTime = start_time - (reminder_minutes * 60);
      db.prepare(`
        INSERT INTO scheduled_reminders (id, type, message, next_fire_time, source_type, source_id)
        VALUES (?, 'one_time', ?, ?, 'calendar', ?)
      `).run(reminderId, `Reminder: ${title} in ${reminder_minutes} minutes`, reminderTime, id);
    }

    return NextResponse.json({ success: true, id, message: `Event created: ${title}` });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = calendarEventUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }
    const { id, ...updates } = parsed.data;

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.title) { setClauses.push('title = ?'); values.push(updates.title); }
    if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
    if (updates.start_time) { setClauses.push('start_time = ?'); values.push(updates.start_time); }
    if (updates.end_time) { setClauses.push('end_time = ?'); values.push(updates.end_time); }
    if (updates.location !== undefined) { setClauses.push('location = ?'); values.push(updates.location); }

    if (setClauses.length === 0) return NextResponse.json({ error: 'No updates' }, { status: 400 });
    setClauses.push('updated_at = unixepoch()');
    values.push(id);

    db.prepare(`UPDATE calendar_events SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update event' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
    db.prepare("DELETE FROM scheduled_reminders WHERE source_type = 'calendar' AND source_id = ?").run(id);

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete event' }, { status: 500 });
  }
}

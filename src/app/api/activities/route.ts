import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('member_id');

    // Activities are stored as recurring calendar events with source='skill'
    let query = "SELECT * FROM calendar_events WHERE source = 'skill' OR recurring IS NOT NULL";
    const params: unknown[] = [];

    if (memberId) {
      query += ' AND family_member_id = ?';
      params.push(memberId);
    }

    query += ' ORDER BY start_time ASC';
    const activities = db.prepare(query).all(...params);
    return NextResponse.json({ activities });
  } catch {
    return NextResponse.json({ activities: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, family_member_id, day_of_week, start_time, end_time, location, notes } = body;

    if (!title || !family_member_id || !day_of_week || !start_time || !end_time) {
      return NextResponse.json({ error: 'title, family_member_id, day_of_week, start_time, end_time required' }, { status: 400 });
    }

    // Create calendar events for the next 4 weeks
    const now = new Date();
    const events: string[] = [];

    for (let week = 0; week < 4; week++) {
      for (const day of day_of_week as number[]) {
        const eventDate = new Date(now);
        const currentDay = eventDate.getDay();
        const daysUntil = ((day - currentDay + 7) % 7) + (week * 7);
        eventDate.setDate(eventDate.getDate() + daysUntil);

        if (eventDate < now && week === 0) continue; // Skip past dates in current week

        const [startH, startM] = (start_time as string).split(':').map(Number);
        const [endH, endM] = (end_time as string).split(':').map(Number);

        const startTs = new Date(eventDate);
        startTs.setHours(startH, startM, 0, 0);
        const endTs = new Date(eventDate);
        endTs.setHours(endH, endM, 0, 0);

        const id = generateId('act');
        db.prepare(`
          INSERT INTO calendar_events (id, title, description, start_time, end_time, location, family_member_id, source, recurring)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'skill', ?)
        `).run(
          id, title, notes || null,
          Math.floor(startTs.getTime() / 1000), Math.floor(endTs.getTime() / 1000),
          location || null, family_member_id, JSON.stringify({ day_of_week, start_time, end_time })
        );
        events.push(id);
      }
    }

    return NextResponse.json({ success: true, eventsCreated: events.length, message: `Activity "${title}" created with ${events.length} events` });
  } catch {
    return NextResponse.json({ error: 'Failed to create activity' }, { status: 500 });
  }
}

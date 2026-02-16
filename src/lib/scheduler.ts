/**
 * Persistent Scheduling Engine
 * Loads reminders from DB and evaluates them on a timer.
 * Works without external scheduler dependency for Phase 1.
 */

import { db } from './db';
import { vinegarEvents } from './events';

const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds
let intervalId: ReturnType<typeof setInterval> | null = null;

export function startScheduler(): void {
  if (intervalId) return; // Already running

  console.log('[Scheduler] Starting reminder evaluation loop');

  intervalId = setInterval(() => {
    evaluateReminders();
  }, CHECK_INTERVAL_MS);

  // Run once immediately
  evaluateReminders();
}

export function stopScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log('[Scheduler] Stopped');
  }
}

function evaluateReminders(): void {
  try {
    const now = Math.floor(Date.now() / 1000);

    // Find due reminders
    const dueReminders = db.prepare(`
      SELECT * FROM scheduled_reminders
      WHERE is_active = 1
        AND delivery_status = 'pending'
        AND next_fire_time IS NOT NULL
        AND next_fire_time <= ?
      ORDER BY next_fire_time ASC
      LIMIT 10
    `).all(now) as Record<string, unknown>[];

    for (const reminder of dueReminders) {
      // Mark as fired
      db.prepare("UPDATE scheduled_reminders SET delivery_status = 'fired' WHERE id = ?").run(reminder.id);

      // Emit event for UI to pick up
      vinegarEvents.emit('reminder:fired', {
        id: reminder.id,
        message: reminder.message,
        type: reminder.type,
        targetMemberId: reminder.target_member_id,
        sourceType: reminder.source_type,
        sourceId: reminder.source_id,
      });

      console.log(`[Scheduler] Fired reminder: ${reminder.message}`);

      // Handle recurring reminders
      if (reminder.type === 'daily') {
        const nextTime = (reminder.next_fire_time as number) + 86400;
        db.prepare("UPDATE scheduled_reminders SET next_fire_time = ?, delivery_status = 'pending' WHERE id = ?")
          .run(nextTime, reminder.id);
      } else if (reminder.type === 'weekly') {
        const nextTime = (reminder.next_fire_time as number) + (86400 * 7);
        db.prepare("UPDATE scheduled_reminders SET next_fire_time = ?, delivery_status = 'pending' WHERE id = ?")
          .run(nextTime, reminder.id);
      }
      // one_time reminders stay as 'fired' and is_active stays true until acknowledged
    }
  } catch (err) {
    console.error('[Scheduler] Error evaluating reminders:', err);
  }
}

// Register calendar event tools in the tool executor
import { registerTool, executeTool } from './tool-executor';

registerTool('get_calendar', 'Read calendar events for a date range', (args) => {
  const { start, end, family_member_id } = args as { start?: string; end?: string; family_member_id?: string };

  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400);
  const dayEnd = dayStart + 86400;

  const startTs = start ? Math.floor(new Date(start as string).getTime() / 1000) : dayStart;
  const endTs = end ? Math.floor(new Date(end as string).getTime() / 1000) : dayEnd;

  if (isNaN(startTs) || isNaN(endTs)) return { success: false, error: 'Invalid date format. Use ISO format (e.g., 2026-02-15)' };

  let query = 'SELECT id, title, start_time, end_time, all_day, location, source FROM calendar_events WHERE end_time >= ? AND start_time <= ?';
  const params: unknown[] = [startTs, endTs];

  if (family_member_id) {
    query += ' AND (family_member_id = ? OR family_member_id IS NULL)';
    params.push(family_member_id);
  }

  query += ' ORDER BY start_time ASC LIMIT 20';
  const events = db.prepare(query).all(...params) as Record<string, unknown>[];

  return {
    success: true,
    data: {
      count: events.length,
      events: events.map(e => ({
        ...e,
        start: new Date((e.start_time as number) * 1000).toISOString(),
        end: new Date((e.end_time as number) * 1000).toISOString(),
      })),
    },
  };
});

registerTool('create_event', 'Create a new calendar event', (args) => {
  const { title, start_time, end_time, description, location, all_day, reminder_minutes } = args as {
    title: string; start_time: string; end_time: string; description?: string; location?: string; all_day?: boolean; reminder_minutes?: number;
  };

  if (!title || !start_time || !end_time) return { success: false, error: 'title, start_time, and end_time required' };

  const startTs = Math.floor(new Date(start_time).getTime() / 1000);
  const endTs = Math.floor(new Date(end_time).getTime() / 1000);

  if (isNaN(startTs) || isNaN(endTs)) return { success: false, error: 'Invalid date format. Use ISO format (e.g., 2026-02-15T10:00:00)' };

  const id = `evt_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  db.prepare(`
    INSERT INTO calendar_events (id, title, description, start_time, end_time, all_day, location, reminder_minutes, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'manual')
  `).run(id, title, description || null, startTs, endTs, all_day ? 1 : 0, location || null, reminder_minutes || null);

  if (reminder_minutes && reminder_minutes > 0) {
    const remId = `rem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
    db.prepare(`INSERT INTO scheduled_reminders (id, type, message, next_fire_time, source_type, source_id) VALUES (?, 'one_time', ?, ?, 'calendar', ?)`)
      .run(remId, `Upcoming: ${title}`, startTs - (reminder_minutes * 60), id);
  }

  return { success: true, data: { id }, message: `Event "${title}" created` };
});

registerTool('update_event', 'Update an existing calendar event', (args) => {
  const { id, title, start_time, end_time, description, location } = args as {
    id: string; title?: string; start_time?: string; end_time?: string; description?: string; location?: string;
  };
  if (!id) return { success: false, error: 'id required' };

  const updates: string[] = [];
  const values: unknown[] = [];

  if (title) { updates.push('title = ?'); values.push(title); }
  if (description !== undefined) { updates.push('description = ?'); values.push(description); }
  if (start_time) { updates.push('start_time = ?'); values.push(Math.floor(new Date(start_time).getTime() / 1000)); }
  if (end_time) { updates.push('end_time = ?'); values.push(Math.floor(new Date(end_time).getTime() / 1000)); }
  if (location !== undefined) { updates.push('location = ?'); values.push(location); }

  if (updates.length === 0) return { success: false, error: 'No updates' };
  updates.push('updated_at = unixepoch()');
  values.push(id);

  db.prepare(`UPDATE calendar_events SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  return { success: true, message: 'Event updated' };
});

registerTool('delete_event', 'Delete/cancel a calendar event', (args) => {
  const { id } = args as { id: string };
  if (!id) return { success: false, error: 'id required' };

  db.prepare('DELETE FROM calendar_events WHERE id = ?').run(id);
  db.prepare("DELETE FROM scheduled_reminders WHERE source_type = 'calendar' AND source_id = ?").run(id);
  return { success: true, message: 'Event deleted' };
});

registerTool('set_reminder', 'Create a reminder or alarm', (args) => {
  const { message, time, type = 'one_time', target_member } = args as {
    message: string; time: string; type?: string; target_member?: string;
  };

  if (!message || !time) return { success: false, error: 'message and time required' };

  let fireTime: number;
  // Parse relative time like "in 30 minutes"
  const relativeMatch = time.match(/in\s+(\d+)\s+(minute|hour|day)s?/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const seconds = unit === 'minute' ? amount * 60 : unit === 'hour' ? amount * 3600 : amount * 86400;
    fireTime = Math.floor(Date.now() / 1000) + seconds;
  } else {
    fireTime = Math.floor(new Date(time).getTime() / 1000);
    if (isNaN(fireTime)) return { success: false, error: 'Invalid time format. Use ISO date or "in X minutes/hours/days"' };
  }

  // Resolve target member
  let targetId: string | null = null;
  if (target_member) {
    const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${target_member}%`) as { id: string } | undefined;
    targetId = member?.id || null;
  }

  const id = `rem_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
  db.prepare(`
    INSERT INTO scheduled_reminders (id, type, message, next_fire_time, target_member_id, source_type)
    VALUES (?, ?, ?, ?, ?, 'manual')
  `).run(id, type, message, fireTime, targetId);

  const timeStr = new Date(fireTime * 1000).toLocaleString();
  return { success: true, data: { id }, message: `Reminder set for ${timeStr}: ${message}` };
});

registerTool('get_family', 'List all family members', () => {
  const members = db.prepare('SELECT id, name, role, age, birthday FROM family_members ORDER BY role, name').all();
  return { success: true, data: { members } };
});

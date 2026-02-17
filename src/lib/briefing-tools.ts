/**
 * Morning Briefing Tool
 * Generates a daily briefing combining weather + calendar + tasks + grocery + reminders.
 * Can be triggered on-demand via get_briefing tool or by scheduled background job.
 */

import { db, getSetting } from './db';
import { registerTool, executeTool } from './tool-executor';

interface BriefingData {
  greeting: string;
  weather: string | null;
  traffic: string | null;
  calendar: string[];
  tasks: string[];
  grocery_count: number;
  reminders: string[];
  summary: string;
}

function getTimeOfDay(): 'morning' | 'afternoon' | 'evening' {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

export async function generateBriefing(): Promise<BriefingData> {
  const now = Math.floor(Date.now() / 1000);
  const dayStart = now - (now % 86400);
  const dayEnd = dayStart + 86400;
  const timeOfDay = getTimeOfDay();

  // 1. Greeting
  const greeting = `Good ${timeOfDay}!`;

  // 2. Weather (try via tool, gracefully handle failure)
  let weather: string | null = null;
  try {
    const weatherResult = await executeTool('get_weather', {});
    if (weatherResult.success && weatherResult.message) {
      weather = weatherResult.message;
    }
  } catch {}

  // 2b. Traffic (only if Google Maps API key is configured)
  let traffic: string | null = null;
  const hasGoogleMaps = process.env.GOOGLE_MAPS_API_KEY || getSetting('google_maps_api_key');
  const hasWorkLocation = getSetting('work_location');
  if (hasGoogleMaps && hasWorkLocation) {
    try {
      const trafficResult = await executeTool('get_traffic', {});
      if (trafficResult.success && trafficResult.message) {
        traffic = trafficResult.message;
      }
    } catch {}
  }

  // 3. Calendar events for today
  const calendar: string[] = [];
  try {
    const events = db.prepare(`
      SELECT title, start_time, end_time, location FROM calendar_events
      WHERE start_time BETWEEN ? AND ?
      ORDER BY start_time ASC LIMIT 10
    `).all(dayStart, dayEnd) as Array<{ title: string; start_time: number; end_time: number; location: string }>;

    for (const e of events) {
      const start = new Date(e.start_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const end = new Date(e.end_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      calendar.push(`${start}-${end}: ${e.title}${e.location ? ` @ ${e.location}` : ''}`);
    }
  } catch {}

  // 4. Pending tasks (urgent + high priority first)
  const tasks: string[] = [];
  try {
    const pendingTasks = db.prepare(`
      SELECT title, priority, due_date FROM tasks
      WHERE status = 'pending'
      ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
        due_date ASC NULLS LAST
      LIMIT 5
    `).all() as Array<{ title: string; priority: string; due_date: number | null }>;

    for (const t of pendingTasks) {
      const due = t.due_date ? ` (due: ${new Date(t.due_date * 1000).toLocaleDateString()})` : '';
      tasks.push(`[${t.priority}] ${t.title}${due}`);
    }
  } catch {}

  // 5. Grocery count
  let grocery_count = 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM grocery_items WHERE completed = 0').get() as { count: number };
    grocery_count = row.count;
  } catch {}

  // 6. Upcoming reminders (next 24 hours)
  const reminders: string[] = [];
  try {
    const upcoming = db.prepare(`
      SELECT message, next_fire_time FROM scheduled_reminders
      WHERE is_active = 1 AND delivery_status = 'pending'
        AND next_fire_time BETWEEN ? AND ?
      ORDER BY next_fire_time ASC LIMIT 5
    `).all(now, dayEnd) as Array<{ message: string; next_fire_time: number }>;

    for (const r of upcoming) {
      const time = new Date(r.next_fire_time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      reminders.push(`${time}: ${r.message}`);
    }
  } catch {}

  // 7. Build summary
  const parts: string[] = [greeting];

  if (weather) parts.push(`Weather: ${weather}`);
  if (traffic) parts.push(`Commute: ${traffic}`);

  if (calendar.length > 0) {
    parts.push(`You have ${calendar.length} event${calendar.length > 1 ? 's' : ''} today:`);
    calendar.forEach(e => parts.push(`  - ${e}`));
  } else {
    parts.push('No events scheduled today.');
  }

  if (tasks.length > 0) {
    parts.push(`${tasks.length} pending task${tasks.length > 1 ? 's' : ''}:`);
    tasks.forEach(t => parts.push(`  - ${t}`));
  }

  if (grocery_count > 0) {
    parts.push(`${grocery_count} item${grocery_count > 1 ? 's' : ''} on your grocery list.`);
  }

  if (reminders.length > 0) {
    parts.push(`Upcoming reminders:`);
    reminders.forEach(r => parts.push(`  - ${r}`));
  }

  return {
    greeting,
    weather,
    traffic,
    calendar,
    tasks,
    grocery_count,
    reminders,
    summary: parts.join('\n'),
  };
}

// ─── Register get_briefing tool ───

registerTool('get_briefing', 'Get a daily briefing with weather, calendar, tasks, and grocery list. Use for "morning briefing", "what\'s my day look like", "daily summary".', async () => {
  try {
    const briefing = await generateBriefing();
    return { success: true, data: briefing, message: briefing.summary };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Briefing generation failed' };
  }
});

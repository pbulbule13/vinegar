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
  meals: string[];
  chores: string[];
  birthdays: string[];
  spending: { unpaid_count: number; unpaid_total: number } | null;
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

  // 7. Today's meal plans
  const meals: string[] = [];
  try {
    const today = new Date().toISOString().split('T')[0];
    const mealPlans = db.prepare('SELECT meal_type, recipe FROM meal_plans WHERE date = ? ORDER BY meal_type').all(today) as Array<{ meal_type: string; recipe: string }>;
    for (const m of mealPlans) meals.push(`${m.meal_type}: ${m.recipe}`);
  } catch {}

  // 8. Pending chores
  const chores: string[] = [];
  try {
    const pendingChores = db.prepare(`
      SELECT t.title, f.name as assigned_to FROM tasks t
      LEFT JOIN family_members f ON t.assigned_to = f.id
      WHERE t.category = 'chore' AND t.status = 'pending'
      ORDER BY t.created_at ASC LIMIT 5
    `).all() as Array<{ title: string; assigned_to: string | null }>;
    for (const c of pendingChores) chores.push(`${c.title}${c.assigned_to ? ` (${c.assigned_to})` : ''}`);
  } catch {}

  // 9. Upcoming birthdays (next 30 days)
  const birthdays: string[] = [];
  try {
    const members = db.prepare('SELECT name, birthday FROM family_members WHERE birthday IS NOT NULL').all() as Array<{ name: string; birthday: string }>;
    const today = new Date();
    for (const m of members) {
      const [, mm, dd] = m.birthday.split('-').map(Number);
      const bday = new Date(today.getFullYear(), mm - 1, dd);
      if (bday < today) bday.setFullYear(today.getFullYear() + 1);
      const daysUntil = Math.ceil((bday.getTime() - today.getTime()) / 86400000);
      if (daysUntil >= 0 && daysUntil <= 30) {
        birthdays.push(daysUntil === 0 ? `${m.name}'s birthday is TODAY!` : `${m.name}'s birthday in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`);
      }
    }
    // Also check special_dates
    const specials = db.prepare('SELECT title, date FROM special_dates').all() as Array<{ title: string; date: string }>;
    for (const s of specials) {
      const [, mm, dd] = s.date.split('-').map(Number);
      const sDate = new Date(today.getFullYear(), mm - 1, dd);
      if (sDate < today) sDate.setFullYear(today.getFullYear() + 1);
      const daysUntil = Math.ceil((sDate.getTime() - today.getTime()) / 86400000);
      if (daysUntil >= 0 && daysUntil <= 14) {
        birthdays.push(daysUntil === 0 ? `${s.title} is TODAY!` : `${s.title} in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`);
      }
    }
  } catch {}

  // 10. Spending snapshot (unpaid bills)
  let spending: BriefingData['spending'] = null;
  try {
    const unpaid = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM budget_items
      WHERE type IN ('bill', 'subscription') AND is_paid = 0
    `).get() as { count: number; total: number };
    if (unpaid.count > 0) spending = { unpaid_count: unpaid.count, unpaid_total: unpaid.total };
  } catch {}

  // 11. Build summary
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

  if (meals.length > 0) {
    parts.push(`Today's meals:`);
    meals.forEach(m => parts.push(`  - ${m}`));
  }

  if (chores.length > 0) {
    parts.push(`Pending chores:`);
    chores.forEach(c => parts.push(`  - ${c}`));
  }

  if (birthdays.length > 0) {
    birthdays.forEach(b => parts.push(`🎂 ${b}`));
  }

  if (spending) {
    parts.push(`Bills: ${spending.unpaid_count} unpaid ($${spending.unpaid_total.toFixed(2)})`);
  }

  return {
    greeting,
    weather,
    traffic,
    calendar,
    tasks,
    grocery_count,
    reminders,
    meals,
    chores,
    birthdays,
    spending,
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

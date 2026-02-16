/**
 * Proactive Suggestion Engine
 * Analyzes usage patterns and context to generate helpful suggestions.
 * Runs as a background job every 30 minutes.
 */

import { db, generateId } from './db';

export interface Suggestion {
  id: string;
  type: 'reminder' | 'task' | 'grocery' | 'weather' | 'calendar' | 'habit';
  message: string;
  priority: 'high' | 'medium' | 'low';
  action?: string; // Tool call to execute if user accepts
  created_at: number;
}

// Store suggestions in memory (they're ephemeral, not DB-worthy)
const activeSuggestions: Suggestion[] = [];
const MAX_SUGGESTIONS = 10;

export function getActiveSuggestions(): Suggestion[] {
  return activeSuggestions.filter(s => {
    // Expire after 2 hours
    return Date.now() / 1000 - s.created_at < 7200;
  });
}

export function dismissSuggestion(id: string): void {
  const idx = activeSuggestions.findIndex(s => s.id === id);
  if (idx >= 0) activeSuggestions.splice(idx, 1);
}

function addSuggestion(type: Suggestion['type'], message: string, priority: Suggestion['priority'], action?: string): void {
  // Don't duplicate
  if (activeSuggestions.some(s => s.message === message)) return;

  // Evict oldest if at capacity
  if (activeSuggestions.length >= MAX_SUGGESTIONS) {
    activeSuggestions.shift();
  }

  activeSuggestions.push({
    id: generateId('sug'),
    type,
    message,
    priority,
    action,
    created_at: Math.floor(Date.now() / 1000),
  });
}

// ─── Suggestion Generators ───

function checkOverdueTasks(): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    const overdue = db.prepare(`
      SELECT title, due_date FROM tasks
      WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < ?
      LIMIT 5
    `).all(now) as Array<{ title: string; due_date: number }>;

    for (const t of overdue) {
      const daysOverdue = Math.floor((now - t.due_date) / 86400);
      addSuggestion('task', `Task "${t.title}" is ${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue.`, 'high');
    }
  } catch {}
}

function checkUpcomingEvents(): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    const twoHours = now + 7200;

    const upcoming = db.prepare(`
      SELECT title, start_time, location FROM calendar_events
      WHERE start_time BETWEEN ? AND ?
      ORDER BY start_time ASC LIMIT 3
    `).all(now, twoHours) as Array<{ title: string; start_time: number; location: string }>;

    for (const e of upcoming) {
      const minsUntil = Math.round((e.start_time - now) / 60);
      if (minsUntil > 0 && minsUntil <= 120) {
        addSuggestion(
          'calendar',
          `"${e.title}" starts in ${minsUntil} minutes${e.location ? ` at ${e.location}` : ''}.`,
          minsUntil <= 30 ? 'high' : 'medium'
        );
      }
    }
  } catch {}
}

function checkGroceryAfterMealPlan(): void {
  try {
    const today = new Date().toISOString().split('T')[0];
    const meals = db.prepare('SELECT recipe, ingredients FROM meal_plans WHERE date = ?').all(today) as Array<{ recipe: string; ingredients: string }>;

    if (meals.length > 0) {
      const groceryCount = (db.prepare('SELECT COUNT(*) as count FROM grocery_items WHERE completed = 0').get() as { count: number }).count;
      if (groceryCount === 0) {
        addSuggestion('grocery', `You have meals planned but your grocery list is empty. Want me to add ingredients?`, 'medium');
      }
    }
  } catch {}
}

function checkPendingChores(): void {
  try {
    const pendingChores = db.prepare(`
      SELECT c.title, f.name as assigned_to FROM chores c
      LEFT JOIN family_members f ON c.assigned_to = f.id
      WHERE c.status = 'pending' AND c.created_at < unixepoch() - 86400
      LIMIT 3
    `).all() as Array<{ title: string; assigned_to: string }>;

    for (const c of pendingChores) {
      addSuggestion('reminder', `Chore "${c.title}"${c.assigned_to ? ` for ${c.assigned_to}` : ''} is still pending.`, 'low');
    }
  } catch {}
}

function checkWeatherAlerts(): void {
  // Only suggest weather check if user hasn't checked in a while
  try {
    const now = Math.floor(Date.now() / 1000);
    const hour = new Date().getHours();

    // Suggest morning weather check between 6-9 AM
    if (hour >= 6 && hour <= 9) {
      const recentWeatherUse = db.prepare(`
        SELECT COUNT(*) as count FROM usage_logs
        WHERE source = 'text' AND created_at > ? AND model != 'offline'
      `).get(now - 3600) as { count: number };

      // Only suggest if user has been active but hasn't checked weather
      if (recentWeatherUse.count > 0) {
        const recentConversations = db.prepare(`
          SELECT content FROM conversation_logs
          WHERE role = 'user' AND created_at > ? AND content LIKE '%weather%'
          LIMIT 1
        `).all(now - 14400);

        if (recentConversations.length === 0) {
          addSuggestion('weather', 'Good morning! Want me to check the weather for today?', 'low');
        }
      }
    }
  } catch {}
}

// ─── Main scan function (called by background worker) ───

export function scanForSuggestions(): void {
  checkOverdueTasks();
  checkUpcomingEvents();
  checkGroceryAfterMealPlan();
  checkPendingChores();
  checkWeatherAlerts();
}

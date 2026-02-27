/**
 * Proactive Suggestion Engine
 * Analyzes usage patterns and context to generate helpful suggestions.
 * Runs as a background job every 30 minutes.
 * Tracks dismissals per-user to avoid repeating unhelpful suggestions.
 */

import { db, generateId } from './db';

export interface Suggestion {
  id: string;
  type: 'reminder' | 'task' | 'grocery' | 'weather' | 'calendar' | 'habit' | 'homework' | 'routine';
  message: string;
  priority: 'high' | 'medium' | 'low';
  action?: string; // Tool call to execute if user accepts
  created_at: number;
}

// Store suggestions in memory (they're ephemeral, not DB-worthy)
const activeSuggestions: Suggestion[] = [];
const MAX_SUGGESTIONS = 10;

// Cache recently dismissed message patterns to avoid DB round-trips
let dismissedPatternsCache: Set<string> | null = null;
let dismissedCacheTimestamp = 0;
const DISMISSED_CACHE_TTL = 5 * 60 * 1000; // 5 min

function getDismissedPatterns(): Set<string> {
  const now = Date.now();
  if (dismissedPatternsCache && now - dismissedCacheTimestamp < DISMISSED_CACHE_TTL) {
    return dismissedPatternsCache;
  }
  try {
    // Load dismissals from last 7 days
    const sevenDaysAgo = Math.floor(now / 1000) - (7 * 86400);
    const rows = db.prepare('SELECT suggestion_message FROM dismissed_suggestions WHERE dismissed_at > ? LIMIT 200').all(sevenDaysAgo) as Array<{ suggestion_message: string }>;
    dismissedPatternsCache = new Set(rows.map(r => r.suggestion_message));
    dismissedCacheTimestamp = now;
  } catch {
    dismissedPatternsCache = new Set();
    dismissedCacheTimestamp = now;
  }
  return dismissedPatternsCache;
}

export function getActiveSuggestions(): Suggestion[] {
  return activeSuggestions.filter(s => {
    // Expire after 2 hours
    return Date.now() / 1000 - s.created_at < 7200;
  });
}

export function dismissSuggestion(id: string): void {
  const suggestion = activeSuggestions.find(s => s.id === id);
  if (suggestion) {
    // Track dismissal in DB for learning
    try {
      const activeMember = db.prepare("SELECT id FROM family_members WHERE is_active = 1 LIMIT 1").get() as { id: string } | undefined;
      db.prepare('INSERT INTO dismissed_suggestions (id, suggestion_type, suggestion_message, family_member_id) VALUES (?, ?, ?, ?)').run(
        generateId('dis'), suggestion.type, suggestion.message, activeMember?.id || null
      );
      // Invalidate cache
      dismissedPatternsCache = null;
    } catch {}
  }
  const idx = activeSuggestions.findIndex(s => s.id === id);
  if (idx >= 0) activeSuggestions.splice(idx, 1);
}

function addSuggestion(type: Suggestion['type'], message: string, priority: Suggestion['priority'], action?: string): void {
  // Don't duplicate
  if (activeSuggestions.some(s => s.message === message)) return;

  // Don't show previously dismissed suggestions
  const dismissed = getDismissedPatterns();
  if (dismissed.has(message)) return;

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
      SELECT t.title, f.name as assigned_to FROM tasks t
      LEFT JOIN family_members f ON t.assigned_to = f.id
      WHERE t.category = 'chore' AND t.status = 'pending'
        AND t.created_at < unixepoch() - 86400
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

function checkUpcomingBills(): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    const threeDays = now + (3 * 86400);

    const bills = db.prepare(`
      SELECT name, amount, due_date FROM budget_items
      WHERE is_paid = 0 AND type IN ('bill', 'subscription')
        AND due_date IS NOT NULL AND due_date BETWEEN ? AND ?
      LIMIT 3
    `).all(now, threeDays) as Array<{ name: string; amount: number; due_date: number }>;

    for (const b of bills) {
      const daysUntil = Math.ceil((b.due_date - now) / 86400);
      addSuggestion(
        'reminder',
        `Bill "${b.name}" ($${b.amount}) is due in ${daysUntil} day${daysUntil > 1 ? 's' : ''}.`,
        daysUntil <= 1 ? 'high' : 'medium'
      );
    }
  } catch {}
}

function checkHomeworkDue(): void {
  try {
    const now = Math.floor(Date.now() / 1000);
    const twoDays = now + (2 * 86400);

    const assignments = db.prepare(`
      SELECT a.title, a.subject, a.due_date, f.name as child_name FROM assignments a
      LEFT JOIN family_members f ON a.child_id = f.id
      WHERE a.status = 'pending' AND a.due_date IS NOT NULL AND a.due_date BETWEEN ? AND ?
      LIMIT 5
    `).all(now, twoDays) as Array<{ title: string; subject: string; due_date: number; child_name: string }>;

    for (const a of assignments) {
      const daysUntil = Math.ceil((a.due_date - now) / 86400);
      const urgency = daysUntil <= 1 ? 'high' : 'medium';
      addSuggestion('homework', `${a.child_name}'s ${a.subject} assignment "${a.title}" is due ${daysUntil === 0 ? 'today' : `in ${daysUntil} day${daysUntil > 1 ? 's' : ''}`}.`, urgency);
    }
  } catch {}
}

function checkRoutineTime(): void {
  try {
    const hour = new Date().getHours();
    const minute = new Date().getMinutes();
    const currentTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

    // Check for routines that should trigger around this time (±30 min)
    const routines = db.prepare('SELECT name, type, trigger_time FROM routines WHERE is_active = 1 AND trigger_time IS NOT NULL').all() as Array<{ name: string; type: string; trigger_time: string }>;

    for (const r of routines) {
      const [rh, rm] = r.trigger_time.split(':').map(Number);
      const routineMin = rh * 60 + rm;
      const currentMin = hour * 60 + minute;
      if (Math.abs(routineMin - currentMin) <= 30) {
        addSuggestion('routine', `Time for your ${r.type} routine "${r.name}". Want me to run it?`, 'medium', `manage_routine({action:"run",name:"${r.name}"})`);
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
  checkUpcomingBills();
  checkHomeworkDue();
  checkRoutineTime();
}

/**
 * Recipe AI + Budget Tracking Tools
 * - suggest_recipe: AI-powered recipe suggestions from grocery list + preferences
 * - manage_budget: Bill reminders, subscriptions, expense tracking
 */

import { db, generateId } from './db';
import { registerTool } from './tool-executor';

// ─── Recipe Suggestion Tool ───

registerTool('suggest_recipe', 'Suggest recipes based on available groceries, dietary preferences, and meal history. Use when asked "what should I cook", "suggest a recipe", "what can I make".', (args) => {
  const { dietary_restrictions, cuisine, meal_type = 'dinner', servings = 4 } = args as {
    dietary_restrictions?: string; cuisine?: string; meal_type?: string; servings?: number;
  };

  // Get current grocery items
  let groceryItems: string[] = [];
  try {
    const items = db.prepare('SELECT item FROM grocery_items WHERE completed = 0').all() as { item: string }[];
    groceryItems = items.map(i => i.item);
  } catch {}

  // Get recent meal history (avoid repeats)
  let recentMeals: string[] = [];
  try {
    const meals = db.prepare(`
      SELECT recipe FROM meal_plans
      WHERE date >= date('now', '-7 days')
      ORDER BY date DESC LIMIT 10
    `).all() as { recipe: string }[];
    recentMeals = meals.map(m => m.recipe);
  } catch {}

  // Get saved dietary preferences from memory
  let preferences: string[] = [];
  try {
    const mems = db.prepare(`
      SELECT content FROM memories
      WHERE (tags LIKE '%dietary%' OR tags LIKE '%food%' OR tags LIKE '%allergy%')
      AND importance IN ('high', 'medium')
      LIMIT 5
    `).all() as { content: string }[];
    preferences = mems.map(m => m.content);
  } catch {}

  // Build suggestion context for LLM
  const context = {
    available_ingredients: groceryItems.length > 0 ? groceryItems : ['No grocery list - suggest common recipes'],
    recent_meals_to_avoid: recentMeals,
    dietary_preferences: [
      ...(dietary_restrictions ? [dietary_restrictions] : []),
      ...preferences,
    ],
    cuisine_preference: cuisine || 'any',
    meal_type,
    servings,
  };

  return {
    success: true,
    data: context,
    message: `Based on your ${groceryItems.length} grocery items${dietary_restrictions ? ` (${dietary_restrictions})` : ''}, here's what I can suggest for ${meal_type} (${servings} servings). ${recentMeals.length > 0 ? `Avoiding repeats of: ${recentMeals.slice(0, 3).join(', ')}.` : ''} Please ask the LLM to generate specific recipes from these ingredients.`,
  };
});

// ─── Budget Tracking Tool ───

registerTool('manage_budget', 'Track bills, subscriptions, expenses, and income. Use for "add a bill", "track subscription", "list expenses", "budget summary".', (args) => {
  const { action = 'summary', name, amount, category, type = 'expense', frequency, due_date, notes, id } = args as {
    action?: string; name?: string; amount?: number; category?: string; type?: string;
    frequency?: string; due_date?: string; notes?: string; id?: string;
  };

  switch (action) {
    case 'add': {
      if (!name || amount === undefined) return { success: false, error: 'name and amount required' };
      const validTypes = ['bill', 'subscription', 'expense', 'income'];
      const itemType = validTypes.includes(type) ? type : 'expense';
      const validFreqs = ['one_time', 'weekly', 'monthly', 'yearly'];
      const itemFreq = frequency && validFreqs.includes(frequency) ? frequency : 'monthly';

      let dueTs: number | null = null;
      if (due_date) {
        dueTs = Math.floor(new Date(due_date).getTime() / 1000);
        if (isNaN(dueTs)) return { success: false, error: 'Invalid due_date format' };
      }

      const itemId = generateId('bud');
      db.prepare(`
        INSERT INTO budget_items (id, type, name, amount, category, frequency, due_date, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
      `).run(itemId, itemType, name, amount, category || null, itemFreq, dueTs, notes || null);

      // Auto-create reminder for bills/subscriptions
      if ((itemType === 'bill' || itemType === 'subscription') && dueTs) {
        const remId = generateId('rem');
        db.prepare(`
          INSERT INTO scheduled_reminders (id, type, message, next_fire_time, source_type, source_id)
          VALUES (?, ?, ?, ?, 'budget', ?)
        `).run(remId, itemFreq === 'one_time' ? 'one_time' : 'monthly', `Bill due: ${name} ($${amount})`, dueTs - 86400, itemId);
      }

      return { success: true, data: { id: itemId }, message: `Added ${itemType}: ${name} ($${amount}${itemFreq !== 'one_time' ? `/${itemFreq}` : ''})` };
    }

    case 'paid': {
      if (!id && !name) return { success: false, error: 'id or name required to mark as paid' };
      const item = id
        ? db.prepare('SELECT id, name, amount FROM budget_items WHERE id = ?').get(id)
        : db.prepare('SELECT id, name, amount FROM budget_items WHERE name LIKE ? AND is_paid = 0').get(`%${name}%`);

      if (!item) return { success: false, error: `Budget item not found: ${name || id}` };
      const budgetItem = item as { id: string; name: string; amount: number };

      db.prepare('UPDATE budget_items SET is_paid = 1, updated_at = unixepoch() WHERE id = ?').run(budgetItem.id);
      return { success: true, message: `Marked "${budgetItem.name}" ($${budgetItem.amount}) as paid` };
    }

    case 'list': {
      const filterType = type && ['bill', 'subscription', 'expense', 'income'].includes(type) ? type : null;
      const items = filterType
        ? db.prepare('SELECT id, type, name, amount, category, frequency, due_date, is_paid FROM budget_items WHERE type = ? ORDER BY due_date ASC NULLS LAST LIMIT 20').all(filterType)
        : db.prepare('SELECT id, type, name, amount, category, frequency, due_date, is_paid FROM budget_items ORDER BY due_date ASC NULLS LAST LIMIT 20').all();

      return { success: true, data: { count: (items as unknown[]).length, items } };
    }

    case 'upcoming': {
      const now = Math.floor(Date.now() / 1000);
      const thirtyDays = now + (30 * 86400);
      const upcoming = db.prepare(`
        SELECT id, type, name, amount, due_date FROM budget_items
        WHERE is_paid = 0 AND due_date IS NOT NULL AND due_date BETWEEN ? AND ?
        ORDER BY due_date ASC LIMIT 10
      `).all(now, thirtyDays) as Array<{ id: string; type: string; name: string; amount: number; due_date: number }>;

      const total = upcoming.reduce((sum, b) => sum + b.amount, 0);
      const summary = upcoming.map(b => {
        const due = new Date(b.due_date * 1000).toLocaleDateString();
        return `${b.name}: $${b.amount} (due ${due})`;
      }).join('\n');

      return {
        success: true,
        data: { count: upcoming.length, total, items: upcoming },
        message: `${upcoming.length} upcoming bills/expenses totaling $${total.toFixed(2)}:\n${summary}`,
      };
    }

    case 'delete': {
      if (!id && !name) return { success: false, error: 'id or name required' };
      if (id) {
        db.prepare('DELETE FROM budget_items WHERE id = ?').run(id);
      } else {
        db.prepare('DELETE FROM budget_items WHERE name LIKE ?').run(`%${name}%`);
      }
      return { success: true, message: `Deleted budget item: ${name || id}` };
    }

    case 'summary':
    default: {
      const now = Math.floor(Date.now() / 1000);
      const monthStart = now - (now % (30 * 86400));

      const income = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM budget_items
        WHERE type = 'income' AND created_at >= ?
      `).get(monthStart) as { total: number };

      const expenses = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total FROM budget_items
        WHERE type IN ('expense', 'bill', 'subscription') AND created_at >= ?
      `).get(monthStart) as { total: number };

      const unpaidBills = db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM budget_items
        WHERE type IN ('bill', 'subscription') AND is_paid = 0
      `).get() as { count: number; total: number };

      const byCategory = db.prepare(`
        SELECT category, SUM(amount) as total FROM budget_items
        WHERE type IN ('expense', 'bill', 'subscription') AND created_at >= ?
        GROUP BY category ORDER BY total DESC LIMIT 5
      `).all(monthStart) as Array<{ category: string; total: number }>;

      return {
        success: true,
        data: {
          monthly_income: income.total,
          monthly_expenses: expenses.total,
          net: income.total - expenses.total,
          unpaid_bills: { count: unpaidBills.count, total: unpaidBills.total },
          top_categories: byCategory,
        },
        message: `Budget Summary:\nIncome: $${income.total.toFixed(2)}\nExpenses: $${expenses.total.toFixed(2)}\nNet: $${(income.total - expenses.total).toFixed(2)}\nUnpaid bills: ${unpaidBills.count} ($${unpaidBills.total.toFixed(2)})`,
      };
    }
  }
});

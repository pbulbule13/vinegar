/**
 * Phase 3 Tool Registrations
 * Grocery, meals, activities, chores, skills tools.
 */

import { db, generateId } from './db';
import { registerTool } from './tool-executor';

// ─── Grocery Tool ───

registerTool('manage_grocery', 'Add, remove, complete, or list grocery items', (args) => {
  const { action = 'list', item, quantity, unit, category, id } = args as {
    action?: string; item?: string; quantity?: number; unit?: string; category?: string; id?: string;
  };

  switch (action) {
    case 'add': {
      if (!item) return { success: false, error: 'item required' };
      const normalized = item.toLowerCase().trim();

      const existing = db.prepare('SELECT id, quantity FROM grocery_items WHERE LOWER(item) LIKE ? AND completed = 0')
        .get(`%${normalized}%`) as { id: string; quantity: number } | undefined;

      if (existing) {
        const newQty = existing.quantity + (quantity || 1);
        db.prepare('UPDATE grocery_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
        return { success: true, message: `Updated ${item} quantity to ${newQty}` };
      }

      const newId = generateId('groc');
      db.prepare('INSERT INTO grocery_items (id, item, quantity, unit, category) VALUES (?, ?, ?, ?, ?)')
        .run(newId, item, quantity || 1, unit || null, category || 'other');
      return { success: true, data: { id: newId }, message: `Added ${item} to grocery list` };
    }
    case 'complete': {
      if (item) {
        db.prepare('UPDATE grocery_items SET completed = 1, completed_at = unixepoch() WHERE item LIKE ? AND completed = 0').run(`%${item}%`);
      } else if (id) {
        db.prepare('UPDATE grocery_items SET completed = 1, completed_at = unixepoch() WHERE id = ?').run(id);
      }
      return { success: true, message: `Marked ${item || id} as done` };
    }
    case 'remove': {
      if (id) db.prepare('DELETE FROM grocery_items WHERE id = ?').run(id);
      else if (item) db.prepare('DELETE FROM grocery_items WHERE item LIKE ?').run(`%${item}%`);
      return { success: true, message: 'Removed from grocery list' };
    }
    case 'clear_completed': {
      db.prepare('DELETE FROM grocery_items WHERE completed = 1').run();
      return { success: true, message: 'Cleared completed items' };
    }
    case 'list':
    default: {
      const items = db.prepare('SELECT item, quantity, unit, category, completed FROM grocery_items WHERE completed = 0 ORDER BY category, item').all();
      return { success: true, data: { count: (items as unknown[]).length, items } };
    }
  }
});

// ─── Meals Tool ───

registerTool('manage_meals', 'Plan meals for specific dates', (args) => {
  const { action = 'list', date, meal_type, recipe, ingredients } = args as {
    action?: string; date?: string; meal_type?: string; recipe?: string; ingredients?: string[];
  };

  switch (action) {
    case 'plan': {
      if (!date || !meal_type || !recipe) return { success: false, error: 'date, meal_type, and recipe required' };

      const existing = db.prepare('SELECT id FROM meal_plans WHERE date = ? AND meal_type = ?').get(date, meal_type) as { id: string } | undefined;
      if (existing) {
        db.prepare('UPDATE meal_plans SET recipe = ?, ingredients = ? WHERE id = ?')
          .run(recipe, ingredients ? JSON.stringify(ingredients) : null, existing.id);
        return { success: true, message: `Updated ${meal_type} for ${date}: ${recipe}` };
      }

      const id = generateId('meal');
      db.prepare('INSERT INTO meal_plans (id, date, meal_type, recipe, ingredients) VALUES (?, ?, ?, ?, ?)')
        .run(id, date, meal_type, recipe, ingredients ? JSON.stringify(ingredients) : null);
      return { success: true, data: { id }, message: `Planned ${meal_type} for ${date}: ${recipe}` };
    }
    case 'get': {
      if (!date) return { success: false, error: 'date required' };
      const meals = db.prepare('SELECT meal_type, recipe, ingredients FROM meal_plans WHERE date = ?').all(date);
      return { success: true, data: { date, meals } };
    }
    case 'list':
    default: {
      const today = new Date().toISOString().split('T')[0];
      const weekEnd = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
      const meals = db.prepare('SELECT date, meal_type, recipe FROM meal_plans WHERE date BETWEEN ? AND ? ORDER BY date, meal_type').all(today, weekEnd);
      return { success: true, data: { meals } };
    }
  }
});

// ─── Activity Tool ───

registerTool('manage_activity', 'Manage kids\' recurring activities', (args) => {
  const { action = 'list', title, child_name, day_of_week, start_time, end_time, location } = args as {
    action?: string; title?: string; child_name?: string; day_of_week?: number[]; start_time?: string; end_time?: string; location?: string;
  };

  switch (action) {
    case 'create': {
      if (!title || !child_name) return { success: false, error: 'title and child_name required' };

      const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ? AND role = ?').get(`%${child_name}%`, 'child') as { id: string } | undefined;
      if (!member) return { success: false, error: `Child "${child_name}" not found` };

      // Create 4 weeks of events
      let eventsCreated = 0;
      const days = day_of_week || [1]; // Default Monday
      const now = new Date();

      for (let week = 0; week < 4; week++) {
        for (const day of days) {
          const eventDate = new Date(now);
          const currentDay = eventDate.getDay();
          const daysUntil = ((day - currentDay + 7) % 7) + (week * 7);
          eventDate.setDate(eventDate.getDate() + daysUntil);
          if (eventDate < now && week === 0) continue;

          const [sh, sm] = (start_time || '16:00').split(':').map(Number);
          const [eh, em] = (end_time || '17:00').split(':').map(Number);
          const startTs = new Date(eventDate); startTs.setHours(sh, sm, 0, 0);
          const endTs = new Date(eventDate); endTs.setHours(eh, em, 0, 0);

          db.prepare(`INSERT INTO calendar_events (id, title, start_time, end_time, location, family_member_id, source, recurring) VALUES (?, ?, ?, ?, ?, ?, 'skill', ?)`)
            .run(generateId('act'), title, Math.floor(startTs.getTime() / 1000), Math.floor(endTs.getTime() / 1000), location || null, member.id, JSON.stringify({ day_of_week: days }));
          eventsCreated++;
        }
      }

      return { success: true, message: `Activity "${title}" for ${child_name} created with ${eventsCreated} events` };
    }
    case 'get_today': {
      const now = Math.floor(Date.now() / 1000);
      const dayStart = now - (now % 86400);
      const dayEnd = dayStart + 86400;

      let query = "SELECT ce.title, ce.start_time, ce.end_time, ce.location, fm.name FROM calendar_events ce LEFT JOIN family_members fm ON ce.family_member_id = fm.id WHERE ce.start_time BETWEEN ? AND ?";
      const params: unknown[] = [dayStart, dayEnd];

      if (child_name) {
        const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${child_name}%`) as { id: string } | undefined;
        if (member) { query += ' AND ce.family_member_id = ?'; params.push(member.id); }
      }

      const activities = db.prepare(query + ' ORDER BY ce.start_time').all(...params);
      return { success: true, data: { activities } };
    }
    case 'list':
    default: {
      const activities = db.prepare("SELECT DISTINCT title, recurring, family_member_id FROM calendar_events WHERE source = 'skill' AND recurring IS NOT NULL").all();
      return { success: true, data: { activities } };
    }
  }
});

// ─── Chore Tool ───

registerTool('manage_chore', 'Assign and track chores for family members', (args) => {
  const { action = 'list', title, assigned_to, points = 1, id } = args as {
    action?: string; title?: string; assigned_to?: string; points?: number; id?: string;
  };

  switch (action) {
    case 'create': {
      if (!title) return { success: false, error: 'title required' };

      let memberId: string | null = null;
      if (assigned_to) {
        const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${assigned_to}%`) as { id: string } | undefined;
        memberId = member?.id || null;
      }

      const choreId = generateId('chore');
      db.prepare("INSERT INTO tasks (id, title, status, priority, assigned_to, category, points, created_at, updated_at) VALUES (?, ?, 'pending', 'medium', ?, 'chore', ?, unixepoch(), unixepoch())")
        .run(choreId, title, memberId, points);
      return { success: true, data: { id: choreId }, message: `Chore "${title}" created${assigned_to ? ` for ${assigned_to}` : ''}` };
    }
    case 'complete': {
      const chore = id
        ? db.prepare("SELECT id, title, points FROM tasks WHERE id = ? AND category = 'chore'").get(id)
        : title ? db.prepare("SELECT id, title, points FROM tasks WHERE title LIKE ? AND category = 'chore' AND status = 'pending'").get(`%${title}%`) : null;

      if (!chore) return { success: false, error: 'Chore not found' };

      db.prepare("UPDATE tasks SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?")
        .run((chore as Record<string, unknown>).id);
      return { success: true, message: `Chore completed! +${(chore as Record<string, unknown>).points} points!` };
    }
    case 'list':
    default: {
      const chores = db.prepare("SELECT t.id, t.title, t.status, t.points, fm.name as assigned_to FROM tasks t LEFT JOIN family_members fm ON t.assigned_to = fm.id WHERE t.category = 'chore' AND t.status = 'pending'").all();
      return { success: true, data: { chores } };
    }
  }
});

// ─── Skill Management Tool ───

registerTool('manage_skill', 'Create and manage custom skills', (args) => {
  const { action = 'list', name, description, type, trigger_phrases, url, schedule, id } = args as {
    action?: string; name?: string; description?: string; type?: string; trigger_phrases?: string[];
    url?: string; schedule?: string; id?: string;
  };

  switch (action) {
    case 'create': {
      if (!name || !description || !type || !trigger_phrases) {
        return { success: false, error: 'name, description, type, and trigger_phrases required' };
      }

      const config: Record<string, unknown> = {};
      if (url) {
        if (type === 'web_scraper') config.url = url;
        else if (type === 'api_caller') config.endpoint = url;
      }

      const skillId = generateId('skill');
      db.prepare('INSERT INTO skills (id, name, description, type, trigger_phrases, config, schedule) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(skillId, name, description, type, JSON.stringify(trigger_phrases), JSON.stringify(config), schedule || null);

      return { success: true, data: { id: skillId }, message: `Skill "${name}" created! Say any of: ${trigger_phrases.join(', ')}` };
    }
    case 'delete': {
      if (!id && !name) return { success: false, error: 'id or name required' };
      if (id) {
        db.prepare('DELETE FROM skills WHERE id = ?').run(id);
      } else if (name) {
        db.prepare('DELETE FROM skills WHERE name LIKE ?').run(`%${name}%`);
      }
      return { success: true, message: 'Skill deleted' };
    }
    case 'list':
    default: {
      const skills = db.prepare('SELECT id, name, description, type, is_active, use_count FROM skills ORDER BY use_count DESC').all();
      return { success: true, data: { skills } };
    }
  }
});

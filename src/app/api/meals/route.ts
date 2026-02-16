import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { mealPlanSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('start');
    const endDate = searchParams.get('end');

    let query = 'SELECT * FROM meal_plans WHERE 1=1';
    const params: unknown[] = [];

    if (date) {
      query += ' AND date = ?';
      params.push(date);
    } else if (startDate && endDate) {
      query += ' AND date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else {
      // Default: this week
      const today = new Date();
      const weekStart = new Date(today.setDate(today.getDate() - today.getDay())).toISOString().split('T')[0];
      const weekEnd = new Date(today.setDate(today.getDate() + 6)).toISOString().split('T')[0];
      query += ' AND date BETWEEN ? AND ?';
      params.push(weekStart, weekEnd);
    }

    query += ' ORDER BY date, CASE meal_type WHEN \'breakfast\' THEN 1 WHEN \'lunch\' THEN 2 WHEN \'dinner\' THEN 3 WHEN \'snack\' THEN 4 END';

    const meals = db.prepare(query).all(...params);
    return NextResponse.json({ meals });
  } catch {
    return NextResponse.json({ meals: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = mealPlanSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { date, meal_type, recipe, ingredients, notes } = parsed.data;
    const id = generateId('meal');

    // Check if meal already planned for this date+type
    const existing = db.prepare('SELECT id FROM meal_plans WHERE date = ? AND meal_type = ?').get(date, meal_type) as { id: string } | undefined;
    if (existing) {
      db.prepare('UPDATE meal_plans SET recipe = ?, ingredients = ?, notes = ? WHERE id = ?')
        .run(recipe, ingredients ? JSON.stringify(ingredients) : null, notes || null, existing.id);
      return NextResponse.json({ success: true, id: existing.id, message: `Updated ${meal_type} for ${date}` });
    }

    db.prepare('INSERT INTO meal_plans (id, date, meal_type, recipe, ingredients, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, date, meal_type, recipe, ingredients ? JSON.stringify(ingredients) : null, notes || null);

    // Auto-add ingredients to grocery list if specified
    if (ingredients && ingredients.length > 0) {
      const insertGrocery = db.prepare('INSERT OR IGNORE INTO grocery_items (id, item, category) VALUES (?, ?, ?)');
      for (const ingredient of ingredients) {
        const exists = db.prepare('SELECT id FROM grocery_items WHERE LOWER(item) LIKE ? AND completed = 0').get(`%${ingredient.toLowerCase()}%`);
        if (!exists) {
          insertGrocery.run(generateId('groc'), ingredient, 'other');
        }
      }
    }

    return NextResponse.json({ success: true, id, message: `Planned ${recipe} for ${meal_type} on ${date}` });
  } catch {
    return NextResponse.json({ error: 'Failed to manage meal plan' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    db.prepare('DELETE FROM meal_plans WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete meal' }, { status: 500 });
  }
}

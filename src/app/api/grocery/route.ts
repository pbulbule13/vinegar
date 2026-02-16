import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { groceryActionSchema } from "@/lib/validators";

// Category auto-detection
const CATEGORY_MAP: Record<string, string> = {
  milk: 'dairy', cheese: 'dairy', yogurt: 'dairy', butter: 'dairy', cream: 'dairy',
  apple: 'produce', banana: 'produce', lettuce: 'produce', tomato: 'produce', onion: 'produce', potato: 'produce', carrot: 'produce', broccoli: 'produce',
  bread: 'bakery', bagel: 'bakery', muffin: 'bakery', cake: 'bakery',
  chicken: 'meat', beef: 'meat', pork: 'meat', fish: 'seafood', shrimp: 'seafood', salmon: 'seafood',
  rice: 'grains', pasta: 'grains', cereal: 'grains', oats: 'grains',
  juice: 'beverages', soda: 'beverages', water: 'beverages', coffee: 'beverages', tea: 'beverages',
  chips: 'snacks', cookies: 'snacks', crackers: 'snacks',
  soap: 'household', paper: 'household', detergent: 'household', trash: 'household',
};

function detectCategory(item: string): string {
  const lower = item.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lower.includes(keyword)) return category;
  }
  return 'other';
}

function normalizeItem(item: string): string {
  return item.toLowerCase().trim().replace(/s$/, ''); // Basic singularize
}

export async function GET() {
  try {
    const items = db.prepare('SELECT * FROM grocery_items ORDER BY completed ASC, category ASC, created_at DESC').all();
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = groceryActionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { action, item, quantity, unit, category, id } = parsed.data;

    switch (action) {
      case 'add': {
        if (!item) return NextResponse.json({ error: 'item required' }, { status: 400 });
        const normalized = normalizeItem(item);

        // Dedup: check for existing item
        const existing = db.prepare('SELECT id, quantity FROM grocery_items WHERE LOWER(item) LIKE ? AND completed = 0').get(`%${normalized}%`) as { id: string; quantity: number } | undefined;
        if (existing) {
          const newQty = existing.quantity + (quantity || 1);
          db.prepare('UPDATE grocery_items SET quantity = ? WHERE id = ?').run(newQty, existing.id);
          return NextResponse.json({ success: true, message: `Updated ${item} quantity to ${newQty}` });
        }

        const newId = generateId('groc');
        const autoCategory = category || detectCategory(item);
        db.prepare('INSERT INTO grocery_items (id, item, quantity, unit, category) VALUES (?, ?, ?, ?, ?)')
          .run(newId, item, quantity || 1, unit || null, autoCategory);
        return NextResponse.json({ success: true, id: newId, message: `Added ${item} to grocery list` });
      }
      case 'complete': {
        if (id) {
          db.prepare('UPDATE grocery_items SET completed = 1, completed_at = unixepoch() WHERE id = ?').run(id);
        } else if (item) {
          db.prepare('UPDATE grocery_items SET completed = 1, completed_at = unixepoch() WHERE item LIKE ?').run(`%${item}%`);
        }
        return NextResponse.json({ success: true, message: `Marked ${item || id} as done` });
      }
      case 'remove': {
        if (id) {
          db.prepare('DELETE FROM grocery_items WHERE id = ?').run(id);
        } else if (item) {
          db.prepare('DELETE FROM grocery_items WHERE item LIKE ?').run(`%${item}%`);
        }
        return NextResponse.json({ success: true });
      }
      case 'list': {
        const items = db.prepare('SELECT * FROM grocery_items WHERE completed = 0 ORDER BY category, item').all();
        return NextResponse.json({ success: true, data: { count: (items as unknown[]).length, items } });
      }
      case 'clear_completed': {
        db.prepare('DELETE FROM grocery_items WHERE completed = 1').run();
        return NextResponse.json({ success: true, message: 'Cleared completed items' });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Failed to manage grocery list' }, { status: 500 });
  }
}

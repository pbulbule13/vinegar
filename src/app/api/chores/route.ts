import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { choreSchema } from "@/lib/validators";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const assignedTo = searchParams.get('assigned_to');
    const status = searchParams.get('status');

    // Chores are stored in tasks table with category='chore'
    let query = "SELECT t.*, fm.name as assigned_name FROM tasks t LEFT JOIN family_members fm ON t.assigned_to = fm.id WHERE t.category = 'chore'";
    const params: unknown[] = [];

    if (assignedTo) { query += ' AND t.assigned_to = ?'; params.push(assignedTo); }
    if (status) { query += ' AND t.status = ?'; params.push(status); }

    query += ' ORDER BY t.created_at DESC';
    const chores = db.prepare(query).all(...params);

    // Get points summary per member
    const pointsSummary = db.prepare(`
      SELECT fm.name, fm.id, COALESCE(SUM(t.points), 0) as total_points
      FROM family_members fm
      LEFT JOIN tasks t ON t.assigned_to = fm.id AND t.category = 'chore' AND t.status = 'completed'
      GROUP BY fm.id
      ORDER BY total_points DESC
    `).all();

    return NextResponse.json({ chores, pointsSummary });
  } catch {
    return NextResponse.json({ chores: [], pointsSummary: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = choreSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }
    const { action, title, assigned_to, points = 1, id, recurring } = { ...parsed.data, recurring: body.recurring };

    switch (action) {
      case 'create': {
        if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 });

        // Resolve member name to ID
        let memberId: string | null = assigned_to || null;
        if (assigned_to && !assigned_to.startsWith('fam_')) {
          const member = db.prepare('SELECT id FROM family_members WHERE name LIKE ?').get(`%${assigned_to}%`) as { id: string } | undefined;
          memberId = member?.id || null;
        }

        const choreId = generateId('chore');
        db.prepare(`
          INSERT INTO tasks (id, title, status, priority, assigned_to, category, points, recurring, created_at, updated_at)
          VALUES (?, ?, 'pending', 'medium', ?, 'chore', ?, ?, unixepoch(), unixepoch())
        `).run(choreId, title, memberId || null, points, recurring || null);

        return NextResponse.json({ success: true, id: choreId, message: `Chore "${title}" assigned${memberId ? '' : ' (no assignee)'}` });
      }
      case 'complete': {
        if (!id && !title) return NextResponse.json({ error: 'id or title required' }, { status: 400 });

        const chore = id
          ? db.prepare("SELECT id, title, points FROM tasks WHERE id = ? AND category = 'chore'").get(id)
          : db.prepare("SELECT id, title, points FROM tasks WHERE title LIKE ? AND category = 'chore' AND status = 'pending'").get(`%${title}%`);

        if (!chore) return NextResponse.json({ error: 'Chore not found' }, { status: 404 });

        db.prepare("UPDATE tasks SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?")
          .run((chore as Record<string, unknown>).id);

        return NextResponse.json({
          success: true,
          message: `Chore "${(chore as Record<string, unknown>).title}" completed! +${(chore as Record<string, unknown>).points} points!`,
          points: (chore as Record<string, unknown>).points,
        });
      }
      case 'approve': {
        if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
        // Parent verification - just mark as verified for now
        db.prepare("UPDATE tasks SET status = 'completed', completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").run(id);
        return NextResponse.json({ success: true, message: 'Chore approved!' });
      }
      case 'list':
      default: {
        const chores = db.prepare("SELECT id, title, status, assigned_to, points FROM tasks WHERE category = 'chore' AND status = 'pending' ORDER BY created_at DESC").all();
        return NextResponse.json({ success: true, data: { count: (chores as unknown[]).length, chores } });
      }
    }
  } catch {
    return NextResponse.json({ error: 'Failed to manage chore' }, { status: 500 });
  }
}

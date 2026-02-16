import { NextResponse } from "next/server";
import { db, generateId, getSetting, setSetting } from "@/lib/db";
import { familyMemberSchema, familyMemberUpdateSchema } from "@/lib/validators";
import bcrypt from "bcryptjs";

export async function GET() {
  try {
    const members = db.prepare('SELECT id, name, role, age, birthday, dietary_restrictions, preferences, created_at FROM family_members ORDER BY role, name').all();
    const activeId = getSetting('active_family_member');

    return NextResponse.json({
      members: (members as Record<string, unknown>[]).map(m => ({
        ...m,
        dietary_restrictions: m.dietary_restrictions ? JSON.parse(m.dietary_restrictions as string) : [],
        preferences: m.preferences ? JSON.parse(m.preferences as string) : {},
        isActive: m.id === activeId,
      })),
      activeId,
    });
  } catch {
    return NextResponse.json({ members: [], activeId: null });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Switch active member
    if (body.action === 'switch') {
      const memberId = body.member_id;
      if (!memberId) {
        setSetting('active_family_member', '');
        return NextResponse.json({ success: true, message: 'No active member' });
      }
      const member = db.prepare('SELECT id, name, role FROM family_members WHERE id = ?').get(memberId);
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      // If parent with PIN, verify using bcrypt
      if (body.pin && (member as Record<string, unknown>).role === 'parent') {
        const stored = db.prepare('SELECT pin_hash FROM family_members WHERE id = ?').get(memberId) as { pin_hash: string | null };
        if (stored?.pin_hash) {
          const isValid = await bcrypt.compare(String(body.pin), stored.pin_hash);
          if (!isValid) {
            return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
          }
        }
      }

      setSetting('active_family_member', memberId);
      return NextResponse.json({ success: true, member, message: `Switched to ${(member as Record<string, unknown>).name}` });
    }

    // Create new member
    const parsed = familyMemberSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { name, role, age, birthday, pin, dietary_restrictions, preferences } = parsed.data;
    const id = generateId('fam');

    db.prepare(`
      INSERT INTO family_members (id, name, role, age, birthday, pin_hash, dietary_restrictions, preferences)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, name, role, age || null, birthday || null,
      pin ? bcrypt.hashSync(pin, 10) : null,
      dietary_restrictions ? JSON.stringify(dietary_restrictions) : null,
      preferences ? JSON.stringify(preferences) : null
    );

    // If this is the first member, set as active
    const count = (db.prepare('SELECT COUNT(*) as c FROM family_members').get() as { c: number }).c;
    if (count === 1) {
      setSetting('active_family_member', id);
    }

    return NextResponse.json({ success: true, id, message: `Added ${name} to the family!` });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to manage family' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const parsed = familyMemberUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { id, ...updates } = parsed.data;

    const setClauses: string[] = [];
    const values: unknown[] = [];

    if (updates.name) { setClauses.push('name = ?'); values.push(updates.name); }
    if (updates.age !== undefined) { setClauses.push('age = ?'); values.push(updates.age); }
    if (updates.birthday) { setClauses.push('birthday = ?'); values.push(updates.birthday); }
    if (updates.dietary_restrictions) { setClauses.push('dietary_restrictions = ?'); values.push(JSON.stringify(updates.dietary_restrictions)); }
    if (updates.preferences) { setClauses.push('preferences = ?'); values.push(JSON.stringify(updates.preferences)); }

    if (setClauses.length === 0) return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    setClauses.push('updated_at = unixepoch()');
    values.push(id);

    db.prepare(`UPDATE family_members SET ${setClauses.join(', ')} WHERE id = ?`).run(...values);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to update member' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    db.prepare('DELETE FROM family_members WHERE id = ?').run(id);

    // Clear active if this was active
    if (getSetting('active_family_member') === id) {
      setSetting('active_family_member', '');
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { db, generateId, getSetting, setSetting } from "@/lib/db";
import { familyMemberSchema, familyMemberUpdateSchema } from "@/lib/validators";
import bcrypt from "bcryptjs";
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const members = db.prepare('SELECT id, name, role, age, birthday, dietary_restrictions, preferences, voice_profile, is_active, preferred_language, preferred_tts_speed, preferred_voice, created_at FROM family_members ORDER BY role, name').all();
    const activeId = getSetting('active_family_member');

    return NextResponse.json({
      members: (members as Record<string, unknown>[]).map(m => ({
        ...m,
        dietary_restrictions: m.dietary_restrictions ? JSON.parse(m.dietary_restrictions as string) : [],
        preferences: m.preferences ? JSON.parse(m.preferences as string) : {},
        isActive: m.id === activeId,
        voiceEnrolled: !!m.voice_profile,
        preferred_language: m.preferred_language || 'en-US',
        preferred_tts_speed: m.preferred_tts_speed ?? 1.2,
        preferred_voice: m.preferred_voice || null,
        voice_profile: undefined, // Don't send raw embedding to client list
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
        db.transaction(() => {
          db.prepare('UPDATE family_members SET is_active = 0').run();
          setSetting('active_family_member', '');
        })();
        return NextResponse.json({ success: true, message: 'No active member' });
      }
      const member = db.prepare('SELECT id, name, role FROM family_members WHERE id = ?').get(memberId);
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      // If member has a PIN set, require and verify it
      const stored = db.prepare('SELECT pin_hash FROM family_members WHERE id = ?').get(memberId) as { pin_hash: string | null };
      if (stored?.pin_hash) {
        if (!body.pin) {
          return NextResponse.json({ error: 'PIN required' }, { status: 401 });
        }
        const isValid = await bcrypt.compare(String(body.pin), stored.pin_hash);
        if (!isValid) {
          return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
        }
      }

      // Update BOTH settings AND is_active column in a single transaction
      db.transaction(() => {
        db.prepare('UPDATE family_members SET is_active = 0').run();
        db.prepare('UPDATE family_members SET is_active = 1 WHERE id = ?').run(memberId);
        setSetting('active_family_member', memberId);
      })();
      return NextResponse.json({ success: true, member, message: `Switched to ${(member as Record<string, unknown>).name}` });
    }

    // Enroll voice profile (save voiceprint to SQLite)
    if (body.action === 'enroll_voice') {
      const { member_id, embedding, consent_timestamp } = body;
      if (!member_id || !embedding || !Array.isArray(embedding) || embedding.length !== 16) {
        return NextResponse.json({ error: 'Invalid voice enrollment data' }, { status: 400 });
      }
      if (!consent_timestamp) {
        return NextResponse.json({ error: 'Biometric consent required' }, { status: 400 });
      }

      const member = db.prepare('SELECT id, name FROM family_members WHERE id = ?').get(member_id);
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      const profile = JSON.stringify({
        embedding,
        enrolledAt: Math.floor(Date.now() / 1000),
        consentTimestamp: consent_timestamp,
      });

      db.prepare('UPDATE family_members SET voice_profile = ?, updated_at = unixepoch() WHERE id = ?')
        .run(profile, member_id);

      return NextResponse.json({
        success: true,
        message: `Voice profile saved for ${(member as Record<string, unknown>).name}`,
      });
    }

    // Delete voice profile
    if (body.action === 'delete_voice') {
      const { member_id } = body;
      if (!member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

      db.prepare('UPDATE family_members SET voice_profile = NULL, updated_at = unixepoch() WHERE id = ?')
        .run(member_id);

      return NextResponse.json({ success: true, message: 'Voice profile deleted' });
    }

    // Voice-based switch (no PIN required, limited permissions)
    if (body.action === 'voice_switch') {
      const { member_id } = body;
      if (!member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

      const member = db.prepare('SELECT id, name, role FROM family_members WHERE id = ?').get(member_id);
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      // Voice switch bypasses PIN (used for personalization + child safety only)
      db.transaction(() => {
        db.prepare('UPDATE family_members SET is_active = 0').run();
        db.prepare('UPDATE family_members SET is_active = 1 WHERE id = ?').run(member_id);
        setSetting('active_family_member', member_id);
      })();

      return NextResponse.json({
        success: true,
        member,
        message: `Voice-switched to ${(member as Record<string, unknown>).name}`,
      });
    }

    // Update per-user preferences (language, TTS speed, voice)
    if (body.action === 'update_preferences') {
      const { member_id, preferred_language, preferred_tts_speed, preferred_voice } = body;
      if (!member_id) return NextResponse.json({ error: 'member_id required' }, { status: 400 });

      const member = db.prepare('SELECT id, name FROM family_members WHERE id = ?').get(member_id);
      if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 });

      const updates: string[] = [];
      const values: unknown[] = [];
      if (preferred_language) { updates.push('preferred_language = ?'); values.push(preferred_language); }
      if (preferred_tts_speed !== undefined) {
        const speed = Math.max(0.5, Math.min(3.0, Number(preferred_tts_speed)));
        updates.push('preferred_tts_speed = ?'); values.push(speed);
      }
      if (preferred_voice !== undefined) { updates.push('preferred_voice = ?'); values.push(preferred_voice || null); }

      if (updates.length === 0) return NextResponse.json({ error: 'No preferences to update' }, { status: 400 });
      updates.push('updated_at = unixepoch()');
      values.push(member_id);

      db.prepare(`UPDATE family_members SET ${updates.join(', ')} WHERE id = ?`).run(...values);
      return NextResponse.json({
        success: true,
        message: `Updated preferences for ${(member as Record<string, unknown>).name}`,
      });
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
      db.prepare('UPDATE family_members SET is_active = 1 WHERE id = ?').run(id);
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
      db.prepare('UPDATE family_members SET is_active = 0').run();
      setSetting('active_family_member', '');
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete member' }, { status: 500 });
  }
}

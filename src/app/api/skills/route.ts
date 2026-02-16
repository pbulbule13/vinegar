import { NextResponse } from "next/server";
import { db, generateId } from "@/lib/db";
import { skillSchema } from "@/lib/validators";

export async function GET() {
  try {
    const skills = db.prepare('SELECT * FROM skills ORDER BY use_count DESC, created_at DESC').all();
    return NextResponse.json({
      skills: (skills as Record<string, unknown>[]).map(s => ({
        ...s,
        trigger_phrases: JSON.parse(s.trigger_phrases as string),
        config: JSON.parse(s.config as string),
      })),
    });
  } catch {
    return NextResponse.json({ skills: [] });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Test skill action
    if (body.action === 'test') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      const skill = db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as Record<string, unknown> | undefined;
      if (!skill) return NextResponse.json({ error: 'Skill not found' }, { status: 404 });

      const config = JSON.parse(skill.config as string);
      try {
        if (skill.type === 'web_scraper' || skill.type === 'api_caller') {
          const url = config.url || config.endpoint;
          if (!url) return NextResponse.json({ error: 'No URL configured' }, { status: 400 });

          // SSRF protection: block internal/private URLs
          try {
            const parsedUrl = new URL(url);
            const hostname = parsedUrl.hostname.toLowerCase();
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' ||
                hostname.startsWith('10.') || hostname.startsWith('172.') || hostname.startsWith('192.168.') ||
                hostname === '169.254.169.254') {
              return NextResponse.json({ error: 'URL blocked: cannot access local/private addresses' }, { status: 400 });
            }
          } catch {
            return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
          }

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 10000);
          try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeout);
            const text = await res.text();
            return NextResponse.json({ success: true, result: text.substring(0, 2000), status: res.status });
          } catch (err) {
            clearTimeout(timeout);
            return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
          }
        }
        return NextResponse.json({ success: true, message: 'Skill type does not support direct testing' });
      } catch (err) {
        return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Test failed' });
      }
    }

    // Toggle active
    if (body.action === 'toggle') {
      const { id } = body;
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      db.prepare('UPDATE skills SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END, updated_at = unixepoch() WHERE id = ?').run(id);
      return NextResponse.json({ success: true });
    }

    // Create new skill
    const parsed = skillSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid input', details: parsed.error.issues }, { status: 400 });
    }

    const { name, description, type, trigger_phrases, config, schedule } = parsed.data;
    const id = generateId('skill');

    // Security: validate data_lookup queries at creation time
    if (type === 'data_lookup' && config?.query) {
      const queryStr = String(config.query).trim().toUpperCase();
      if (!queryStr.startsWith('SELECT')) {
        return NextResponse.json({ error: 'Data lookup skills only support SELECT queries' }, { status: 400 });
      }
      if (/\b(DROP|DELETE|INSERT|UPDATE|ALTER|CREATE|ATTACH|DETACH|PRAGMA)\b/i.test(String(config.query))) {
        return NextResponse.json({ error: 'Data lookup queries cannot contain data-modifying statements' }, { status: 400 });
      }
    }

    db.prepare(`
      INSERT INTO skills (id, name, description, type, trigger_phrases, config, schedule)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, description, type, JSON.stringify(trigger_phrases), JSON.stringify(config), schedule || null);

    return NextResponse.json({ success: true, id, message: `Skill "${name}" created!` });
  } catch {
    return NextResponse.json({ error: 'Failed to manage skill' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    db.prepare('DELETE FROM skills WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete skill' }, { status: 500 });
  }
}

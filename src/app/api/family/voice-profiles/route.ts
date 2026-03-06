/**
 * Voice Profiles API
 * Returns family members with their voice embeddings for client-side speaker identification.
 * Only returns members who have enrolled voice profiles.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const members = db.prepare(
      'SELECT id, name, role, voice_profile FROM family_members WHERE voice_profile IS NOT NULL'
    ).all() as { id: string; name: string; role: string; voice_profile: string }[];

    return NextResponse.json({
      members: members.map(m => ({
        id: m.id,
        name: m.name,
        role: m.role,
        voice_profile: JSON.parse(m.voice_profile),
      })),
    });
  } catch {
    return NextResponse.json({ members: [] });
  }
}

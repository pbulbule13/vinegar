/**
 * Consolidated Settings API
 * Returns all settings in a single request to reduce client round-trips.
 * Settings modal makes 1 call instead of 4.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSetting, db } from "@/lib/db";

export const dynamic = 'force-dynamic';

const TTS_KEYS = ["tts_language", "tts_speed", "tts_pitch", "tts_voice", "stt_language"] as const;
const LOCATION_KEYS = ["home_location", "work_location", "home_zip", "weather_city"] as const;

export async function GET() {
  try {
    const cookieStore = await cookies();

    // API key status
    const hasOpenAIKey = !!cookieStore.get("openai_api_key")?.value;
    const hasOpenAIEnvKey = !!process.env.OPENAI_API_KEY;
    const hasEuriKey = !!cookieStore.get("euri_api_key")?.value;
    const hasEuriEnvKey = !!process.env.EURI_API_KEY;

    // TTS settings
    const tts: Record<string, string> = {};
    for (const key of TTS_KEYS) {
      tts[key] = getSetting(key) || "";
    }

    // Location settings
    const location: Record<string, string> = {};
    for (const key of LOCATION_KEYS) {
      location[key] = getSetting(key) || "";
    }

    // Family members (for voice profiles)
    let familyMembers: Array<{ id: string; name: string; role: string; voiceEnrolled: boolean }> = [];
    try {
      const members = db.prepare('SELECT id, name, role, voice_profile FROM family_members ORDER BY role, name').all() as Array<{
        id: string; name: string; role: string; voice_profile: string | null;
      }>;
      familyMembers = members.map(m => ({
        id: m.id,
        name: m.name,
        role: m.role,
        voiceEnrolled: !!m.voice_profile,
      }));
    } catch {}

    return NextResponse.json({
      keys: {
        hasUserKey: hasOpenAIKey,
        hasEnvKey: hasOpenAIEnvKey,
        keySource: hasOpenAIKey ? "user" : hasOpenAIEnvKey ? "server" : "none",
        euri: {
          hasUserKey: hasEuriKey,
          hasEnvKey: hasEuriEnvKey,
          keySource: hasEuriKey ? "user" : hasEuriEnvKey ? "server" : "none",
        },
      },
      tts,
      location,
      familyMembers,
    });
  } catch (err) {
    console.error('[API /settings/all]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

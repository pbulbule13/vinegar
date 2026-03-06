import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
export const dynamic = 'force-dynamic';

const TTS_KEYS = ["tts_language", "tts_speed", "tts_pitch", "tts_voice", "stt_language"] as const;

const VALID_LANGUAGES = ["en-US", "en-IN", "hi-IN", "mr-IN", "en-GB", "en-AU"];

export async function GET() {
  const result: Record<string, string> = {};
  for (const key of TTS_KEYS) {
    result[key] = getSetting(key) || "";
  }
  return NextResponse.json(result);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    for (const key of TTS_KEYS) {
      if (key in body && typeof body[key] === "string") {
        const value = body[key].trim();

        // Validate language values
        if ((key === "tts_language" || key === "stt_language") && value && !VALID_LANGUAGES.includes(value)) {
          return NextResponse.json({ error: "Invalid language value" }, { status: 400 });
        }

        // Validate speed/pitch range
        if (key === "tts_speed" || key === "tts_pitch") {
          const num = parseFloat(value);
          if (value && (isNaN(num) || num < 0.5 || num > 2.0)) {
            return NextResponse.json({ error: `${key} must be between 0.5 and 2.0` }, { status: 400 });
          }
        }

        // Validate voice name length (prevent oversized storage)
        if (key === "tts_voice" && value.length > 200) {
          return NextResponse.json({ error: "Voice name too long" }, { status: 400 });
        }

        setSetting(key, value);
      }
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Failed to save TTS settings" }, { status: 500 });
  }
}

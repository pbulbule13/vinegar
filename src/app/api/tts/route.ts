import { NextResponse } from "next/server";
import { sanitizeForExternal } from "@/lib/pii-redactor";
import { splitIntoChunks, cleanForSpeech } from "@/lib/tts-utils";

/**
 * TTS endpoint - FALLBACK ONLY. Primary TTS is client-side SpeechSynthesis.
 * Used when browser has no voices (e.g., some Android WebViews).
 * PII is redacted before sending to Google Translate TTS.
 */
export async function POST(request: Request) {
  try {
    const { text, lang = "en", speed = 1 } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    // Clean text for TTS using shared utility
    let cleanText = cleanForSpeech(text, 500);

    if (!cleanText) {
      return NextResponse.json({ error: "No speakable text" }, { status: 400 });
    }

    // Strip PII entirely before sending to external TTS service (privacy protection)
    cleanText = sanitizeForExternal(cleanText);

    // Validate language parameter (only safe values)
    const validLangs = ["en", "hi", "mr", "en-IN", "hi-IN", "mr-IN"];
    const ttsLang = validLangs.includes(lang) ? lang.split("-")[0] : "en";
    const ttsSpeed = Math.max(0.5, Math.min(2.0, Number(speed) || 1));

    // Split into chunks of ~190 chars at sentence boundaries
    const chunks = splitIntoChunks(cleanText, 190);

    // Fetch audio for all chunks in parallel (reduces latency from N*avg to ~1*avg)
    const chunkResults = await Promise.allSettled(
      chunks.map(async (chunk, index) => {
        const encoded = encodeURIComponent(chunk);
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${ttsLang}&client=tw-ob&q=${encoded}&ttsspeed=${ttsSpeed}`;
        const controller = new AbortController();
        const chunkTimeout = setTimeout(() => controller.abort(), 5000);
        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Referer": "https://translate.google.com/",
            },
          });
          clearTimeout(chunkTimeout);
          if (!response.ok) return { index, buffer: null };
          return { index, buffer: await response.arrayBuffer() };
        } catch {
          clearTimeout(chunkTimeout);
          return { index, buffer: null };
        }
      })
    );

    // Collect successful results in original order
    const audioBuffers: ArrayBuffer[] = chunkResults
      .map(r => r.status === 'fulfilled' ? r.value : null)
      .filter((r): r is { index: number; buffer: ArrayBuffer } => r !== null && r.buffer !== null)
      .sort((a, b) => a.index - b.index)
      .map(r => r.buffer);

    if (audioBuffers.length === 0) {
      return NextResponse.json({ error: "TTS generation failed" }, { status: 500 });
    }

    // Concatenate all audio chunks
    const totalLength = audioBuffers.reduce((sum, buf) => sum + buf.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of audioBuffers) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }

    return new Response(combined.buffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(totalLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}

// splitIntoChunks imported from @/lib/tts-utils

import { NextResponse } from "next/server";

/**
 * TTS endpoint - converts text to speech audio
 * Uses Google TTS with proper chunking for long text
 */
export async function POST(request: Request) {
  try {
    const { text } = await request.json();
    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    // Clean text for TTS - remove markdown, special chars
    let cleanText = text
      .replace(/```[\s\S]*?```/g, " code block ")  // code blocks
      .replace(/\*\*([^*]+)\*\*/g, "$1")            // bold
      .replace(/\*([^*]+)\*/g, "$1")                 // italic
      .replace(/#+\s/g, "")                           // headers
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")       // links
      .replace(/[`~|>]/g, "")                         // misc markdown
      .replace(/\n+/g, ". ")                           // newlines to pauses
      .replace(/\s+/g, " ")                            // collapse whitespace
      .trim()
      .slice(0, 500);                                  // limit length

    if (!cleanText) {
      return NextResponse.json({ error: "No speakable text" }, { status: 400 });
    }

    // Split into chunks of ~190 chars at sentence boundaries
    const chunks = splitIntoChunks(cleanText, 190);

    // Fetch audio for each chunk
    const audioBuffers: ArrayBuffer[] = [];
    for (const chunk of chunks) {
      const encoded = encodeURIComponent(chunk);
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=${encoded}&ttsspeed=1`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://translate.google.com/",
        },
      });

      if (!response.ok) {
        console.error(`[TTS] Chunk failed (${response.status}): "${chunk.substring(0, 50)}..."`);
        continue;
      }

      audioBuffers.push(await response.arrayBuffer());
    }

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
  } catch (err) {
    console.error("[TTS] Error:", err);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point
    let breakAt = remaining.lastIndexOf(". ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = remaining.lastIndexOf(", ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.4) breakAt = maxLen;

    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }

  return chunks.filter(c => c.length > 0);
}

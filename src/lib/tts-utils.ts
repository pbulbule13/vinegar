/**
 * Shared TTS Text Processing Utilities
 * Used by both client-side useClientTTS hook and server-side /api/tts route.
 * Deduplicates splitIntoChunks and cleanForSpeech.
 */

/**
 * Split long text into chunks at sentence boundaries.
 * Avoids Chrome's long-text pause bug and Google Translate's URL limit.
 */
export function splitIntoChunks(text: string, maxLen: number = 150): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }

    // Find a good break point (sentence > comma > space > forced)
    let breakAt = remaining.lastIndexOf(". ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(", ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;

    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Clean text for speech synthesis by removing markdown and special characters.
 * @param maxLength Maximum output length (default 1500 for client, 500 for server)
 */
export function cleanForSpeech(text: string, maxLength: number = 1500): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")  // code blocks
    .replace(/\*\*([^*]+)\*\*/g, "$1")            // bold
    .replace(/\*([^*]+)\*/g, "$1")                 // italic
    .replace(/#+\s/g, "")                           // headers
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")       // links
    .replace(/[`~|>]/g, "")                         // misc markdown
    .replace(/\n+/g, ". ")                           // newlines to pauses
    .replace(/\s+/g, " ")                            // collapse whitespace
    .trim()
    .slice(0, maxLength);
}

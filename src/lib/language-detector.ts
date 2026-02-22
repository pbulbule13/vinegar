/**
 * Auto Language Detector for Vinegar
 *
 * Dual-signal detection pipeline:
 *   Signal 1: Unicode script detection (Devanagari vs Latin)
 *   Signal 2: English dictionary check (catches Latin-transliterated Hindi/Marathi)
 *
 * 3-layer Hindi/Marathi distinction:
 *   Layer 1: Marathi-exclusive ळ character → instant Marathi
 *   Layer 2: Function word markers (pronouns, verbs, postpositions)
 *   Layer 3: Suffix patterns (-ला vs -को)
 *
 * Zero dependencies. Sub-ms execution. Pre-compiled regex.
 */

import type { SupportedLanguage, DetectionResult } from "@/types/language";

// ─── Pre-compiled regex at module level ───

const DEVANAGARI_RE = /\p{Script=Devanagari}/u;
const MARATHI_EXCLUSIVE_RE = /ळ/;

// ─── Marathi markers (function words, pronouns, verbs) ───

const MARATHI_MARKERS = new Set([
  // Pronouns
  "मी", "तू", "तो", "ती", "ते", "आम्ही", "तुम्ही", "त्यांनी",
  // Verbs / copula
  "आहे", "आहेत", "नाही", "होते", "होती", "असतो", "असते",
  // Common words
  "काय", "मला", "तुला", "सांग", "करतो", "करते", "झालं", "बोल",
  "ये", "जा", "करा", "आणि", "पण", "कारण", "म्हणून",
  "असं", "तसं", "हे",
  // Postpositions
  "ला", "ने", "चा", "ची", "चे", "साठी", "मध्ये", "वर", "खाली",
]);

// ─── Hindi markers ───

const HINDI_MARKERS = new Set([
  // Pronouns
  "मैं", "तुम", "आप", "वह", "यह", "हम", "वे", "उन्होंने",
  // Verbs / copula
  "है", "हैं", "नहीं", "था", "थी", "थे", "होता", "होती",
  // Common words
  "क्या", "मुझे", "बताओ", "करो", "मेरा", "मेरी", "कैसा", "कैसी",
  "और", "लेकिन", "क्योंकि", "इसलिए", "ऐसा", "वैसा",
  // Postpositions
  "को", "का", "की", "के", "से", "में", "पर", "लिए",
]);

// ─── Top 200 common English words for dictionary check ───

const COMMON_ENGLISH = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
  "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
  "this", "but", "his", "by", "from", "they", "we", "say", "her", "she",
  "or", "an", "will", "my", "one", "all", "would", "there", "their", "what",
  "so", "up", "out", "if", "about", "who", "get", "which", "go", "me",
  "when", "make", "can", "like", "time", "no", "just", "him", "know", "take",
  "people", "into", "year", "your", "good", "some", "could", "them", "see", "other",
  "than", "then", "now", "look", "only", "come", "its", "over", "think", "also",
  "back", "after", "use", "two", "how", "our", "work", "first", "well", "way",
  "even", "new", "want", "because", "any", "these", "give", "day", "most", "us",
  "is", "are", "was", "were", "been", "being", "has", "had", "did", "does",
  "am", "may", "should", "must", "shall", "might", "need", "let", "here", "too",
  "very", "much", "more", "many", "still", "right", "why", "where", "yes", "please",
  "thank", "thanks", "sorry", "sure", "great", "nice", "hello", "hi", "hey", "okay",
  "ok", "yes", "no", "yeah", "yep", "nope", "nah", "oh", "hmm", "um",
  "tell", "help", "show", "set", "add", "put", "find", "call", "ask", "try",
  "play", "run", "move", "live", "start", "stop", "open", "close", "turn", "keep",
  "thing", "home", "house", "water", "food", "today", "tomorrow", "morning", "night", "weather",
  "what's", "don't", "can't", "won't", "it's", "i'm", "you're", "that's", "let's", "how's",
  "going", "doing", "have", "really", "every", "before", "already", "never", "always", "again",
]);

// ─── Transliteration phonetic patterns (consonant clusters uncommon in English) ───

const TRANSLITERATION_PATTERNS = /(?:kya|kaise|accha|theek|acha|bahut|nahin|abhi|yahan|wahan|kahan|kaisa|kab|kyun|kyon|matlab|samajh|bata|chal|dekh|sun|bol|khana|pani|ghar|naam|kaam|din|raat|subah|sham|bhai|didi|maa|papa|beta|beti|dost|log|sala|arey|arre|haan|nahi|bilkul|zaroor|bohot)\b/i;

// ─── Main Detection Functions ───

function detectScript(text: string): "devanagari" | "latin" | "mixed" | "unknown" {
  const hasDevanagari = DEVANAGARI_RE.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);

  if (hasDevanagari && hasLatin) return "mixed";
  if (hasDevanagari) return "devanagari";
  if (hasLatin) return "latin";
  return "unknown";
}

function distinguishHindiMarathi(text: string): SupportedLanguage {
  // Layer 1: Marathi-exclusive ळ character → instant Marathi
  if (MARATHI_EXCLUSIVE_RE.test(text)) return "mr-IN";

  // Layer 2: Function word marker counting
  const words = text.split(/\s+/);
  let marathiScore = 0;
  let hindiScore = 0;

  for (const word of words) {
    if (MARATHI_MARKERS.has(word)) marathiScore++;
    if (HINDI_MARKERS.has(word)) hindiScore++;
  }

  // Layer 3: Suffix patterns
  // Marathi suffixes: -ला (-lā), -ची (-chī), -चे (-che), -चा (-chā)
  // Hindi suffixes: -को (-ko), -की (-kī), -के (-ke), -का (-kā)
  for (const word of words) {
    if (/ला$|ची$|चे$|चा$|ात$|ून$/.test(word)) marathiScore++;
    if (/को$|की$|के$|का$|ों$|ूं$/.test(word)) hindiScore++;
  }

  if (marathiScore > hindiScore) return "mr-IN";
  if (hindiScore > marathiScore) return "hi-IN";

  // Tie or no markers: default to Hindi (more common)
  return "hi-IN";
}

function isLikelyEnglish(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return true;

  let englishCount = 0;
  for (const word of words) {
    // Strip basic punctuation for matching
    const clean = word.replace(/[.,!?;:'"()]/g, "");
    if (COMMON_ENGLISH.has(clean)) englishCount++;
  }

  const ratio = englishCount / words.length;
  return ratio > 0.3; // >30% common English words = likely English
}

/**
 * Detect the language of a transcript.
 *
 * @param transcript - The STT transcript text
 * @param current - The current sticky language
 * @returns DetectionResult with detected language and confidence
 */
export function detectLanguage(transcript: string, current: SupportedLanguage): DetectionResult {
  const text = transcript.trim();
  if (!text) return { language: current, confidence: "low" };

  // Very short text (1-2 words) — not enough signal, keep current
  if (text.split(/\s+/).length <= 2) {
    return { language: current, confidence: "low" };
  }

  const script = detectScript(text);

  // Signal 1: Devanagari script detected
  if (script === "devanagari" || script === "mixed") {
    const lang = distinguishHindiMarathi(text);
    return { language: lang, confidence: "high" };
  }

  // Signal 2: Latin script — check if it's actually English
  if (script === "latin") {
    if (isLikelyEnglish(text)) {
      return { language: "en-US", confidence: "high" };
    }

    // Low English word match — could be transliterated Hindi/Marathi
    if (TRANSLITERATION_PATTERNS.test(text)) {
      // Strong transliteration signal — suspect Hindi (STT will re-transcribe next utterance)
      return { language: "hi-IN", confidence: "low" };
    }

    // No strong signal either way — keep current
    return { language: current, confidence: "low" };
  }

  // Unknown script — keep current
  return { language: current, confidence: "low" };
}

/**
 * Detect language from typed text (for text chat input).
 * Simpler version — no transliteration concern since user typed it directly.
 */
export function detectTypedLanguage(text: string): SupportedLanguage | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.split(/\s+/).length <= 2) return null;

  const script = detectScript(trimmed);

  if (script === "devanagari" || script === "mixed") {
    return distinguishHindiMarathi(trimmed);
  }

  if (script === "latin") {
    return "en-US";
  }

  return null;
}

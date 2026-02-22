/**
 * Shared language type definitions for Vinegar
 * Single source of truth — import from here, not inline.
 */

// STT detection languages (what we can auto-detect)
export type SupportedLanguage = "en-US" | "hi-IN" | "mr-IN";

// TTS supports en-IN in addition to STT languages
export type TtsLanguage = SupportedLanguage | "en-IN";

// Recognition lifecycle states (replaces boolean refs)
export type VoiceState = "IDLE" | "LISTENING" | "SWITCHING_LANG" | "PROCESSING" | "SPEAKING";

export interface DetectionResult {
  language: SupportedLanguage;
  confidence: "high" | "low";
}

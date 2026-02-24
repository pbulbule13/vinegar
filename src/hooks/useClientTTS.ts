"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface TTSSettings {
  language: string;   // "en-US" | "en-IN" | "hi-IN" | "mr-IN"
  speed: number;      // 0.5 - 2.0
  pitch: number;      // 0.5 - 2.0
  voiceName: string;  // specific voice name or "" for default
}

const DEFAULT_TTS: TTSSettings = {
  language: "en-US",
  speed: 1.8,
  pitch: 1.0,
  voiceName: "",
};

export interface VoiceOption {
  name: string;
  lang: string;
  localService: boolean;
}

export interface UseClientTTSReturn {
  speak: (text: string, overrides?: Partial<TTSSettings>) => void;
  stop: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
  hasVoices: boolean;
  voices: VoiceOption[];
  settings: TTSSettings;
  updateSettings: (patch: Partial<TTSSettings>) => void;
  loadSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
}

// ─── Text Chunking (avoids Chrome's long-text pause bug) ───

function splitIntoChunks(text: string, maxLen: number = 150): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf(". ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(", ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = remaining.lastIndexOf(" ", maxLen);
    if (breakAt < maxLen * 0.3) breakAt = maxLen;
    chunks.push(remaining.substring(0, breakAt + 1).trim());
    remaining = remaining.substring(breakAt + 1).trim();
  }

  return chunks.filter((c) => c.length > 0);
}

function cleanForSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#+\s/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`~|>]/g, "")
    .replace(/\n+/g, ". ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1500);
}

/**
 * Client-side TTS using Browser SpeechSynthesis API.
 * - Zero external calls (completely private)
 * - Supports en-US, en-IN, hi-IN, mr-IN
 * - Configurable speed, pitch, voice
 * - Chunks long text to avoid Chrome pause bug
 * - Falls back to server-side /api/tts when no browser voices
 */
export function useClientTTS(onSpeakEnd?: () => void): UseClientTTSReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [hasVoices, setHasVoices] = useState(false);
  const [settings, setSettings] = useState<TTSSettings>(DEFAULT_TTS);
  const settingsRef = useRef<TTSSettings>(DEFAULT_TTS);
  const speakingRef = useRef(false);
  const chunkQueueRef = useRef<string[]>([]);
  const cancelledRef = useRef(false);
  const fallbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const isSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Keep ref in sync
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Load available voices (with retry for async voice loading)
  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      const rawVoices = window.speechSynthesis.getVoices();
      const mapped: VoiceOption[] = rawVoices.map((v) => ({
        name: v.name,
        lang: v.lang,
        localService: v.localService,
      }));
      setVoices(mapped);
      setHasVoices(mapped.length > 0);
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    // Retry after 2s if voices haven't loaded (Android WebView quirk)
    const retryTimer = setTimeout(() => {
      if (window.speechSynthesis.getVoices().length === 0) {
        loadVoices();
      }
    }, 2000);

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      clearTimeout(retryTimer);
    };
  }, [isSupported]);

  // Load settings from server
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/tts");
      if (res.ok) {
        const data = await res.json();
        const loaded: TTSSettings = {
          language: data.tts_language || DEFAULT_TTS.language,
          speed: parseFloat(data.tts_speed) || DEFAULT_TTS.speed,
          pitch: parseFloat(data.tts_pitch) || DEFAULT_TTS.pitch,
          voiceName: data.tts_voice || DEFAULT_TTS.voiceName,
        };
        setSettings(loaded);
        settingsRef.current = loaded;
      }
    } catch {
      // Use defaults
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Save settings to server
  const saveSettings = useCallback(async () => {
    try {
      await fetch("/api/settings/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tts_language: settingsRef.current.language,
          tts_speed: String(settingsRef.current.speed),
          tts_pitch: String(settingsRef.current.pitch),
          tts_voice: settingsRef.current.voiceName,
        }),
      });
    } catch {
      // Silent fail
    }
  }, []);

  const updateSettings = useCallback((patch: Partial<TTSSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      return next;
    });
  }, []);

  const findVoice = useCallback(
    (
      lang: string,
      preferredName?: string
    ): SpeechSynthesisVoice | null => {
      if (!isSupported) return null;
      const allVoices = window.speechSynthesis.getVoices();
      if (allVoices.length === 0) return null;

      // 1. Exact match by name
      if (preferredName) {
        const exact = allVoices.find((v) => v.name === preferredName);
        if (exact) return exact;
      }

      // 2. Local voice matching language (privacy: prefer local)
      const localMatch = allVoices.find(
        (v) => v.lang.startsWith(lang) && v.localService
      );
      if (localMatch) return localMatch;

      // 3. Any voice matching language
      const langMatch = allVoices.find((v) => v.lang.startsWith(lang));
      if (langMatch) return langMatch;

      // 4. Base language code (e.g., "hi" from "hi-IN")
      const baseLang = lang.split("-")[0];
      const baseMatch = allVoices.find((v) =>
        v.lang.startsWith(baseLang)
      );
      if (baseMatch) return baseMatch;

      // 5. Fallback to first voice
      return allVoices[0] || null;
    },
    [isSupported]
  );

  // ─── Server-side TTS fallback (when browser has no voices) ───
  const speakFallback = useCallback(
    async (text: string) => {
      try {
        if (fallbackAudioRef.current) {
          fallbackAudioRef.current.pause();
          fallbackAudioRef.current = null;
        }
        speakingRef.current = true;
        setIsSpeaking(true);

        const lang = settingsRef.current.language;
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang, speed: settingsRef.current.speed }),
        });

        if (!res.ok) throw new Error("TTS fallback failed");

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        fallbackAudioRef.current = audio;

        audio.onended = () => {
          speakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
          fallbackAudioRef.current = null;
          onSpeakEnd?.();
        };
        audio.onerror = () => {
          speakingRef.current = false;
          setIsSpeaking(false);
          URL.revokeObjectURL(url);
          fallbackAudioRef.current = null;
          onSpeakEnd?.();
        };

        await audio.play();
      } catch {
        speakingRef.current = false;
        setIsSpeaking(false);
        onSpeakEnd?.();
      }
    },
    [onSpeakEnd]
  );

  // ─── Speak a single chunk ───
  const speakChunk = useCallback(
    (
      chunkText: string,
      current: TTSSettings,
      voice: SpeechSynthesisVoice | null,
      onChunkEnd: () => void
    ) => {
      const utterance = new SpeechSynthesisUtterance(chunkText);
      if (voice) utterance.voice = voice;
      utterance.lang = current.language;
      utterance.rate = Math.max(0.5, Math.min(2.0, current.speed));
      utterance.pitch = Math.max(0.5, Math.min(2.0, current.pitch));
      utterance.volume = 1.0;

      // Safety timeout: if onend/onerror never fires (Android WebView bug),
      // force advance after estimated duration + 3s buffer
      const estimatedMs = (chunkText.length / 15) * (1000 / current.speed) + 3000;
      let resolved = false;
      const safetyTimer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          onChunkEnd();
        }
      }, estimatedMs);

      utterance.onend = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(safetyTimer);
          onChunkEnd();
        }
      };
      utterance.onerror = () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(safetyTimer);
          onChunkEnd();
        }
      };

      window.speechSynthesis.speak(utterance);
    },
    []
  );

  // ─── Main speak function (with chunking) ───
  const speak = useCallback(
    (text: string, overrides?: Partial<TTSSettings>) => {
      if (!text.trim()) return;

      // Cancel any ongoing speech
      cancelledRef.current = true;
      chunkQueueRef.current = [];
      if (isSupported) window.speechSynthesis.cancel();
      if (fallbackAudioRef.current) {
        fallbackAudioRef.current.pause();
        fallbackAudioRef.current = null;
      }

      const current = { ...settingsRef.current, ...overrides };
      const clean = cleanForSpeech(text);
      if (!clean) return;

      // Check if browser TTS is available with voices
      const browserVoices = isSupported
        ? window.speechSynthesis.getVoices()
        : [];

      if (!isSupported || browserVoices.length === 0) {
        cancelledRef.current = false;
        speakFallback(clean);
        return;
      }

      // Small delay after cancel to avoid Chrome/Android dead-state bug
      // where cancel() + immediate speak() causes synthesis to freeze
      setTimeout(() => {
        cancelledRef.current = false;

        // Client-side TTS with chunking
        const chunks = splitIntoChunks(clean, 150);
        chunkQueueRef.current = chunks;
        speakingRef.current = true;
        setIsSpeaking(true);

        const voice = findVoice(current.language, current.voiceName);

        const playNextChunk = () => {
          if (cancelledRef.current || chunkQueueRef.current.length === 0) {
            speakingRef.current = false;
            setIsSpeaking(false);
            chunkQueueRef.current = [];
            if (!cancelledRef.current) onSpeakEnd?.();
            return;
          }

          const chunk = chunkQueueRef.current.shift()!;
          speakChunk(chunk, current, voice, playNextChunk);
        };

        playNextChunk();
      }, 100);
    },
    [isSupported, findVoice, speakChunk, speakFallback, onSpeakEnd]
  );

  const stop = useCallback(() => {
    cancelledRef.current = true;
    chunkQueueRef.current = [];
    if (isSupported) window.speechSynthesis.cancel();
    if (fallbackAudioRef.current) {
      fallbackAudioRef.current.pause();
      fallbackAudioRef.current = null;
    }
    speakingRef.current = false;
    setIsSpeaking(false);
  }, [isSupported]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      chunkQueueRef.current = [];
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      if (fallbackAudioRef.current) {
        fallbackAudioRef.current.pause();
        fallbackAudioRef.current = null;
      }
    };
  }, []);

  return {
    speak,
    stop,
    isSpeaking,
    isSupported,
    hasVoices,
    voices,
    settings,
    updateSettings,
    loadSettings,
    saveSettings,
  };
}

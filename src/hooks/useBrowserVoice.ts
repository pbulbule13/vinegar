"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { tryOfflineResponse } from "@/lib/offline-commands";
import { detectLanguage } from "@/lib/language-detector";
import type { SupportedLanguage, VoiceState } from "@/types/language";

// Web Speech API type declarations
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: { isFinal: boolean; [index: number]: { transcript: string } } };
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface UseBrowserVoiceOptions {
  onTranscript?: (text: string, isFinal: boolean) => void;
  onAIResponse?: (text: string) => void;
  onError?: (error: string) => void;
  onSpeak?: (text: string) => void;
  onSpeakEnd?: () => void; // Direct TTS completion signal (replaces duration estimation)
  onLanguageChange?: (lang: SupportedLanguage) => void;
  onToolResult?: (toolName: string, result: { success: boolean; data?: unknown; message?: string }) => void;
  model?: string;
  sttLanguage?: string;
}

interface UseBrowserVoiceReturn {
  isConnected: boolean;
  isListening: boolean;
  isSpeaking: boolean;
  userTranscript: string;
  aiTranscript: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  startListening: () => void;
  stopListening: () => void;
  error: string | null;
  detectedLanguage: SupportedLanguage;
  notifySpeakEnd: () => void; // Parent calls this when TTS finishes
}

// ─── State machine: valid transitions ───

const VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  IDLE: ["LISTENING"],
  LISTENING: ["PROCESSING", "SWITCHING_LANG", "IDLE"],
  SWITCHING_LANG: ["LISTENING", "IDLE"],
  PROCESSING: ["SPEAKING", "LISTENING", "IDLE"],
  SPEAKING: ["LISTENING", "IDLE"],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function useBrowserVoice(options: UseBrowserVoiceOptions = {}): UseBrowserVoiceReturn {
  const {
    onTranscript, onAIResponse, onError, onSpeak, onSpeakEnd: onSpeakEndProp,
    onLanguageChange, onToolResult, model = "gemini-2.5-flash", sttLanguage = "en-US",
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // State machine (single ref replaces isListening/isSpeaking/isProcessing boolean refs)
  const stateRef = useRef<VoiceState>("IDLE");
  const isConnectedRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const echoGapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sticky language tracking
  const currentLangRef = useRef<SupportedLanguage>(sttLanguage as SupportedLanguage);
  const consecutiveMatchRef = useRef(0);
  const pendingLangSwitchRef = useRef<SupportedLanguage | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<SupportedLanguage>(sttLanguage as SupportedLanguage);

  // Keep currentLangRef in sync with prop changes
  useEffect(() => {
    currentLangRef.current = sttLanguage as SupportedLanguage;
    setDetectedLanguage(sttLanguage as SupportedLanguage);
  }, [sttLanguage]);

  // ─── State transition helper ───

  function transitionTo(nextState: VoiceState) {
    const current = stateRef.current;
    if (!VALID_TRANSITIONS[current]?.includes(nextState)) {
      return false;
    }
    stateRef.current = nextState;

    // Sync React state from state machine
    setIsListening(nextState === "LISTENING");
    setIsSpeaking(nextState === "SPEAKING");
    return true;
  }

  // ─── Restart listening after TTS or error ───

  const restartListening = useCallback(() => {
    if (!recognitionRef.current || !isConnectedRef.current) return;
    if (stateRef.current !== "IDLE" && stateRef.current !== "SPEAKING") return;

    // Apply pending language switch in between sessions (not during active STT)
    if (pendingLangSwitchRef.current && recognitionRef.current) {
      recognitionRef.current.lang = pendingLangSwitchRef.current;
      currentLangRef.current = pendingLangSwitchRef.current;
      setDetectedLanguage(pendingLangSwitchRef.current);
      onLanguageChange?.(pendingLangSwitchRef.current);
      pendingLangSwitchRef.current = null;
    }

    echoGapTimerRef.current = setTimeout(() => {
      echoGapTimerRef.current = null;
      if (isConnectedRef.current && transitionTo("LISTENING")) {
        try { recognitionRef.current?.start(); } catch {}
      }
    }, 400);
  }, [onLanguageChange]);

  // ─── TTS completion handler (called by parent via notifySpeakEnd) ───

  const notifySpeakEnd = useCallback(() => {
    if (stateRef.current !== "SPEAKING") return;
    transitionTo("IDLE");
    restartListening();
  }, [restartListening]);

  // ─── Speak text using client-side TTS ───

  const speak = useCallback((text: string) => {
    if (echoGapTimerRef.current) {
      clearTimeout(echoGapTimerRef.current);
      echoGapTimerRef.current = null;
    }

    transitionTo("SPEAKING");

    if (onSpeak) {
      onSpeak(text);
      // If parent provides onSpeakEnd prop, we rely on notifySpeakEnd being called.
      // Otherwise fall back to duration estimation.
      if (!onSpeakEndProp) {
        const estimatedDuration = Math.max(2000, (text.length / 15) * 1000 / 1.2);
        setTimeout(() => {
          notifySpeakEnd();
        }, estimatedDuration);
      }
    } else {
      // No TTS, immediately ready to listen again
      transitionTo("IDLE");
      restartListening();
    }
  }, [onSpeak, onSpeakEndProp, notifySpeakEnd, restartListening]);

  // ─── Process transcript with LLM ───

  const processWithLLM = useCallback(async (text: string) => {
    if (!transitionTo("PROCESSING")) return;

    // Stop STT while processing
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    // Check offline commands first
    const offlineResult = tryOfflineResponse(text, currentLangRef.current);
    if (offlineResult) {
      setAiTranscript("");
      onAIResponse?.(offlineResult.response);
      chatHistoryRef.current.push({ role: "user", content: text });
      chatHistoryRef.current.push({ role: "assistant", content: offlineResult.response });
      speak(offlineResult.response);
      return;
    }

    setAiTranscript("thinking...");
    chatHistoryRef.current.push({ role: "user", content: text });

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatHistoryRef.current.slice(-10),
          model,
          language: currentLangRef.current,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get response");

      const aiText = data.content || "I couldn't generate a response.";
      setAiTranscript("");
      onAIResponse?.(aiText);

      // Notify parent about tool results for visual context
      const visualTools = ['get_weather', 'get_forecast', 'find_nearby', 'get_traffic', 'suggest_recipe', 'show_visual'];
      if (data.toolsUsed && Array.isArray(data.toolsUsed) && onToolResult) {
        for (const toolName of data.toolsUsed) {
          if (visualTools.includes(toolName)) {
            onToolResult(toolName, { success: true, data: {}, message: aiText });
          }
        }
      }

      chatHistoryRef.current.push({ role: "assistant", content: aiText });
      if (chatHistoryRef.current.length > 20) {
        chatHistoryRef.current = chatHistoryRef.current.slice(-20);
      }

      // Log AI response
      fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "assistant", content: aiText, source: "voice", model }),
      }).catch(() => {});

      speak(aiText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get response";
      setError(msg);
      onError?.(msg);
      setAiTranscript("");
      transitionTo("IDLE");
      restartListening();
    }
  }, [model, onAIResponse, onError, onToolResult, speak, restartListening]);

  // ─── Connect: create SpeechRecognition instance ───

  const connect = useCallback(async () => {
    const SpeechRecognitionAPI = getSpeechRecognition();
    if (!SpeechRecognitionAPI) {
      const msg = "Speech recognition not supported in this browser";
      setError(msg);
      onError?.(msg);
      throw new Error(msg);
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = currentLangRef.current;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (interimText && !finalText) {
        setUserTranscript(interimText);
        onTranscript?.(interimText, false);
      }

      if (finalText) {
        setUserTranscript(finalText);
        onTranscript?.(finalText, true);

        // ── Language detection on final transcript ──
        const detection = detectLanguage(finalText, currentLangRef.current);
        if (detection.language !== currentLangRef.current) {
          if (detection.confidence === "high") {
            // High confidence: schedule switch for next session
            consecutiveMatchRef.current = 0;
            pendingLangSwitchRef.current = detection.language;
          } else {
            // Low confidence: require 2 consecutive matches before switching
            consecutiveMatchRef.current++;
            if (consecutiveMatchRef.current >= 2) {
              pendingLangSwitchRef.current = detection.language;
              consecutiveMatchRef.current = 0;
            }
          }
        } else {
          consecutiveMatchRef.current = 0;
        }

        // Log user voice transcript
        fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: finalText, source: "voice" }),
        }).catch(() => {});

        processWithLLM(finalText);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        if (isConnectedRef.current && stateRef.current === "LISTENING") {
          setTimeout(() => {
            if (transitionTo("IDLE")) transitionTo("LISTENING");
            try { recognition.start(); } catch {}
          }, 500);
        }
        return;
      }
      setError(`Speech error: ${event.error}`);
      transitionTo("IDLE");
    };

    recognition.onend = () => {
      // Apply pending language switch between STT sessions
      if (pendingLangSwitchRef.current) {
        recognition.lang = pendingLangSwitchRef.current;
        currentLangRef.current = pendingLangSwitchRef.current;
        setDetectedLanguage(pendingLangSwitchRef.current);
        onLanguageChange?.(pendingLangSwitchRef.current);
        pendingLangSwitchRef.current = null;
      }

      if (isConnectedRef.current && stateRef.current !== "PROCESSING" && stateRef.current !== "SPEAKING") {
        setTimeout(() => {
          if (stateRef.current === "IDLE" || stateRef.current === "SWITCHING_LANG") {
            transitionTo("LISTENING");
            try { recognition.start(); } catch {}
          }
        }, 500);
      }
    };

    recognitionRef.current = recognition;
    chatHistoryRef.current = [];
    isConnectedRef.current = true;
    stateRef.current = "IDLE";
    setIsConnected(true);
    setError(null);
  }, [onTranscript, onError, onLanguageChange, processWithLLM]);

  // ─── Disconnect ───

  const disconnect = useCallback(() => {
    isConnectedRef.current = false;
    stateRef.current = "IDLE";
    if (echoGapTimerRef.current) { clearTimeout(echoGapTimerRef.current); echoGapTimerRef.current = null; }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setIsConnected(false);
    setIsListening(false);
    setIsSpeaking(false);
    setUserTranscript("");
    setAiTranscript("");
    chatHistoryRef.current = [];
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current || stateRef.current !== "IDLE") return;
    if (transitionTo("LISTENING")) {
      setUserTranscript("");
      try { recognitionRef.current.start(); } catch {
        setError("Failed to start listening");
        transitionTo("IDLE");
      }
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (echoGapTimerRef.current) { clearTimeout(echoGapTimerRef.current); echoGapTimerRef.current = null; }
    stateRef.current = "IDLE";
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isConnectedRef.current = false;
      stateRef.current = "IDLE";
      chatHistoryRef.current = [];
      if (echoGapTimerRef.current) clearTimeout(echoGapTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isConnected, isListening, isSpeaking, userTranscript, aiTranscript,
    connect, disconnect, startListening, stopListening, error,
    detectedLanguage, notifySpeakEnd,
  };
}

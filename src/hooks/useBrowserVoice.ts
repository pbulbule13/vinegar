"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { tryOfflineResponse } from "@/lib/offline-commands";

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
  onSpeak?: (text: string) => void; // External TTS callback (uses client-side SpeechSynthesis)
  model?: string;
  sttLanguage?: string; // "en-US" | "hi-IN" | "mr-IN" etc.
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
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSpeechRecognition(): (new () => SpeechRecognitionInstance) | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = window as any;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function useBrowserVoice(options: UseBrowserVoiceOptions = {}): UseBrowserVoiceReturn {
  const { onTranscript, onAIResponse, onError, onSpeak, model = "gemini-2.5-flash", sttLanguage = "en-US" } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [userTranscript, setUserTranscript] = useState("");
  const [aiTranscript, setAiTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isConnectedRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const chatHistoryRef = useRef<{ role: "user" | "assistant"; content: string }[]>([]);
  const isProcessingRef = useRef(false);
  const ttsDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const echoGapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speak text using client-side TTS (via onSpeak callback from parent)
  // No external server calls - completely private
  const speak = useCallback((text: string) => {
    // Clear any previous speech estimation timers (prevent leaks)
    if (ttsDurationTimerRef.current) clearTimeout(ttsDurationTimerRef.current);
    if (echoGapTimerRef.current) clearTimeout(echoGapTimerRef.current);

    isSpeakingRef.current = true;
    setIsSpeaking(true);

    if (onSpeak) {
      // Use client-side TTS via parent callback
      onSpeak(text);
      // The parent's TTS will handle speaking; we use a timeout to auto-restart listening
      // since we don't get a direct onEnd callback here
      const estimatedDuration = Math.max(2000, (text.length / 15) * 1000 / 1.2);
      ttsDurationTimerRef.current = setTimeout(() => {
        ttsDurationTimerRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        // Auto-restart listening after speaking (with echo cancellation delay)
        if (recognitionRef.current && isConnectedRef.current) {
          echoGapTimerRef.current = setTimeout(() => {
            echoGapTimerRef.current = null;
            try { recognitionRef.current?.start(); setIsListening(true); } catch {}
          }, 400); // 400ms echo cancellation gap
        }
      }, estimatedDuration);
    } else {
      // No TTS available, just reset state
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (recognitionRef.current && isConnectedRef.current) {
        echoGapTimerRef.current = setTimeout(() => {
          echoGapTimerRef.current = null;
          try { recognitionRef.current?.start(); setIsListening(true); } catch {}
        }, 300);
      }
    }
  }, [onSpeak]);

  const processWithLLM = useCallback(async (text: string) => {
    if (isProcessingRef.current) return;
    isProcessingRef.current = true;

    // Stop listening while processing
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListening(false);

    // Check offline commands first (saves tokens + faster response)
    const offlineResult = tryOfflineResponse(text);
    if (offlineResult) {
      setAiTranscript("");
      onAIResponse?.(offlineResult.response);
      chatHistoryRef.current.push({ role: "user", content: text });
      chatHistoryRef.current.push({ role: "assistant", content: offlineResult.response });
      speak(offlineResult.response);
      isProcessingRef.current = false;
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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get response");

      const aiText = data.content || "I couldn't generate a response.";
      setAiTranscript("");
      onAIResponse?.(aiText);

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

      // Speak the response via server TTS
      speak(aiText);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to get response";
      setError(msg);
      onError?.(msg);
      setAiTranscript("");
      // Restart listening on error
      if (recognitionRef.current && isConnectedRef.current) {
        try { recognitionRef.current.start(); setIsListening(true); } catch {}
      }
    } finally {
      isProcessingRef.current = false;
    }
  }, [model, onAIResponse, onError, speak]);

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
    recognition.lang = sttLanguage;
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
        setIsListening(false);

        // Log user voice transcript
        fetch("/api/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role: "user", content: finalText, source: "voice" }),
        }).catch(() => {});

        // Process with LLM
        processWithLLM(finalText);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        if (isConnectedRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
          setTimeout(() => {
            try { recognition.start(); setIsListening(true); } catch {}
          }, 500);
        }
        return;
      }
      setError(`Speech error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      if (isConnectedRef.current && !isSpeakingRef.current && !isProcessingRef.current) {
        setTimeout(() => {
          try { recognition.start(); setIsListening(true); } catch {}
        }, 500);
      }
    };

    recognitionRef.current = recognition;
    chatHistoryRef.current = [];
    isConnectedRef.current = true;
    setIsConnected(true);
    setError(null);
  }, [onTranscript, onError, processWithLLM]);

  const disconnect = useCallback(() => {
    isConnectedRef.current = false;
    isSpeakingRef.current = false;
    if (ttsDurationTimerRef.current) { clearTimeout(ttsDurationTimerRef.current); ttsDurationTimerRef.current = null; }
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
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setUserTranscript("");
    } catch {
      setError("Failed to start listening");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    if (ttsDurationTimerRef.current) { clearTimeout(ttsDurationTimerRef.current); ttsDurationTimerRef.current = null; }
    if (echoGapTimerRef.current) { clearTimeout(echoGapTimerRef.current); echoGapTimerRef.current = null; }
    isSpeakingRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  useEffect(() => {
    return () => {
      isConnectedRef.current = false;
      isProcessingRef.current = false;
      isSpeakingRef.current = false;
      chatHistoryRef.current = [];
      if (ttsDurationTimerRef.current) clearTimeout(ttsDurationTimerRef.current);
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
  };
}

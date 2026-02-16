"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface UseWakeWordOptions {
  wakeWord?: string;
  onWake?: () => void;
  onSleep?: () => void;
  continuous?: boolean;
  sleepAfterMs?: number;
}

interface UseWakeWordReturn {
  isAwake: boolean;
  isPassiveListening: boolean;
  startPassiveListening: () => void;
  stopPassiveListening: () => void;
  wake: () => void;
  sleep: () => void;
  lastHeard: string;
}

export function useWakeWord(options: UseWakeWordOptions = {}): UseWakeWordReturn {
  const {
    wakeWord = "vinegar",
    onWake,
    onSleep,
    continuous = true,
    sleepAfterMs = 30000, // Go back to sleep after 30s of no interaction
  } = options;

  const [isAwake, setIsAwake] = useState(false);
  const [isPassiveListening, setIsPassiveListening] = useState(false);
  const [lastHeard, setLastHeard] = useState("");
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const sleepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwakeRef = useRef(false);
  const isPassiveListeningRef = useRef(false);

  const resetSleepTimer = useCallback(() => {
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = setTimeout(() => {
      setIsAwake(false);
      isAwakeRef.current = false;
      onSleep?.();
    }, sleepAfterMs);
  }, [sleepAfterMs, onSleep]);

  const wake = useCallback(() => {
    setIsAwake(true);
    isAwakeRef.current = true;
    onWake?.();
    resetSleepTimer();
  }, [onWake, resetSleepTimer]);

  const sleep = useCallback(() => {
    setIsAwake(false);
    isAwakeRef.current = false;
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
    onSleep?.();
  }, [onSleep]);

  const startPassiveListening = useCallback(() => {
    // Check if Web Speech API is available
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Speech recognition not supported in this browser
      return;
    }

    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;
      for (let i = event.resultIndex; i < results.length; i++) {
        const transcript = results[i][0].transcript.toLowerCase().trim();
        setLastHeard(transcript);

        // Check for wake word
        if (!isAwakeRef.current && transcript.includes(wakeWord.toLowerCase())) {
          wake();
        }

        // If awake, reset the sleep timer on any speech
        if (isAwakeRef.current) {
          resetSleepTimer();
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") return;
      // Recognition error (not no-speech/aborted) - non-fatal
    };

    recognition.onend = () => {
      // Auto-restart for continuous passive listening (use ref to avoid stale closure)
      if (isPassiveListeningRef.current) {
        try {
          setTimeout(() => {
            if (recognitionRef.current) {
              recognitionRef.current.start();
            }
          }, 100);
        } catch {}
      }
    };

    recognitionRef.current = recognition;
    setIsPassiveListening(true);
    isPassiveListeningRef.current = true;

    try {
      recognition.start();
    } catch {}
  }, [wakeWord, continuous, wake, resetSleepTimer]);

  const stopPassiveListening = useCallback(() => {
    setIsPassiveListening(false);
    isPassiveListeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    if (sleepTimerRef.current) clearTimeout(sleepTimerRef.current);
  }, []);

  // Cleanup on unmount - ensure all timers and recognition are stopped
  useEffect(() => {
    return () => {
      isPassiveListeningRef.current = false;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      if (sleepTimerRef.current) {
        clearTimeout(sleepTimerRef.current);
        sleepTimerRef.current = null;
      }
    };
  }, []);

  return {
    isAwake,
    isPassiveListening,
    startPassiveListening,
    stopPassiveListening,
    wake,
    sleep,
    lastHeard,
  };
}

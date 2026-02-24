"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// Phrases that put Vinegar to sleep (user says these while awake)
const SLEEP_PHRASES = [
  "you can sleep now",
  "you can sleep",
  "go to sleep",
  "sleep now",
  "good night vinegar",
  "goodnight vinegar",
  "stop listening",
  "vinegar sleep",
  "that's all",
  "that is all",
  "thanks vinegar",
  "thank you vinegar",
  "bye vinegar",
  "goodbye vinegar",
];

interface UseWakeWordOptions {
  wakeWord?: string;
  onWake?: () => void;
  onSleep?: () => void;
  continuous?: boolean;
  sleepAfterMs?: number;
  sttLanguage?: string; // Match sticky language instead of hardcoded en-US
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
    sttLanguage = "en-US",
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
    recognition.lang = sttLanguage;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;
      for (let i = event.resultIndex; i < results.length; i++) {
        const transcript = results[i][0].transcript.toLowerCase().trim();
        setLastHeard(transcript);

        // When ASLEEP: listen for wake word to activate
        if (!isAwakeRef.current && transcript.includes(wakeWord.toLowerCase())) {
          wake();
          continue;
        }

        // When AWAKE: listen for sleep phrases to deactivate
        if (isAwakeRef.current) {
          const isSleepCommand = SLEEP_PHRASES.some(phrase => transcript.includes(phrase));
          if (isSleepCommand) {
            sleep();
            continue;
          }
          // Any other speech resets the auto-sleep timer
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
        setTimeout(() => {
          if (isPassiveListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              // On Android, start() can throw if recognition is in bad state
              // Recreate the recognition instance after a longer delay
              setTimeout(() => {
                if (isPassiveListeningRef.current) {
                  try {
                    const fresh = new SpeechRecognition();
                    fresh.continuous = recognitionRef.current?.continuous ?? true;
                    fresh.interimResults = true;
                    fresh.lang = recognitionRef.current?.lang ?? "en-US";
                    fresh.onresult = recognitionRef.current?.onresult ?? null;
                    fresh.onerror = recognitionRef.current?.onerror ?? null;
                    fresh.onend = recognitionRef.current?.onend ?? null;
                    recognitionRef.current = fresh;
                    fresh.start();
                  } catch {}
                }
              }, 1000);
            }
          }
        }, 300);
      }
    };

    recognitionRef.current = recognition;
    setIsPassiveListening(true);
    isPassiveListeningRef.current = true;

    try {
      recognition.start();
    } catch {}
  }, [wakeWord, continuous, wake, resetSleepTimer, sttLanguage]);

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

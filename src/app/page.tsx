"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { useBrowserVoice } from "@/hooks/useBrowserVoice";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useSpeakerIdentification } from "@/hooks/useSpeakerIdentification";
import type { IdentificationResult } from "@/hooks/useSpeakerIdentification";
import { tryOfflineResponse } from "@/lib/offline-commands";
import { detectTypedLanguage } from "@/lib/language-detector";
import type { SupportedLanguage } from "@/types/language";
import { useNotifications } from "@/hooks/useNotifications";
import { useClientTTS } from "@/hooks/useClientTTS";
import { SettingsModal } from "@/components/settings-modal";
import { HeaderBar } from "@/components/header-bar";
import { ChatColumn } from "@/components/chat-column";
import { InputArea } from "@/components/input-area";
import { ContextPanel } from "@/components/context-panel/context-panel";
import { MobileContextSheet } from "@/components/context-panel/mobile-context-sheet";
import { useVisualContext } from "@/hooks/useVisualContext";
import { stripVisualHint } from "@/lib/visual-context-detector";

interface Message {
  id: string;
  role: "user" | "vinegar";
  text: string;
  timestamp: Date;
  source?: "voice" | "text" | "offline";
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export default function VinegarHome() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isActive, setIsActive] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [selectedModel, setSelectedModel] = useState("gemini-2.5-flash");
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(false);
  const [hasVoiceKey, setHasVoiceKey] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showVisualPanel, setShowVisualPanel] = useState(true);

  // Real-time notifications (reminders + suggestions)
  const { notifications, unreadCount, dismiss, dismissAll } = useNotifications();

  // Visual context panel
  const visualContext = useVisualContext({ debounceMs: 300 });

  // STT/TTS language — single source of truth
  const [sttLanguage, setSttLanguage] = useState<SupportedLanguage>("en-US");
  const langSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Speaker identification
  const [identifiedSpeaker, setIdentifiedSpeaker] = useState<IdentificationResult | null>(null);

  const handleSpeakerIdentified = useCallback(async (speaker: IdentificationResult | null) => {
    setIdentifiedSpeaker(speaker);
    if (speaker) {
      try {
        await fetch("/api/family", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "voice_switch", member_id: speaker.memberId }),
        });
      } catch {}
    }
  }, []);

  const speakerId = useSpeakerIdentification({
    enabled: true,
    onSpeakerIdentified: handleSpeakerIdentified,
  });

  // Debounced settings sync when language changes (2s debounce)
  const syncLanguageToServer = useCallback((lang: SupportedLanguage) => {
    if (langSyncTimerRef.current) clearTimeout(langSyncTimerRef.current);
    langSyncTimerRef.current = setTimeout(() => {
      fetch("/api/settings/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stt_language: lang, tts_language: lang }),
      }).catch(() => {});
    }, 2000);
  }, []);

  const handleLanguageChange = useCallback((lang: SupportedLanguage) => {
    setSttLanguage(lang);
    syncLanguageToServer(lang);
  }, [syncLanguageToServer]);

  // Client-side TTS with onSpeakEnd wired to voice hook
  const clientTTS = useClientTTS(() => {
    if (browserVoiceRef.current?.notifySpeakEnd) {
      browserVoiceRef.current.notifySpeakEnd();
    }
  });
  const browserVoiceRef = useRef<{ notifySpeakEnd: () => void } | null>(null);

  // Check if voice key is available + load STT language
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setHasVoiceKey(data.keySource !== "none");
    }).catch(() => {});
    fetch("/api/settings/tts").then(r => r.json()).then(data => {
      if (data.stt_language) setSttLanguage(data.stt_language as SupportedLanguage);
    }).catch(() => {});
  }, []);

  // Cleanup lang sync timer
  useEffect(() => {
    return () => {
      if (langSyncTimerRef.current) clearTimeout(langSyncTimerRef.current);
    };
  }, []);

  // Wake word detection with full sleep/wake cycle
  const {
    isAwake,
    startPassiveListening,
    stopPassiveListening,
  } = useWakeWord({
    wakeWord: "vinegar",
    sttLanguage,
    onWake: () => {
      if (!isActive) {
        handleVoiceActivate();
      }
    },
    onSleep: () => {
      if (isActive) {
        stopListening();
        disconnect();
        setIsActive(false);
        speakText("Going to sleep. Say Vinegar when you need me.");
      }
    },
    sleepAfterMs: 60000,
  });

  // Voice callbacks — with visual context detection for voice path
  const voiceCallbacks = {
    onTranscript: (text: string, isFinal: boolean) => {
      if (text.trim() && isFinal) {
        setMessages((prev) => [
          ...prev,
          { id: `user_${Date.now()}`, role: "user", text: text.trim(), timestamp: new Date(), source: "voice" },
        ]);
        // Tier 1: Instant visual detection from voice transcript
        visualContext.updateFromMessage(text.trim());
      }
    },
    onAIResponse: (text: string) => {
      if (text.trim()) {
        // Tier 2: Extract [visual:] hints and strip before display
        const cleaned = stripVisualHint(text);
        visualContext.updateFromResponse(text);
        setMessages((prev) => [
          ...prev,
          { id: `vinegar_${Date.now()}`, role: "vinegar", text: cleaned.trim(), timestamp: new Date(), source: "voice" },
        ]);
      }
    },
    onToolResult: (toolName: string, result: { success: boolean; data?: unknown; message?: string }) => {
      visualContext.updateFromToolResult(toolName as import("@/types/visual-context").VisualToolName, result);
    },
  };

  // OpenAI Realtime voice (premium)
  const openaiVoice = useRealtimeVoice({
    voice: "ash",
    model: "gpt-4o-mini-realtime-preview-2024-12-17",
    ...voiceCallbacks,
  });

  // Browser-native voice (free)
  const browserVoice = useBrowserVoice({
    model: selectedModel,
    sttLanguage,
    onSpeak: (text: string) => clientTTS.speak(text),
    onSpeakEnd: () => {},
    onLanguageChange: handleLanguageChange,
    ...voiceCallbacks,
  });

  useEffect(() => {
    browserVoiceRef.current = { notifySpeakEnd: browserVoice.notifySpeakEnd };
  }, [browserVoice.notifySpeakEnd]);

  const voice = hasVoiceKey ? openaiVoice : browserVoice;
  const {
    isConnected,
    isListening,
    isSpeaking,
    aiTranscript,
    connect,
    disconnect,
    startListening,
    stopListening,
    error,
  } = voice;

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, aiTranscript, isTyping]);

  const handleVoiceActivate = useCallback(async () => {
    if (isActive) {
      stopListening();
      disconnect();
      setIsActive(false);
      setIdentifiedSpeaker(null);
    } else {
      try {
        await speakerId.identifyOnce();
        await connect();
        await startListening();
        setIsActive(true);
      } catch {
        // Voice activation failed
      }
    }
  }, [isActive, connect, disconnect, startListening, stopListening, speakerId]);

  const toggleWakeWord = useCallback(() => {
    if (wakeWordEnabled) {
      stopPassiveListening();
      setWakeWordEnabled(false);
    } else {
      startPassiveListening();
      setWakeWordEnabled(true);
    }
  }, [wakeWordEnabled, startPassiveListening, stopPassiveListening]);

  const speakText = (text: string) => {
    clientTTS.speak(text);
  };

  // Text chat with streaming SSE + offline-first approach
  const handleSendText = async () => {
    const text = textInput.trim();
    if (!text || isTyping) return;

    const userMsg: Message = {
      id: `user_text_${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date(),
      source: "text",
    };
    setMessages((prev) => [...prev, userMsg]);
    setTextInput("");

    // Tier 1: Instant visual context detection from user message
    visualContext.updateFromMessage(text);

    // Detect language from typed text
    const typedLang = detectTypedLanguage(text);
    const chatLanguage = typedLang || sttLanguage;
    if (typedLang && typedLang !== sttLanguage) {
      handleLanguageChange(typedLang);
    }

    // Try offline response first
    const offlineResult = tryOfflineResponse(text, chatLanguage);
    if (offlineResult) {
      setMessages((prev) => [
        ...prev,
        { id: `vinegar_offline_${Date.now()}`, role: "vinegar", text: offlineResult.response, timestamp: new Date(), source: "offline" },
      ]);
      return;
    }

    // Need LLM - use streaming SSE
    setIsTyping(true);
    const newHistory = [...chatHistory, { role: "user" as const, content: text }];
    setChatHistory(newHistory);
    const streamMsgId = `vinegar_stream_${Date.now()}`;

    try {
      // Build visual context summary for LLM awareness
      const visualSummary = visualContext.context
        ? `${visualContext.context.cardType} card for ${visualContext.context.query}`
        : undefined;

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, model: selectedModel, language: chatLanguage, visualContext: visualSummary }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Stream failed" }));
        throw new Error(data.error || "Failed to get response");
      }

      setMessages((prev) => [
        ...prev,
        { id: streamMsgId, role: "vinegar", text: "", timestamp: new Date(), source: "text" },
      ]);

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullResponse += parsed.content;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamMsgId ? { ...m, text: fullResponse } : m
                )
              );
            }
          } catch {}
        }
      }

      if (!fullResponse) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamMsgId ? { ...m, text: "I couldn't generate a response." } : m
          )
        );
      }

      // Tier 2: Check for [visual:] hints in completed response
      visualContext.updateFromResponse(fullResponse);

      // Strip [visual:] hints before storing in history
      const cleanedResponse = stripVisualHint(fullResponse);
      const updatedHistory = [...newHistory, { role: "assistant" as const, content: cleanedResponse }];
      setChatHistory(updatedHistory.slice(-20));

      if (cleanedResponse) speakText(cleanedResponse);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect";
      setMessages((prev) => {
        const hasStreamMsg = prev.some((m) => m.id === streamMsgId);
        if (hasStreamMsg) {
          return prev.map((m) =>
            m.id === streamMsgId ? { ...m, text: `Connection issue: ${errorMsg}` } : m
          );
        }
        return [
          ...prev,
          { id: `error_${Date.now()}`, role: "vinegar", text: `Connection issue: ${errorMsg}`, timestamp: new Date(), source: "text" },
        ];
      });
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const toggleNotifications = useCallback(() => {
    setShowNotifications(prev => !prev);
  }, []);

  const toggleVisualPanel = useCallback(() => {
    setShowVisualPanel(prev => !prev);
  }, []);

  const openSettings = useCallback(() => {
    setShowSettings(true);
  }, []);

  const toggleModelPicker = useCallback(() => {
    setShowModelPicker(prev => !prev);
  }, []);

  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div className="min-h-screen flex flex-col bg-[#050508] relative overflow-hidden">
      {/* Skip navigation link for keyboard users */}
      <a
        href="#main-chat"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:px-4 focus:py-2 focus:bg-charcoal focus:text-amber-400 focus:rounded-lg focus:text-sm focus:font-mono focus:border focus:border-amber-500/30"
      >
        Skip to chat
      </a>

      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-amber-500/[0.02] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/[0.015] blur-[100px]" />
        <div className="absolute top-[40%] right-[20%] w-[30%] h-[30%] rounded-full bg-cyan-500/[0.01] blur-[80px]" />
      </div>

      <HeaderBar
        wakeWordEnabled={wakeWordEnabled}
        onToggleWakeWord={toggleWakeWord}
        showNotifications={showNotifications}
        onToggleNotifications={toggleNotifications}
        notifications={notifications}
        unreadCount={unreadCount}
        onDismiss={dismiss}
        onDismissAll={dismissAll}
        onOpenSettings={openSettings}
        identifiedSpeaker={identifiedSpeaker}
        sttLanguage={sttLanguage}
        isConnected={isConnected}
        showVisualPanel={showVisualPanel}
        onToggleVisualPanel={toggleVisualPanel}
        hasVisualContext={!!visualContext.context}
      />

      {/* Main Content — split-screen layout on tablet+ */}
      <main className="relative z-10 flex-1 flex flex-col md:flex-row px-4 sm:px-8 overflow-hidden">
        {/* Chat Column */}
        <div id="main-chat" className="flex-1 flex flex-col items-center min-w-0">
          <ChatColumn
            messages={messages}
            aiTranscript={aiTranscript}
            hasVoiceKey={hasVoiceKey}
            isTyping={isTyping}
            messagesEndRef={messagesEndRef}
            isActive={isActive}
            isAwake={isAwake}
            isSpeaking={isSpeaking}
            isListening={isListening}
            isIdentifying={speakerId.isIdentifying}
            wakeWordEnabled={wakeWordEnabled}
            greeting={greeting}
            onVoiceActivate={handleVoiceActivate}
            identifiedSpeaker={identifiedSpeaker}
          />

          <div className="w-full max-w-2xl mx-auto">
            <InputArea
              textInput={textInput}
              onTextInputChange={setTextInput}
              onSend={handleSendText}
              onKeyDown={handleKeyDown}
              isTyping={isTyping}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              showModelPicker={showModelPicker}
              onToggleModelPicker={toggleModelPicker}
              inputRef={inputRef}
            />
          </div>
        </div>

        {/* Visual Context Panel — tablet+ sidebar with toggle */}
        {showVisualPanel && (
          <div className="hidden md:block w-72 lg:w-80 xl:w-96 flex-shrink-0 sticky top-0 h-[calc(100vh-4rem)]">
            <ContextPanel
              context={visualContext.context}
              isLoading={visualContext.isLoading}
              error={visualContext.error}
              onExampleClick={(prompt) => {
                setTextInput(prompt);
                inputRef.current?.focus();
              }}
            />
          </div>
        )}
      </main>

      {/* Mobile visual context bottom sheet (< lg breakpoint) */}
      <MobileContextSheet
        context={visualContext.context}
        isLoading={visualContext.isLoading}
        error={visualContext.error}
      />

      {/* Status Bar */}
      {error && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs font-mono backdrop-blur-xl">
          {error}
        </div>
      )}

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

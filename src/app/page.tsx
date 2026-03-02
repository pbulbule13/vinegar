"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { useBrowserVoice } from "@/hooks/useBrowserVoice";
import { useWakeWord } from "@/hooks/useWakeWord";
import { useSpeakerIdentification } from "@/hooks/useSpeakerIdentification";
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
import { ToastContainer } from "@/components/toast-container";
import { useVisualContext } from "@/hooks/useVisualContext";
import { stripVisualHint } from "@/lib/visual-context-detector";
import { useSettingsStore, useVoiceStore, useToastStore, type Message } from "@/stores/app-store";

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 6) return "Late night";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  if (hour < 21) return "Good evening";
  return "Good night";
}

export default function VinegarHome() {
  // ─── Zustand Stores ───
  const settings = useSettingsStore();
  const voice = useVoiceStore();
  const addToast = useToastStore((s) => s.addToast);

  const [textInput, setTextInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const langSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Real-time notifications (reminders + suggestions)
  const { notifications, unreadCount, dismiss, dismissAll } = useNotifications();

  // Visual context panel
  const visualContext = useVisualContext({ debounceMs: 300 });

  // Speaker identification
  const handleSpeakerIdentified = useCallback(async (speaker: import("@/hooks/useSpeakerIdentification").IdentificationResult | null) => {
    voice.setIdentifiedSpeaker(speaker);
    if (speaker) {
      try {
        await fetch("/api/family", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "voice_switch", member_id: speaker.memberId }),
        });
      } catch {
        addToast("warning", "Failed to switch voice profile");
      }
    }
  }, [voice, addToast]);

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
      }).catch(() => {
        addToast("warning", "Failed to save language setting");
      });
    }, 2000);
  }, [addToast]);

  const handleLanguageChange = useCallback((lang: SupportedLanguage) => {
    settings.setSttLanguage(lang);
    syncLanguageToServer(lang);
  }, [settings, syncLanguageToServer]);

  // Client-side TTS with onSpeakEnd wired to voice hook
  const clientTTS = useClientTTS(() => {
    if (browserVoiceRef.current?.notifySpeakEnd) {
      browserVoiceRef.current.notifySpeakEnd();
    }
  });
  const browserVoiceRef = useRef<{ notifySpeakEnd: () => void } | null>(null);

  // Load settings on mount
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        settings.setHasVoiceKey(data.keySource !== "none");
      })
      .catch(() => {
        addToast("error", "Failed to load settings");
      });
    fetch("/api/settings/tts")
      .then((r) => r.json())
      .then((data) => {
        if (data.stt_language) settings.setSttLanguage(data.stt_language as SupportedLanguage);
      })
      .catch(() => {
        addToast("warning", "Failed to load voice settings");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup lang sync timer
  useEffect(() => {
    return () => {
      if (langSyncTimerRef.current) clearTimeout(langSyncTimerRef.current);
    };
  }, []);

  // Wake word detection with full sleep/wake cycle
  const {
    isAwake,
    isPassiveListening,
    startPassiveListening,
    stopPassiveListening,
  } = useWakeWord({
    wakeWord: "vinegar",
    sttLanguage: settings.sttLanguage,
    onWake: () => {
      if (!voice.isActive) {
        stopPassiveListening();
        setTimeout(() => {
          handleVoiceActivate();
        }, 200);
      }
    },
    onSleep: () => {
      if (voice.isActive) {
        stopListening();
        disconnect();
        voice.setIsActive(false);
        speakText("Going to sleep. Say Vinegar when you need me.");
        setTimeout(() => {
          if (settings.wakeWordEnabled) startPassiveListening();
        }, 1000);
      }
    },
    sleepAfterMs: 60000,
  });

  // Voice callbacks — with visual context detection for voice path
  const voiceCallbacks = {
    onTranscript: (text: string, isFinal: boolean) => {
      if (text.trim() && isFinal) {
        voice.addMessage({
          id: `user_${Date.now()}`,
          role: "user",
          text: text.trim(),
          timestamp: new Date(),
          source: "voice",
        });
        visualContext.updateFromMessage(text.trim());
      }
    },
    onAIResponse: (text: string) => {
      if (text.trim()) {
        const cleaned = stripVisualHint(text);
        visualContext.updateFromResponse(text);
        voice.addMessage({
          id: `vinegar_${Date.now()}`,
          role: "vinegar",
          text: cleaned.trim(),
          timestamp: new Date(),
          source: "voice",
        });
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
    model: settings.selectedModel,
    sttLanguage: settings.sttLanguage,
    onSpeak: (text: string) => clientTTS.speak(text),
    onSpeakEnd: () => {},
    onLanguageChange: handleLanguageChange,
    ...voiceCallbacks,
  });

  useEffect(() => {
    browserVoiceRef.current = { notifySpeakEnd: browserVoice.notifySpeakEnd };
  }, [browserVoice.notifySpeakEnd]);

  const activeVoice = settings.hasVoiceKey ? openaiVoice : browserVoice;
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
  } = activeVoice;

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voice.messages, aiTranscript, voice.isTyping]);

  const handleVoiceActivate = useCallback(async () => {
    if (voice.isActive) {
      stopListening();
      disconnect();
      voice.setIsActive(false);
      voice.setIdentifiedSpeaker(null);
      if (settings.wakeWordEnabled) {
        setTimeout(() => startPassiveListening(), 500);
      }
    } else {
      try {
        stopPassiveListening();
        await new Promise((r) => setTimeout(r, 200));
        await speakerId.identifyOnce();
        await connect();
        await startListening();
        voice.setIsActive(true);
      } catch {
        addToast("error", "Voice activation failed");
        if (settings.wakeWordEnabled) {
          setTimeout(() => startPassiveListening(), 500);
        }
      }
    }
  }, [voice, settings.wakeWordEnabled, connect, disconnect, startListening, stopListening, speakerId, startPassiveListening, stopPassiveListening, addToast]);

  const toggleWakeWord = useCallback(() => {
    if (settings.wakeWordEnabled) {
      stopPassiveListening();
      settings.setWakeWordEnabled(false);
    } else {
      startPassiveListening();
      settings.setWakeWordEnabled(true);
    }
  }, [settings, startPassiveListening, stopPassiveListening]);

  const speakText = (text: string) => {
    clientTTS.speak(text);
  };

  // Text chat with streaming SSE + offline-first approach
  const handleSendText = async () => {
    const text = textInput.trim();
    if (!text || voice.isTyping) return;

    const userMsg: Message = {
      id: `user_text_${Date.now()}`,
      role: "user",
      text,
      timestamp: new Date(),
      source: "text",
    };
    voice.addMessage(userMsg);
    setTextInput("");

    // Tier 1: Instant visual context detection from user message
    visualContext.updateFromMessage(text);

    // Detect language from typed text
    const typedLang = detectTypedLanguage(text);
    const chatLanguage = typedLang || settings.sttLanguage;
    if (typedLang && typedLang !== settings.sttLanguage) {
      handleLanguageChange(typedLang);
    }

    // Try offline response first
    const offlineResult = tryOfflineResponse(text, chatLanguage);
    if (offlineResult) {
      voice.addMessage({
        id: `vinegar_offline_${Date.now()}`,
        role: "vinegar",
        text: offlineResult.response,
        timestamp: new Date(),
        source: "offline",
      });
      return;
    }

    // Need LLM - use streaming SSE
    voice.setIsTyping(true);
    const newHistory = [...voice.chatHistory, { role: "user" as const, content: text }];
    voice.setChatHistory(newHistory);
    const streamMsgId = `vinegar_stream_${Date.now()}`;

    try {
      // Build visual context summary for LLM awareness
      const visualSummary = visualContext.context
        ? `${visualContext.context.cardType} card for ${visualContext.context.query}`
        : undefined;

      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, model: settings.selectedModel, language: chatLanguage, visualContext: visualSummary }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Stream failed" }));
        throw new Error(data.error || "Failed to get response");
      }

      voice.addMessage({
        id: streamMsgId,
        role: "vinegar",
        text: "",
        timestamp: new Date(),
        source: "text",
      });

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
            // Tool execution completed — LLM sends final clean response
            if (parsed.replaceAll && parsed.content) {
              fullResponse = parsed.content;
              voice.updateMessage(streamMsgId, fullResponse);
            } else if (parsed.clearPrevious) {
              // Tool detected — clear streamed tool_call text, show loading
              fullResponse = '';
              voice.updateMessage(streamMsgId, "Working on it...");
            } else if (parsed.toolExecution) {
              // Tool status update
              const status = parsed.toolExecution.success ? 'Done' : 'Failed';
              voice.updateMessage(streamMsgId, `Running ${parsed.toolExecution.name}... ${status}`);
            } else if (parsed.content) {
              fullResponse += parsed.content;
              voice.updateMessage(streamMsgId, fullResponse);
            }
          } catch {}
        }
      }

      if (!fullResponse) {
        voice.updateMessage(streamMsgId, "I couldn't generate a response.");
      }

      // Tier 2: Check for [visual:] hints in completed response
      visualContext.updateFromResponse(fullResponse);

      // Auto web search: if response seems like it couldn't answer, search the web
      const cantAnswerPatterns = /i don't have|i'm not sure|i cannot|i can't help with|i don't know|no information|unable to find|beyond my|outside my/i;
      if (cantAnswerPatterns.test(fullResponse) && text.length > 10) {
        visualContext.searchWeb(text);
      }

      // Also trigger web search for question-like queries that didn't use tools
      const isQuestion = /^(what|who|when|where|why|how|which|is|are|can|does|do|will|should)\b/i.test(text);
      if (isQuestion && !cantAnswerPatterns.test(fullResponse) && !visualContext.context) {
        visualContext.searchWeb(text);
      }

      // Strip [visual:] hints before storing in history
      const cleanedResponse = stripVisualHint(fullResponse);
      voice.setChatHistory([...newHistory, { role: "assistant" as const, content: cleanedResponse }].slice(-20));

      if (cleanedResponse) speakText(cleanedResponse);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect";
      voice.updateMessage(streamMsgId, `Connection issue: ${errorMsg}`);
      addToast("error", errorMsg);
    } finally {
      voice.setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendText();
    }
  };

  const greeting = useMemo(() => getGreeting(), []);

  return (
    <div className="min-h-screen flex flex-col bg-[#050508] relative overflow-hidden">
      {/* Toast notifications for errors/warnings */}
      <ToastContainer />

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
        wakeWordEnabled={settings.wakeWordEnabled}
        onToggleWakeWord={toggleWakeWord}
        showNotifications={settings.showNotifications}
        onToggleNotifications={settings.toggleNotifications}
        notifications={notifications}
        unreadCount={unreadCount}
        onDismiss={dismiss}
        onDismissAll={dismissAll}
        onOpenSettings={() => settings.setShowSettings(true)}
        identifiedSpeaker={voice.identifiedSpeaker}
        sttLanguage={settings.sttLanguage}
        isConnected={isConnected}
        showVisualPanel={settings.showVisualPanel}
        onToggleVisualPanel={settings.toggleVisualPanel}
        hasVisualContext={!!visualContext.context}
      />

      {/* Main Content — split-screen layout on tablet+ */}
      <main className="relative z-10 flex-1 flex flex-col md:flex-row px-4 sm:px-8 overflow-hidden">
        {/* Chat Column */}
        <div id="main-chat" className="flex-1 flex flex-col items-center min-w-0">
          <ChatColumn
            messages={voice.messages}
            aiTranscript={aiTranscript}
            hasVoiceKey={settings.hasVoiceKey}
            isTyping={voice.isTyping}
            messagesEndRef={messagesEndRef}
            isActive={voice.isActive}
            isAwake={isAwake}
            isSpeaking={isSpeaking}
            isListening={isListening}
            isIdentifying={speakerId.isIdentifying}
            wakeWordEnabled={settings.wakeWordEnabled}
            greeting={greeting}
            onVoiceActivate={handleVoiceActivate}
            identifiedSpeaker={voice.identifiedSpeaker}
          />

          <div className="w-full max-w-2xl mx-auto">
            <InputArea
              textInput={textInput}
              onTextInputChange={setTextInput}
              onSend={handleSendText}
              onKeyDown={handleKeyDown}
              isTyping={voice.isTyping}
              selectedModel={settings.selectedModel}
              onModelChange={settings.setSelectedModel}
              showModelPicker={settings.showModelPicker}
              onToggleModelPicker={settings.toggleModelPicker}
              inputRef={inputRef}
            />
          </div>
        </div>

        {/* Browse & Search Panel — 50/50 split on tablet+ */}
        {settings.showVisualPanel && (
          <div className="hidden md:block md:w-1/2 lg:w-1/2 xl:w-1/2 flex-shrink-0 sticky top-0 h-[calc(100vh-4rem)]">
            <ContextPanel
              context={visualContext.context}
              isLoading={visualContext.isLoading}
              error={visualContext.error}
              onExampleClick={(prompt) => {
                setTextInput(prompt);
                inputRef.current?.focus();
              }}
              onWebSearch={(query) => visualContext.searchWeb(query)}
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

      <SettingsModal isOpen={settings.showSettings} onClose={() => settings.setShowSettings(false)} />
    </div>
  );
}

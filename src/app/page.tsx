"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRealtimeVoice } from "@/hooks/useRealtimeVoice";
import { useBrowserVoice } from "@/hooks/useBrowserVoice";
import { useWakeWord } from "@/hooks/useWakeWord";
import { tryOfflineResponse } from "@/lib/offline-commands";
import {
  Mic, MicOff, Power, Zap, Brain, Send, Loader2, ChevronDown,
  LayoutDashboard, Settings, Volume2, WifiOff, Wifi, Moon, Sun,
} from "lucide-react";
import { SettingsModal } from "@/components/settings-modal";
import Link from "next/link";

const TEXT_MODELS = [
  { group: "Google", models: [
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tag: "Fast" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tag: "Smart" },
  ]},
  { group: "OpenAI", models: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini", tag: "Fast" },
  ]},
  { group: "Meta", models: [
    { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout", tag: "Fast" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", tag: "Versatile" },
  ]},
];

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

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

  // Check if voice key is available
  useEffect(() => {
    fetch("/api/settings").then(r => r.json()).then(data => {
      setHasVoiceKey(data.keySource !== "none");
    }).catch(() => {});
  }, []);

  // Wake word detection
  const {
    isAwake,
    isPassiveListening,
    startPassiveListening,
    stopPassiveListening,
    wake,
    sleep: sleepWakeWord,
  } = useWakeWord({
    wakeWord: "vinegar",
    onWake: () => {
      // Auto-activate voice when wake word detected
      if (!isActive) {
        handleVoiceActivate();
      }
    },
    sleepAfterMs: 45000,
  });

  // Voice callbacks - onTranscript gets (text, isFinal)
  const voiceCallbacks = {
    onTranscript: (text: string, isFinal: boolean) => {
      if (text.trim() && isFinal) {
        setMessages((prev) => [
          ...prev,
          { id: `user_${Date.now()}`, role: "user", text: text.trim(), timestamp: new Date(), source: "voice" },
        ]);
      }
    },
    onAIResponse: (text: string) => {
      if (text.trim()) {
        setMessages((prev) => [
          ...prev,
          { id: `vinegar_${Date.now()}`, role: "vinegar", text: text.trim(), timestamp: new Date(), source: "voice" },
        ]);
      }
    },
  };

  // OpenAI Realtime voice (premium - needs OpenAI key)
  const openaiVoice = useRealtimeVoice({
    voice: "ash",
    model: "gpt-4o-mini-realtime-preview-2024-12-17",
    ...voiceCallbacks,
  });

  // Browser-native voice (free - uses Web Speech API + Euri)
  const browserVoice = useBrowserVoice({
    model: selectedModel,
    ...voiceCallbacks,
  });

  // Use OpenAI voice if key available, otherwise browser voice
  const voice = hasVoiceKey ? openaiVoice : browserVoice;
  const {
    isConnected,
    isListening,
    isSpeaking,
    userTranscript,
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
    } else {
      try {
        await connect();
        await startListening();
        setIsActive(true);
      } catch (err) {
        console.error("Failed to start:", err);
      }
    }
  }, [isActive, connect, disconnect, startListening, stopListening]);

  const toggleWakeWord = () => {
    if (wakeWordEnabled) {
      stopPassiveListening();
      setWakeWordEnabled(false);
    } else {
      startPassiveListening();
      setWakeWordEnabled(true);
    }
  };

  // Speak any text response via TTS
  const speakText = async (text: string) => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => {});
    } catch {}
  };

  // Text chat with offline-first approach
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

    // Try offline response first
    const offlineResult = tryOfflineResponse(text);
    if (offlineResult) {
      setMessages((prev) => [
        ...prev,
        { id: `vinegar_offline_${Date.now()}`, role: "vinegar", text: offlineResult.response, timestamp: new Date(), source: "offline" },
      ]);
      return;
    }

    // Need LLM
    setIsTyping(true);
    const newHistory = [...chatHistory, { role: "user" as const, content: text }];
    setChatHistory(newHistory);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory, model: selectedModel }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get response");

      const aiText = data.content || "I couldn't generate a response.";
      setMessages((prev) => [
        ...prev,
        { id: `vinegar_text_${Date.now()}`, role: "vinegar", text: aiText, timestamp: new Date(), source: "text" },
      ]);
      const updatedHistory = [...newHistory, { role: "assistant" as const, content: aiText }];
      setChatHistory(updatedHistory.slice(-20));

      // Always speak back the response
      speakText(aiText);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Failed to connect";
      setMessages((prev) => [
        ...prev,
        { id: `error_${Date.now()}`, role: "vinegar", text: `Connection issue: ${errorMsg}`, timestamp: new Date(), source: "text" },
      ]);
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

  const currentTime = new Date();

  return (
    <div className="min-h-screen flex flex-col bg-[#050508] relative overflow-hidden">
      {/* Ambient background effects */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-amber-500/[0.02] blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/[0.015] blur-[100px]" />
        <div className="absolute top-[40%] right-[20%] w-[30%] h-[30%] rounded-full bg-cyan-500/[0.01] blur-[80px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 px-4 pt-4 pb-2 sm:px-8">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="vinegar-logo w-9 h-9 rounded-xl flex items-center justify-center">
              <span className="text-lg font-bold">V</span>
            </div>
            <div>
              <h1 className="font-orbitron text-sm tracking-[0.2em] text-white/90">VINEGAR</h1>
              <p className="text-[10px] text-white/30 font-mono tracking-wider">HOME ASSISTANT</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Wake word toggle */}
            <button
              onClick={toggleWakeWord}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono tracking-wider transition-all ${
                wakeWordEnabled
                  ? "bg-amber-500/15 border border-amber-500/30 text-amber-400"
                  : "bg-white/5 border border-white/10 text-white/40"
              }`}
              title={wakeWordEnabled ? 'Wake word active - say "Vinegar"' : 'Enable wake word'}
            >
              {wakeWordEnabled ? <Volume2 className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}
              {wakeWordEnabled ? "WAKE ON" : "WAKE OFF"}
            </button>

            <Link href="/dashboard" className="nav-button" title="Dashboard">
              <LayoutDashboard className="w-4 h-4" />
            </Link>
            <button onClick={() => setShowSettings(true)} className="nav-button" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-white/20'}`} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col items-center px-4 sm:px-8">
        <div className="w-full max-w-2xl flex-1 flex flex-col">

          {/* Messages */}
          {messages.length > 0 ? (
            <div className="flex-1 overflow-y-auto py-4 space-y-3 scrollbar-thin">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`message-appear flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[85%] ${msg.role === "user" ? "user-bubble" : "vinegar-bubble"}`}>
                    <p className="text-sm leading-relaxed">{msg.text}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[9px] text-white/20 font-mono">{formatTime(msg.timestamp)}</span>
                      {msg.source === "offline" && (
                        <span className="text-[9px] text-cyan-400/40 font-mono flex items-center gap-0.5">
                          <WifiOff className="w-2.5 h-2.5" /> offline
                        </span>
                      )}
                      {msg.source === "text" && msg.role === "vinegar" && (
                        <span className="text-[9px] text-amber-400/30 font-mono flex items-center gap-0.5">
                          <Zap className="w-2.5 h-2.5" /> AI
                        </span>
                      )}
                      {msg.source === "voice" && (
                        <span className="text-[9px] text-purple-400/30 font-mono flex items-center gap-0.5">
                          <Mic className="w-2.5 h-2.5" /> voice
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {/* Live voice transcript - only show for OpenAI realtime (streams incrementally) */}
              {aiTranscript && hasVoiceKey && (
                <div className="flex justify-start message-appear">
                  <div className="vinegar-bubble">
                    <p className="text-sm italic text-white/60">{aiTranscript}</p>
                  </div>
                </div>
              )}

              {/* Typing indicator */}
              {isTyping && (
                <div className="flex justify-start message-appear">
                  <div className="vinegar-bubble">
                    <div className="flex items-center gap-2">
                      <div className="typing-dots">
                        <span /><span /><span />
                      </div>
                      <span className="text-xs text-white/30">thinking</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          ) : (
            /* Empty state - show orb */
            <div className="flex-1 flex flex-col items-center justify-center gap-8">
              {/* Central Orb */}
              <div className="relative flex items-center justify-center">
                {/* Outer rings */}
                {(isActive || isAwake) && (
                  <>
                    <div className="orbit-ring-outer" />
                    <div className="orbit-ring-inner" />
                    <div className="orbit-ring-glow" />
                  </>
                )}

                <button
                  onClick={handleVoiceActivate}
                  className={`vinegar-orb ${
                    isSpeaking ? "orb-speaking" :
                    isListening ? "orb-listening" :
                    isAwake ? "orb-awake" :
                    "orb-idle"
                  }`}
                >
                  <div className="flex flex-col items-center gap-3">
                    {isActive ? (
                      <>
                        {isSpeaking ? (
                          <Brain className="w-10 h-10 text-amber-400" />
                        ) : isListening ? (
                          <Mic className="w-10 h-10 text-amber-400 animate-pulse" />
                        ) : (
                          <Power className="w-10 h-10 text-amber-400" />
                        )}
                        <span className="text-[10px] font-mono text-amber-400/80 tracking-[0.3em]">
                          {isSpeaking ? "SPEAKING" : isListening ? "LISTENING" : "CONNECTED"}
                        </span>
                      </>
                    ) : isAwake ? (
                      <>
                        <Mic className="w-10 h-10 text-amber-400/80" />
                        <span className="text-[10px] font-mono text-amber-300/60 tracking-[0.3em]">AWAKE</span>
                      </>
                    ) : (
                      <>
                        <Power className="w-10 h-10 text-white/30" />
                        <span className="text-[10px] font-mono text-white/20 tracking-[0.2em]">TAP TO START</span>
                      </>
                    )}
                  </div>
                </button>
              </div>

              {/* Welcome text */}
              <div className="text-center space-y-2">
                <h2 className="text-xl font-light text-white/80">
                  {getGreeting()}
                </h2>
                <p className="text-sm text-white/30">
                  {wakeWordEnabled
                    ? 'Say "Vinegar" to activate, or tap the orb'
                    : "Tap the orb for voice, or type below"}
                </p>
                {isAwake && !isActive && (
                  <p className="text-xs text-amber-400/60 animate-pulse">
                    Wake word detected — activating...
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Input Area */}
          <div className="pb-4 pt-2">
            {/* Model selector */}
            <div className="relative mb-2">
              <button
                onClick={() => setShowModelPicker(!showModelPicker)}
                className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-mono text-white/30 hover:text-amber-400/60 transition-colors"
              >
                <Zap className="w-2.5 h-2.5" />
                {TEXT_MODELS.flatMap(g => g.models).find(m => m.id === selectedModel)?.name || selectedModel}
                <ChevronDown className={`w-2.5 h-2.5 transition-transform ${showModelPicker ? 'rotate-180' : ''}`} />
              </button>

              {showModelPicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowModelPicker(false)} />
                  <div className="absolute bottom-full left-0 mb-1 z-50 w-64 model-picker">
                    {TEXT_MODELS.map((group) => (
                      <div key={group.group}>
                        <div className="px-3 py-1.5 text-[9px] font-mono text-white/20 uppercase tracking-[0.2em] bg-black/30">
                          {group.group}
                        </div>
                        {group.models.map((model) => (
                          <button
                            key={model.id}
                            onClick={() => { setSelectedModel(model.id); setShowModelPicker(false); }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs transition-colors ${
                              selectedModel === model.id
                                ? 'bg-amber-500/10 text-amber-400'
                                : 'text-white/50 hover:bg-white/5 hover:text-white/70'
                            }`}
                          >
                            <span>{model.name}</span>
                            <span className="text-[9px] font-mono text-white/20">{model.tag}</span>
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Text input */}
            <div className="input-container">
              <input
                ref={inputRef}
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask Vinegar anything..."
                disabled={isTyping}
                className="flex-1 bg-transparent text-sm text-white/90 placeholder-white/20 px-4 py-3 focus:outline-none disabled:opacity-40"
              />
              <button
                onClick={handleSendText}
                disabled={!textInput.trim() || isTyping}
                className="send-button"
              >
                {isTyping ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>
      </main>

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

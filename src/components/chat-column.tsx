"use client";

import { memo, type Ref } from "react";
import {
  Mic, Power, Zap, Brain, User, WifiOff,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "vinegar";
  text: string;
  timestamp: Date;
  source?: "voice" | "text" | "offline";
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface ChatColumnProps {
  messages: Message[];
  aiTranscript: string;
  hasVoiceKey: boolean;
  isTyping: boolean;
  messagesEndRef: Ref<HTMLDivElement>;
  // Orb / empty state props
  isActive: boolean;
  isAwake: boolean;
  isSpeaking: boolean;
  isListening: boolean;
  isIdentifying: boolean;
  wakeWordEnabled: boolean;
  greeting: string;
  onVoiceActivate: () => void;
  identifiedSpeaker: { name: string } | null;
}

export const ChatColumn = memo(function ChatColumn({
  messages,
  aiTranscript,
  hasVoiceKey,
  isTyping,
  messagesEndRef,
  isActive,
  isAwake,
  isSpeaking,
  isListening,
  isIdentifying,
  wakeWordEnabled,
  greeting,
  onVoiceActivate,
}: ChatColumnProps) {
  return (
    <div className="w-full max-w-2xl mx-auto flex-1 flex flex-col min-w-0">
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

          {/* Live voice transcript - only for OpenAI realtime */}
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
            {(isActive || isAwake) && (
              <>
                <div className="orbit-ring-outer" />
                <div className="orbit-ring-inner" />
                <div className="orbit-ring-glow" />
              </>
            )}

            <button
              onClick={onVoiceActivate}
              disabled={isIdentifying}
              className={`vinegar-orb ${
                isIdentifying ? "orb-listening" :
                isSpeaking ? "orb-speaking" :
                isListening ? "orb-listening" :
                isAwake ? "orb-awake" :
                "orb-idle"
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                {isIdentifying ? (
                  <>
                    <User className="w-10 h-10 text-cyan-400 animate-pulse" />
                    <span className="text-[10px] font-mono text-cyan-400/80 tracking-[0.3em]">
                      IDENTIFYING
                    </span>
                  </>
                ) : isActive ? (
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
              {greeting}
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
    </div>
  );
});

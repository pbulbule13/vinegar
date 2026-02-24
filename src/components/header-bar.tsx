"use client";

import { memo } from "react";
import {
  MicOff, Volume2, Bell, LayoutDashboard, Settings, User, Eye, EyeOff,
} from "lucide-react";
import Link from "next/link";
import type { SupportedLanguage } from "@/types/language";

interface Notification {
  id: string;
  type: string;
  message: string;
  priority?: string;
  dismissed?: boolean;
}

interface HeaderBarProps {
  wakeWordEnabled: boolean;
  onToggleWakeWord: () => void;
  showNotifications: boolean;
  onToggleNotifications: () => void;
  notifications: Notification[];
  unreadCount: number;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
  onOpenSettings: () => void;
  identifiedSpeaker: { name: string } | null;
  sttLanguage: SupportedLanguage;
  isConnected: boolean;
  // Visual panel toggle
  showVisualPanel?: boolean;
  onToggleVisualPanel?: () => void;
  hasVisualContext?: boolean;
}

export const HeaderBar = memo(function HeaderBar({
  wakeWordEnabled,
  onToggleWakeWord,
  showNotifications,
  onToggleNotifications,
  notifications,
  unreadCount,
  onDismiss,
  onDismissAll,
  onOpenSettings,
  identifiedSpeaker,
  sttLanguage,
  isConnected,
  showVisualPanel,
  onToggleVisualPanel,
  hasVisualContext,
}: HeaderBarProps) {
  return (
    <>
      <header className="relative z-10 px-4 pt-4 pb-2 sm:px-8">
        <div className="max-w-full mx-auto flex items-center justify-between">
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
              onClick={onToggleWakeWord}
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

            {/* Notification bell */}
            <button
              onClick={onToggleNotifications}
              className="nav-button relative"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-500 rounded-full text-[8px] font-bold text-black flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>

            {/* Visual panel toggle */}
            {onToggleVisualPanel && (
              <button
                onClick={onToggleVisualPanel}
                className={`nav-button relative ${showVisualPanel ? 'text-amber-400' : ''}`}
                title={showVisualPanel ? 'Hide visual panel' : 'Show visual panel'}
              >
                {showVisualPanel ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                {hasVisualContext && !showVisualPanel && (
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                )}
              </button>
            )}

            <Link href="/dashboard" className="nav-button" title="Dashboard">
              <LayoutDashboard className="w-4 h-4" />
            </Link>
            <button onClick={onOpenSettings} className="nav-button" title="Settings">
              <Settings className="w-4 h-4" />
            </button>
            {/* Speaker badge */}
            {identifiedSpeaker && (
              <span className="flex items-center gap-1 text-[9px] font-mono text-cyan-400/60 tracking-wider">
                <User className="w-2.5 h-2.5" />
                {identifiedSpeaker.name}
              </span>
            )}
            {/* Language indicator */}
            {sttLanguage !== "en-US" && (
              <span className="text-[9px] font-mono text-amber-400/50 tracking-wider">
                {sttLanguage === "hi-IN" ? "HI" : sttLanguage === "mr-IN" ? "MR" : "EN"}
              </span>
            )}
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]' : 'bg-white/20'}`} />
          </div>
        </div>
      </header>

      {/* Notification Panel */}
      {showNotifications && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggleNotifications} />
          <div className="fixed top-14 right-4 z-50 w-80 max-h-96 overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a0f]/95 backdrop-blur-xl shadow-2xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
              <span className="text-xs font-mono text-white/50 tracking-wider">NOTIFICATIONS</span>
              {unreadCount > 0 && (
                <button onClick={onDismissAll} className="text-[10px] text-amber-400/60 hover:text-amber-400">
                  Dismiss all
                </button>
              )}
            </div>
            {notifications.filter(n => !n.dismissed).length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-white/20">No notifications</div>
            ) : (
              notifications.filter(n => !n.dismissed).map(n => (
                <div
                  key={n.id}
                  className={`px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${
                    n.priority === "high" ? "border-l-2 border-l-amber-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <span className={`text-[9px] font-mono uppercase tracking-wider ${
                        n.type === "reminder" ? "text-amber-400/60" : "text-cyan-400/60"
                      }`}>
                        {n.type}
                      </span>
                      <p className="text-xs text-white/70 mt-0.5">{n.message}</p>
                    </div>
                    <button
                      onClick={() => onDismiss(n.id)}
                      className="text-white/20 hover:text-white/50 text-xs mt-0.5"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </>
  );
});

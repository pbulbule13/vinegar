/**
 * Zustand App Store
 * Single source of truth for app-wide state.
 * Replaces scattered useState calls in page.tsx.
 */

import { create } from 'zustand';
import type { SupportedLanguage } from '@/types/language';
import type { IdentificationResult } from '@/hooks/useSpeakerIdentification';

// ─── Toast Notifications (error feedback system) ───

export interface Toast {
  id: string;
  type: 'error' | 'warning' | 'success' | 'info';
  message: string;
  timestamp: number;
}

interface ToastSlice {
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  dismissToast: (id: string) => void;
}

export const useToastStore = create<ToastSlice>((set) => ({
  toasts: [],
  addToast: (type, message) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-4), { id, type, message, timestamp: Date.now() }],
    }));
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, 5000);
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));

// ─── Settings Store ───

interface SettingsSlice {
  sttLanguage: SupportedLanguage;
  selectedModel: string;
  hasVoiceKey: boolean;
  wakeWordEnabled: boolean;
  showSettings: boolean;
  showNotifications: boolean;
  showVisualPanel: boolean;
  showModelPicker: boolean;
  setSttLanguage: (lang: SupportedLanguage) => void;
  setSelectedModel: (model: string) => void;
  setHasVoiceKey: (has: boolean) => void;
  setWakeWordEnabled: (enabled: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowNotifications: (show: boolean) => void;
  setShowVisualPanel: (show: boolean) => void;
  setShowModelPicker: (show: boolean) => void;
  toggleNotifications: () => void;
  toggleVisualPanel: () => void;
  toggleModelPicker: () => void;
}

export const useSettingsStore = create<SettingsSlice>((set) => ({
  sttLanguage: 'en-US',
  selectedModel: 'gemini-2.5-flash',
  hasVoiceKey: false,
  wakeWordEnabled: false,
  showSettings: false,
  showNotifications: false,
  showVisualPanel: true,
  showModelPicker: false,
  setSttLanguage: (lang) => set({ sttLanguage: lang }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setHasVoiceKey: (has) => set({ hasVoiceKey: has }),
  setWakeWordEnabled: (enabled) => set({ wakeWordEnabled: enabled }),
  setShowSettings: (show) => set({ showSettings: show }),
  setShowNotifications: (show) => set({ showNotifications: show }),
  setShowVisualPanel: (show) => set({ showVisualPanel: show }),
  setShowModelPicker: (show) => set({ showModelPicker: show }),
  toggleNotifications: () => set((s) => ({ showNotifications: !s.showNotifications })),
  toggleVisualPanel: () => set((s) => ({ showVisualPanel: !s.showVisualPanel })),
  toggleModelPicker: () => set((s) => ({ showModelPicker: !s.showModelPicker })),
}));

// ─── Data Cache Store (session-level caching for frequently fetched data) ───

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

interface DataCacheSlice {
  familyMembers: CacheEntry<Array<{ id: string; name: string; role: string; age: number | null; is_active: boolean }>> | null;
  setFamilyMembers: (members: Array<{ id: string; name: string; role: string; age: number | null; is_active: boolean }>) => void;
  getFamilyMembers: () => Array<{ id: string; name: string; role: string; age: number | null; is_active: boolean }> | null;
  invalidateFamily: () => void;
}

const CACHE_TTL = 60_000; // 1 minute

export const useDataCacheStore = create<DataCacheSlice>((set, get) => ({
  familyMembers: null,
  setFamilyMembers: (members) => set({ familyMembers: { data: members, fetchedAt: Date.now() } }),
  getFamilyMembers: () => {
    const entry = get().familyMembers;
    if (!entry) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL) return null;
    return entry.data;
  },
  invalidateFamily: () => set({ familyMembers: null }),
}));

// ─── Voice/Chat Store ───

export interface Message {
  id: string;
  role: 'user' | 'vinegar';
  text: string;
  timestamp: Date;
  source?: 'voice' | 'text' | 'offline';
}

interface VoiceSlice {
  isActive: boolean;
  isTyping: boolean;
  identifiedSpeaker: IdentificationResult | null;
  messages: Message[];
  chatHistory: { role: 'user' | 'assistant'; content: string }[];
  setIsActive: (active: boolean) => void;
  setIsTyping: (typing: boolean) => void;
  setIdentifiedSpeaker: (speaker: IdentificationResult | null) => void;
  addMessage: (msg: Message) => void;
  updateMessage: (id: string, text: string) => void;
  addToChatHistory: (entry: { role: 'user' | 'assistant'; content: string }) => void;
  setChatHistory: (history: { role: 'user' | 'assistant'; content: string }[]) => void;
}

export const useVoiceStore = create<VoiceSlice>((set) => ({
  isActive: false,
  isTyping: false,
  identifiedSpeaker: null,
  messages: [],
  chatHistory: [],
  setIsActive: (active) => set({ isActive: active }),
  setIsTyping: (typing) => set({ isTyping: typing }),
  setIdentifiedSpeaker: (speaker) => set({ identifiedSpeaker: speaker }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  updateMessage: (id, text) =>
    set((s) => ({
      messages: s.messages.map((m) => (m.id === id ? { ...m, text } : m)),
    })),
  addToChatHistory: (entry) =>
    set((s) => ({
      chatHistory: [...s.chatHistory, entry].slice(-20),
    })),
  setChatHistory: (history) => set({ chatHistory: history }),
}));

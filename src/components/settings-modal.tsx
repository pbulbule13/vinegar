"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Settings, X, Key, Check, AlertCircle, MessageSquare, Globe, Volume2, MapPin, Users, Mic, Trash2 } from "lucide-react";
import { VoiceEnrollment } from "@/components/voice-enrollment";
import { useSpeakerIdentification } from "@/hooks/useSpeakerIdentification";
import { useToastStore } from "@/stores/app-store";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTTSSettingsChange?: () => void;
}

interface TTSData {
  tts_language: string;
  tts_speed: string;
  tts_pitch: string;
  tts_voice: string;
  stt_language: string;
}

interface LocationData {
  home_location: string;
  work_location: string;
  home_zip: string;
  weather_city: string;
}

const LANGUAGE_OPTIONS = [
  { value: "en-US", label: "English (US)", flag: "US" },
  { value: "en-IN", label: "English (India)", flag: "IN" },
  { value: "hi-IN", label: "Hindi", flag: "HI" },
  { value: "mr-IN", label: "Marathi", flag: "MR" },
  { value: "en-GB", label: "English (UK)", flag: "GB" },
  { value: "en-AU", label: "English (AU)", flag: "AU" },
];

export function SettingsModal({ isOpen, onClose, onTTSSettingsChange }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [euriKey, setEuriKey] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [keySource, setKeySource] = useState<"none" | "user" | "server">("none");
  const [euriKeySource, setEuriKeySource] = useState<"none" | "user" | "server">("none");
  const [message, setMessage] = useState("");

  // TTS settings
  const [ttsLang, setTtsLang] = useState("en-US");
  const [ttsSpeed, setTtsSpeed] = useState(1.2);
  const [ttsPitch, setTtsPitch] = useState(1.0);
  const [sttLang, setSttLang] = useState("en-US");
  const [linkLangs, setLinkLangs] = useState(true);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState("");

  // Location settings
  const [homeLoc, setHomeLoc] = useState("");
  const [workLoc, setWorkLoc] = useState("");
  const [homeZip, setHomeZip] = useState("");
  const [weatherCity, setWeatherCity] = useState("");

  // Voice profiles
  const [familyMembers, setFamilyMembers] = useState<{ id: string; name: string; role: string; voiceEnrolled: boolean }[]>([]);
  const [enrollingMember, setEnrollingMember] = useState<{ id: string; name: string; role: string } | null>(null);
  const speakerId = useSpeakerIdentification();
  const addToast = useToastStore((s) => s.addToast);

  // Load voices from browser
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const loadVoices = () => setVoices(window.speechSynthesis.getVoices());
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // Filtered voices for selected language
  const filteredVoices = voices.filter((v) =>
    v.lang.startsWith(ttsLang) || v.lang.startsWith(ttsLang.split("-")[0])
  );

  // Load all settings in a single request when modal opens
  useEffect(() => {
    if (!isOpen) return;

    fetch("/api/settings/all").then(r => r.json()).then(data => {
      // API keys
      if (data.keys) {
        setKeySource(data.keys.keySource);
        setEuriKeySource(data.keys.euri?.keySource || "none");
      }
      // TTS
      if (data.tts) {
        if (data.tts.tts_language) setTtsLang(data.tts.tts_language);
        if (data.tts.tts_speed) setTtsSpeed(parseFloat(data.tts.tts_speed) || 1.2);
        if (data.tts.tts_pitch) setTtsPitch(parseFloat(data.tts.tts_pitch) || 1.0);
        if (data.tts.tts_voice) setSelectedVoice(data.tts.tts_voice);
        if (data.tts.stt_language) setSttLang(data.tts.stt_language);
      }
      // Location
      if (data.location) {
        setHomeLoc(data.location.home_location || "");
        setWorkLoc(data.location.work_location || "");
        setHomeZip(data.location.home_zip || "");
        setWeatherCity(data.location.weather_city || "");
      }
      // Family members
      if (data.familyMembers) {
        setFamilyMembers(data.familyMembers);
      }
    }).catch(() => addToast("error", "Failed to load settings"));
  }, [isOpen]);

  // Save TTS settings (debounced)
  const saveTTSSettings = useCallback(async (patch: Partial<TTSData>) => {
    try {
      await fetch("/api/settings/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      onTTSSettingsChange?.();
    } catch {
      addToast("error", "Failed to save voice settings");
    }
  }, [onTTSSettingsChange, addToast]);

  // Delete voice profile
  const handleDeleteVoice = useCallback(async (memberId: string) => {
    try {
      await fetch("/api/family", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_voice", member_id: memberId }),
      });
      setFamilyMembers(prev => prev.map(m => m.id === memberId ? { ...m, voiceEnrolled: false } : m));
    } catch {
      addToast("error", "Failed to delete voice profile");
    }
  }, [addToast]);

  const handleEnrollComplete = useCallback(() => {
    setEnrollingMember(null);
    // Refresh family members list
    fetch("/api/family").then(r => r.json()).then(data => {
      setFamilyMembers((data.members || []).map((m: Record<string, unknown>) => ({
        id: m.id as string,
        name: m.name as string,
        role: m.role as string,
        voiceEnrolled: !!m.voiceEnrolled,
      })));
    }).catch(() => addToast("warning", "Failed to refresh family list"));
  }, [addToast]);

  // Save location settings
  const saveLocationSettings = useCallback(async (patch: Partial<LocationData>) => {
    try {
      await fetch("/api/settings/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      addToast("error", "Failed to save location settings");
    }
  }, [addToast]);

  const handleTTSLangChange = (lang: string) => {
    setTtsLang(lang);
    setSelectedVoice("");
    const patch: Partial<TTSData> = { tts_language: lang, tts_voice: "" };
    if (linkLangs) {
      setSttLang(lang);
      patch.stt_language = lang;
    }
    saveTTSSettings(patch);
  };

  const handleSpeedChange = (speed: number) => {
    setTtsSpeed(speed);
    saveTTSSettings({ tts_speed: String(speed) });
  };

  const handlePitchChange = (pitch: number) => {
    setTtsPitch(pitch);
    saveTTSSettings({ tts_pitch: String(pitch) });
  };

  const handleVoiceChange = (voiceName: string) => {
    setSelectedVoice(voiceName);
    saveTTSSettings({ tts_voice: voiceName });
  };

  const handleSTTLangChange = (lang: string) => {
    setSttLang(lang);
    saveTTSSettings({ stt_language: lang });
  };

  const testVoice = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const phrases: Record<string, string> = {
      "en-US": "Hello, I'm Vinegar, your home assistant.",
      "en-IN": "Hello, I'm Vinegar, your home assistant.",
      "hi-IN": "Namaste, main Vinegar hoon, aapka ghar sahayak.",
      "mr-IN": "Namaskar, mi Vinegar aahe, tumcha ghar sahayak.",
      "en-GB": "Hello, I'm Vinegar, your home assistant.",
      "en-AU": "Hello, I'm Vinegar, your home assistant.",
    };
    const utterance = new SpeechSynthesisUtterance(phrases[ttsLang] || phrases["en-US"]);
    utterance.rate = ttsSpeed;
    utterance.pitch = ttsPitch;
    utterance.lang = ttsLang;
    if (selectedVoice) {
      const voice = voices.find(v => v.name === selectedVoice);
      if (voice) utterance.voice = voice;
    }
    window.speechSynthesis.speak(utterance);
  };

  const handleSaveOpenAI = async () => {
    if (!apiKey.trim()) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openai_api_key: apiKey.trim() }),
      });
      if (res.ok) {
        setStatus("saved"); setMessage("OpenAI key saved!"); setKeySource("user"); setApiKey("");
        setTimeout(() => setStatus("idle"), 3000);
      } else { setStatus("error"); setMessage("Failed to save"); }
    } catch { setStatus("error"); setMessage("Network error"); }
  };

  const handleSaveEuri = async () => {
    if (!euriKey.trim()) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ euri_api_key: euriKey.trim() }),
      });
      if (res.ok) {
        setStatus("saved"); setMessage("Euri key saved!"); setEuriKeySource("user"); setEuriKey("");
        setTimeout(() => setStatus("idle"), 3000);
      } else { setStatus("error"); setMessage("Failed to save"); }
    } catch { setStatus("error"); setMessage("Network error"); }
  };

  const handleRemoveOpenAI = async () => {
    try {
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openai_api_key: null }) });
      setKeySource("none"); setMessage("OpenAI key removed"); setStatus("saved");
      setTimeout(() => { setStatus("idle"); setMessage(""); }, 2000);
    } catch { setMessage("Failed to remove key"); }
  };

  const handleRemoveEuri = async () => {
    try {
      await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ euri_api_key: null }) });
      setEuriKeySource("none"); setMessage("Euri key removed"); setStatus("saved");
      setTimeout(() => { setStatus("idle"); setMessage(""); }, 2000);
    } catch { setMessage("Failed to remove key"); }
  };

  // Focus trapping and Escape key
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Focus trap
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Focus the close button on open
    const closeBtn = modalRef.current?.querySelector<HTMLElement>('[aria-label="Close settings"]');
    closeBtn?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Settings">
      <div ref={modalRef} className="w-full max-w-md bg-[#141418] border border-[#3a3a44] rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#3a3a44]/50">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-vinegar-gold" />
            <h2 className="font-orbitron text-sm tracking-wider text-text-primary">SETTINGS</h2>
          </div>
          <button onClick={onClose} aria-label="Close settings" className="p-1.5 rounded-lg hover:bg-[#1e1e24] transition-colors">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* ─── Voice & Language Section ─── */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-text-muted font-jetbrains tracking-wider">
              <Globe className="w-3.5 h-3.5" />
              VOICE & LANGUAGE
            </label>

            {/* TTS Language */}
            <div className="space-y-1">
              <span className="text-[11px] text-white/40">Speaking Language</span>
              <select
                value={ttsLang}
                onChange={(e) => handleTTSLangChange(e.target.value)}
                className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary focus:outline-none focus:border-vinegar-gold/50"
              >
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.value} value={l.value}>{l.flag} {l.label}</option>
                ))}
              </select>
            </div>

            {/* Voice Picker */}
            {filteredVoices.length > 0 && (
              <div className="space-y-1">
                <span className="text-[11px] text-white/40">Voice ({filteredVoices.length} available)</span>
                <select
                  value={selectedVoice}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary focus:outline-none focus:border-vinegar-gold/50"
                >
                  <option value="">Auto (best match)</option>
                  {filteredVoices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} {v.localService ? "(local)" : "(network)"}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {filteredVoices.length === 0 && voices.length > 0 && (
              <p className="text-[10px] text-amber-400/60">
                No voices found for {LANGUAGE_OPTIONS.find(l => l.value === ttsLang)?.label}.
                Will use fallback voice.
              </p>
            )}

            {/* Speed Slider */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-[11px] text-white/40">Speed</span>
                <span className="text-[11px] text-vinegar-gold font-jetbrains">{ttsSpeed.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min="0.8"
                max="2.0"
                step="0.1"
                value={ttsSpeed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#3a3a44] rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-[9px] text-white/20">
                <span>Slow</span><span>Normal</span><span>Fast</span>
              </div>
            </div>

            {/* Pitch Slider */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-[11px] text-white/40">Pitch</span>
                <span className="text-[11px] text-vinegar-gold font-jetbrains">{ttsPitch.toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.0"
                step="0.1"
                value={ttsPitch}
                onChange={(e) => handlePitchChange(parseFloat(e.target.value))}
                className="w-full h-1.5 bg-[#3a3a44] rounded-lg appearance-none cursor-pointer accent-amber-500"
              />
            </div>

            {/* Test Voice Button */}
            <button
              onClick={testVoice}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-vinegar-gold/10 border border-vinegar-gold/30 text-vinegar-gold rounded-lg text-xs hover:bg-vinegar-gold/20 transition-all"
            >
              <Volume2 className="w-3.5 h-3.5" />
              Test Voice
            </button>

            {/* STT Language */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/40">Listening Language</span>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={linkLangs}
                    onChange={(e) => setLinkLangs(e.target.checked)}
                    className="w-3 h-3 rounded accent-amber-500"
                  />
                  <span className="text-[10px] text-white/30">Link to speaking</span>
                </label>
              </div>
              {!linkLangs && (
                <select
                  value={sttLang}
                  onChange={(e) => handleSTTLangChange(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary focus:outline-none focus:border-vinegar-gold/50"
                >
                  {LANGUAGE_OPTIONS.map((l) => (
                    <option key={l.value} value={l.value}>{l.flag} {l.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="border-t border-[#3a3a44]/30" />

          {/* ─── Voice Profiles Section ─── */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-text-muted font-jetbrains tracking-wider">
              <Users className="w-3.5 h-3.5" />
              VOICE PROFILES
            </label>

            {enrollingMember ? (
              <VoiceEnrollment
                familyMember={enrollingMember}
                onComplete={handleEnrollComplete}
                onCancel={() => setEnrollingMember(null)}
                enrollCapture={speakerId.enrollCapture}
              />
            ) : familyMembers.length === 0 ? (
              <p className="text-[10px] text-white/30 py-2">
                Add family members first to enable voice identification.
              </p>
            ) : (
              <div className="space-y-2">
                {familyMembers.map(member => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-2.5 rounded-lg bg-[#1e1e24] border border-[#3a3a44]/30"
                  >
                    <div className={`w-2 h-2 rounded-full ${member.voiceEnrolled ? "bg-green-500" : "bg-white/20"}`} />
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-white/70 truncate block">{member.name}</span>
                      <span className="text-[9px] text-white/30">{member.role}</span>
                    </div>
                    {member.voiceEnrolled ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] text-green-400/60">Enrolled</span>
                        <button
                          onClick={() => setEnrollingMember(member)}
                          className="px-2 py-1 text-[9px] text-amber-400/60 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-all"
                        >
                          Re-enroll
                        </button>
                        <button
                          onClick={() => handleDeleteVoice(member.id)}
                          className="p-1 text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded transition-all"
                          title="Delete voice profile"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEnrollingMember(member)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded text-[10px] hover:bg-amber-500/20 transition-all"
                      >
                        <Mic className="w-2.5 h-2.5" />
                        Enroll
                      </button>
                    )}
                  </div>
                ))}
                <p className="text-[9px] text-white/20 leading-relaxed">
                  Voice profiles enable hands-free speaker identification.
                  All data stays on this device.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-[#3a3a44]/30" />

          {/* ─── Location Section ─── */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-text-muted font-jetbrains tracking-wider">
              <MapPin className="w-3.5 h-3.5" />
              LOCATION
            </label>

            <div className="space-y-2">
              <div className="space-y-1">
                <span className="text-[11px] text-white/40">Home Address</span>
                <input
                  value={homeLoc}
                  onChange={(e) => setHomeLoc(e.target.value)}
                  onBlur={() => saveLocationSettings({ home_location: homeLoc })}
                  placeholder="e.g., 123 Main St, City, State"
                  className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[11px] text-white/40">Work Address</span>
                <input
                  value={workLoc}
                  onChange={(e) => setWorkLoc(e.target.value)}
                  onBlur={() => saveLocationSettings({ work_location: workLoc })}
                  placeholder="e.g., 456 Office Blvd, City, State"
                  className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <span className="text-[11px] text-white/40">ZIP Code</span>
                  <input
                    value={homeZip}
                    onChange={(e) => setHomeZip(e.target.value)}
                    onBlur={() => saveLocationSettings({ home_zip: homeZip })}
                    placeholder="e.g., 90210"
                    className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[11px] text-white/40">Weather City</span>
                  <input
                    value={weatherCity}
                    onChange={(e) => setWeatherCity(e.target.value)}
                    onBlur={() => saveLocationSettings({ weather_city: weatherCity })}
                    placeholder="e.g., New York"
                    className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[#3a3a44]/30" />

          {/* ─── API Keys Section ─── */}
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-xs text-text-muted font-jetbrains tracking-wider">
              <Key className="w-3.5 h-3.5" />
              API KEYS
            </label>

            {/* Key Status */}
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1e1e24] border border-[#3a3a44]/30">
                <div className={`w-2.5 h-2.5 rounded-full ${euriKeySource !== "none" ? "bg-green-500" : "bg-red-500"}`} />
                <div className="text-sm flex-1">
                  <span className="text-text-muted text-xs">Text Chat:</span>{" "}
                  {euriKeySource === "user" && <span className="text-green-400">Ready (your key)</span>}
                  {euriKeySource === "server" && <span className="text-green-400">Ready (server key)</span>}
                  {euriKeySource === "none" && <span className="text-red-400">Not configured</span>}
                </div>
                <span className="text-[10px] text-green-400/60 font-jetbrains">FREE</span>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#1e1e24] border border-[#3a3a44]/30">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500" />
                <div className="text-sm flex-1">
                  <span className="text-text-muted text-xs">Voice:</span>{" "}
                  {keySource === "user" && <span className="text-green-400">Premium (OpenAI)</span>}
                  {keySource === "server" && <span className="text-green-400">Premium (server key)</span>}
                  {keySource === "none" && <span className="text-green-400">Ready (browser voice)</span>}
                </div>
                {keySource === "none" && <span className="text-[10px] text-green-400/60 font-jetbrains">FREE</span>}
              </div>
            </div>

            {/* OpenAI Key */}
            <div className="space-y-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setStatus("idle"); setMessage(""); }}
                placeholder="OpenAI key: sk-proj-..."
                className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveOpenAI} disabled={!apiKey.trim() || status === "saving"}
                  className="flex-1 px-3 py-1.5 bg-vinegar-gold/20 border border-vinegar-gold/40 text-vinegar-gold rounded-lg text-xs hover:bg-vinegar-gold/30 disabled:opacity-40 transition-all">
                  Save OpenAI
                </button>
                {keySource === "user" && (
                  <button onClick={handleRemoveOpenAI}
                    className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/20 transition-all">
                    Remove
                  </button>
                )}
              </div>
            </div>

            {/* Euri Key */}
            <div className="space-y-2">
              <input
                type="password"
                value={euriKey}
                onChange={(e) => { setEuriKey(e.target.value); setStatus("idle"); setMessage(""); }}
                placeholder="Euri key (free 200K tokens/day)"
                className="w-full px-3 py-2 bg-[#0a0a0f] border border-[#3a3a44] rounded-lg text-sm text-text-primary placeholder-text-muted/30 focus:outline-none focus:border-vinegar-gold/50 font-jetbrains"
              />
              <div className="flex gap-2">
                <button onClick={handleSaveEuri} disabled={!euriKey.trim() || status === "saving"}
                  className="flex-1 px-3 py-1.5 bg-vinegar-gold/20 border border-vinegar-gold/40 text-vinegar-gold rounded-lg text-xs hover:bg-vinegar-gold/30 disabled:opacity-40 transition-all">
                  Save Euri
                </button>
                {euriKeySource === "user" && (
                  <button onClick={handleRemoveEuri}
                    className="px-3 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-xs hover:bg-red-500/20 transition-all">
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Status Message */}
          {message && (
            <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg ${
              status === "saved" ? "bg-green-500/10 text-green-400 border border-green-500/20" :
              status === "error" ? "bg-red-500/10 text-red-400 border border-red-500/20" : ""
            }`}>
              {status === "saved" ? <Check className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
              {message}
            </div>
          )}

          {/* Privacy Note */}
          <div className="p-3 rounded-lg bg-green-500/5 border border-green-500/10">
            <p className="text-[10px] text-green-400/60 leading-relaxed">
              Voice primarily runs in your browser. When browser voices are unavailable,
              a server fallback is used with personal data stripped. All data stays on your local network.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

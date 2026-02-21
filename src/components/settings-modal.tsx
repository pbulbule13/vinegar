"use client";

import { useState, useEffect, useCallback } from "react";
import { Settings, X, Key, Check, AlertCircle, MessageSquare, Globe, Volume2, MapPin, Users } from "lucide-react";

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

  // Load all settings when modal opens
  useEffect(() => {
    if (!isOpen) return;

    // API key status
    fetch("/api/settings").then(r => r.json()).then(data => {
      setKeySource(data.keySource);
      setEuriKeySource(data.euri?.keySource || "none");
    }).catch(() => {});

    // TTS settings
    fetch("/api/settings/tts").then(r => r.json()).then((data: TTSData) => {
      if (data.tts_language) setTtsLang(data.tts_language);
      if (data.tts_speed) setTtsSpeed(parseFloat(data.tts_speed) || 1.2);
      if (data.tts_pitch) setTtsPitch(parseFloat(data.tts_pitch) || 1.0);
      if (data.tts_voice) setSelectedVoice(data.tts_voice);
      if (data.stt_language) setSttLang(data.stt_language);
    }).catch(() => {});

    // Location settings
    fetch("/api/settings/location").then(r => r.json()).then((data: LocationData) => {
      setHomeLoc(data.home_location || "");
      setWorkLoc(data.work_location || "");
      setHomeZip(data.home_zip || "");
      setWeatherCity(data.weather_city || "");
    }).catch(() => {});
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
    } catch {}
  }, [onTTSSettingsChange]);

  // Save location settings
  const saveLocationSettings = useCallback(async (patch: Partial<LocationData>) => {
    try {
      await fetch("/api/settings/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {}
  }, []);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-[#141418] border border-[#3a3a44] rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#3a3a44]/50">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-vinegar-gold" />
            <h2 className="font-orbitron text-sm tracking-wider text-text-primary">SETTINGS</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#1e1e24] transition-colors">
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

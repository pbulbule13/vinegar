"use client";

import { useState } from "react";
import { Users, Plus, X } from "lucide-react";

interface FamilyMember {
  name: string;
  role: "parent" | "child";
  age?: number;
  birthday?: string;
}

interface FamilySetupProps {
  onComplete: () => void;
}

export function FamilySetup({ onComplete }: FamilySetupProps) {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [currentName, setCurrentName] = useState("");
  const [currentRole, setCurrentRole] = useState<"parent" | "child">("parent");
  const [currentAge, setCurrentAge] = useState("");
  const [currentBirthday, setCurrentBirthday] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const addMember = () => {
    if (!currentName.trim()) return;
    setMembers([...members, {
      name: currentName.trim(),
      role: currentRole,
      age: currentAge ? parseInt(currentAge) : undefined,
      birthday: currentBirthday || undefined,
    }]);
    setCurrentName("");
    setCurrentAge("");
    setCurrentBirthday("");
  };

  const removeMember = (index: number) => {
    setMembers(members.filter((_, i) => i !== index));
  };

  const saveFamily = async () => {
    if (members.length === 0) { setError("Add at least one family member"); return; }
    setSaving(true);
    setError("");

    try {
      for (const member of members) {
        const res = await fetch("/api/family", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(member),
        });
        if (!res.ok) throw new Error("Failed to save member");
      }
      onComplete();
    } catch {
      setError("Failed to save family. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#141418] border border-[#3a3a44] rounded-2xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-vinegar-gold/20 flex items-center justify-center">
            <Users className="w-5 h-5 text-vinegar-gold" />
          </div>
          <div>
            <h2 className="text-lg font-orbitron text-text-primary">Welcome to Vinegar</h2>
            <p className="text-xs text-text-muted">Tell me about your family</p>
          </div>
        </div>

        {/* Added members */}
        {members.length > 0 && (
          <div className="space-y-2 mb-4">
            {members.map((m, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2 bg-[#1e1e24] rounded-lg">
                <span className="text-sm text-text-primary">
                  {m.name} <span className="text-text-muted text-xs">({m.role}{m.age ? `, ${m.age}` : ""})</span>
                </span>
                <button onClick={() => removeMember(i)} className="text-text-muted hover:text-error">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add member form */}
        <div className="space-y-3 mb-4">
          <input
            type="text"
            placeholder="Name"
            value={currentName}
            onChange={(e) => setCurrentName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMember()}
            className="w-full px-3 py-2 bg-[#1e1e24] border border-[#3a3a44]/60 rounded-lg text-sm text-text-primary placeholder-text-muted/40 focus:outline-none focus:border-vinegar-gold/40"
          />
          <div className="flex gap-2">
            <select
              value={currentRole}
              onChange={(e) => setCurrentRole(e.target.value as "parent" | "child")}
              className="flex-1 px-3 py-2 bg-[#1e1e24] border border-[#3a3a44]/60 rounded-lg text-sm text-text-primary focus:outline-none"
            >
              <option value="parent">Parent</option>
              <option value="child">Child</option>
            </select>
            <input
              type="number"
              placeholder="Age"
              value={currentAge}
              onChange={(e) => setCurrentAge(e.target.value)}
              className="w-20 px-3 py-2 bg-[#1e1e24] border border-[#3a3a44]/60 rounded-lg text-sm text-text-primary placeholder-text-muted/40 focus:outline-none"
            />
          </div>
          <input
            type="date"
            value={currentBirthday}
            onChange={(e) => setCurrentBirthday(e.target.value)}
            className="w-full px-3 py-2 bg-[#1e1e24] border border-[#3a3a44]/60 rounded-lg text-sm text-text-secondary focus:outline-none"
          />
          <button
            onClick={addMember}
            disabled={!currentName.trim()}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[#1e1e24] border border-vinegar-gold/30 rounded-lg text-sm text-vinegar-gold hover:bg-vinegar-gold/10 disabled:opacity-30 transition-all"
          >
            <Plus className="w-4 h-4" /> Add Member
          </button>
        </div>

        {error && <p className="text-error text-xs mb-3">{error}</p>}

        <button
          onClick={saveFamily}
          disabled={saving || members.length === 0}
          className="w-full py-3 bg-vinegar-gold/20 border border-vinegar-gold/40 rounded-xl text-vinegar-gold font-orbitron text-sm hover:bg-vinegar-gold/30 disabled:opacity-30 transition-all"
        >
          {saving ? "Saving..." : "Save & Continue"}
        </button>
      </div>
    </div>
  );
}

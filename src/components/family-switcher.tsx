"use client";

import { useState, useEffect } from "react";
import { User, ChevronDown } from "lucide-react";

interface FamilyMember {
  id: string;
  name: string;
  role: string;
  isActive: boolean;
}

export function FamilySwitcher() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/family")
      .then(r => r.json())
      .then(data => {
        setMembers(data.members || []);
        setActiveId(data.activeId);
      })
      .catch(() => {});
  }, []);

  const switchMember = async (id: string) => {
    const res = await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch", member_id: id }),
    });
    if (res.ok) {
      setActiveId(id);
      setOpen(false);
    }
  };

  const activeMember = members.find(m => m.id === activeId);

  if (members.length === 0) return null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-jetbrains text-text-muted hover:text-vinegar-gold/80 bg-[#141418] border border-[#3a3a44]/40 rounded-lg hover:border-vinegar-gold/30 transition-all"
      >
        <User className="w-3.5 h-3.5" />
        <span>{activeMember?.name || "No one"}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 w-48 bg-[#141418] border border-[#3a3a44] rounded-xl shadow-2xl overflow-hidden">
            {members.map(m => (
              <button
                key={m.id}
                onClick={() => switchMember(m.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-vinegar-gold/10 transition-colors ${
                  m.id === activeId ? "bg-vinegar-gold/15 text-vinegar-gold" : "text-text-secondary"
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${m.role === "parent" ? "bg-blue-400" : "bg-green-400"}`} />
                <span>{m.name}</span>
                <span className="ml-auto text-[10px] text-text-muted">{m.role}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

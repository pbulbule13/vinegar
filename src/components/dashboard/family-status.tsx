"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, UserCircle } from "lucide-react";

interface FamilyMember {
  id: string;
  name: string;
  role: string;
  age: number | null;
  is_active: boolean;
}

export function FamilyStatus() {
  const [members, setMembers] = useState<FamilyMember[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFamily = useCallback(async () => {
    try {
      const res = await fetch("/api/family");
      const data = await res.json();
      setMembers(data.members || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFamily(); }, [fetchFamily]);

  const switchMember = async (id: string) => {
    await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch", member_id: id }),
    });
    fetchFamily();
  };

  const activeMember = members.find(m => m.is_active);

  return (
    <div className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-vinegar-gold" />
          Family
        </h3>
        {activeMember && (
          <span className="text-[10px] text-vinegar-gold font-jetbrains">{activeMember.name} active</span>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-text-muted text-center py-2">Loading...</p>
      ) : members.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-2">No family members yet</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {members.map(member => (
            <button
              key={member.id}
              onClick={() => switchMember(member.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs transition-colors ${
                member.is_active
                  ? "bg-vinegar-gold/20 border border-vinegar-gold/40 text-vinegar-gold"
                  : "bg-deep-space border border-steel-dark text-text-secondary hover:border-vinegar-gold/20"
              }`}
            >
              <UserCircle className="w-3.5 h-3.5" />
              <span>{member.name}</span>
              {member.role === "child" && member.age && (
                <span className="text-[10px] text-text-muted">({member.age})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

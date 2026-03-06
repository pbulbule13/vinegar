"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, UserCircle, UserPlus } from "lucide-react";
import { useDataCacheStore } from "@/stores/app-store";
import { SkeletonBlock, EmptyState } from "@/components/ui/skeleton";

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
  const { getFamilyMembers, setFamilyMembers, invalidateFamily } = useDataCacheStore();

  const fetchFamily = useCallback(async () => {
    // Check cache first
    const cached = getFamilyMembers();
    if (cached) {
      setMembers(cached);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch("/api/family");
      const data = await res.json();
      const familyData = data.members || [];
      setMembers(familyData);
      setFamilyMembers(familyData);
    } catch {} finally { setLoading(false); }
  }, [getFamilyMembers, setFamilyMembers]);

  useEffect(() => { fetchFamily(); }, [fetchFamily]);

  const switchMember = async (id: string) => {
    await fetch("/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "switch", member_id: id }),
    });
    invalidateFamily();
    fetchFamily();
  };

  const activeMember = members.find(m => m.is_active);

  return (
    <section className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3" aria-label="Family members">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Users className="w-4 h-4 text-vinegar-gold" aria-hidden="true" />
          Family
        </h3>
        {activeMember && (
          <span className="text-[10px] text-vinegar-gold font-jetbrains">{activeMember.name} active</span>
        )}
      </div>

      {loading ? (
        <SkeletonBlock lines={2} />
      ) : members.length === 0 ? (
        <EmptyState icon={<UserPlus className="w-6 h-6" />} title="No family members yet" description="Say 'Add a family member'" />
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
    </section>
  );
}

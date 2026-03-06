"use client";

import { useState, useEffect, useCallback } from "react";
import { Zap, ToggleLeft, ToggleRight, Trash2, Sparkles } from "lucide-react";
import { SkeletonList, EmptyState } from "@/components/ui/skeleton";

interface Skill {
  id: string;
  name: string;
  description: string;
  type: string;
  is_active: number;
  use_count: number;
  trigger_phrases: string[];
}

export function SkillsWidget() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills");
      const data = await res.json();
      setSkills(data.skills || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const toggleSkill = async (id: string) => {
    await fetch("/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toggle", id }),
    });
    fetchSkills();
  };

  const deleteSkill = async (id: string) => {
    await fetch(`/api/skills?id=${id}`, { method: "DELETE" });
    fetchSkills();
  };

  const activeCount = skills.filter(s => s.is_active).length;

  return (
    <section className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3" aria-label="Custom skills">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Zap className="w-4 h-4 text-vinegar-gold" aria-hidden="true" />
          Skills
        </h3>
        <span className="text-[10px] text-text-muted font-jetbrains">{activeCount} active</span>
      </div>

      {loading ? (
        <SkeletonList items={2} />
      ) : skills.length === 0 ? (
        <EmptyState icon={<Sparkles className="w-6 h-6" />} title="No skills yet" description={'Say "Vinegar, learn a new skill"'} />
      ) : (
        <ul className="space-y-2">
          {skills.map(skill => (
            <li key={skill.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-gunmetal/50 group">
              <button onClick={() => toggleSkill(skill.id)} className="mt-0.5 shrink-0">
                {skill.is_active
                  ? <ToggleRight className="w-5 h-5 text-success" />
                  : <ToggleLeft className="w-5 h-5 text-steel-mid" />
                }
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-primary font-medium truncate">{skill.name}</span>
                  <span className="text-[10px] text-text-muted font-jetbrains">{skill.type}</span>
                </div>
                <p className="text-[10px] text-text-muted truncate">{skill.description}</p>
                {skill.use_count > 0 && <p className="text-[10px] text-text-muted">Used {skill.use_count}x</p>}
              </div>
              <button onClick={() => deleteSkill(skill.id)} className="opacity-0 group-hover:opacity-100 text-error/60 hover:text-error mt-0.5">
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

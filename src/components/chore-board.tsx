"use client";

import { useState, useEffect, useCallback } from "react";
import { Star, CheckCircle2, Plus, Trophy } from "lucide-react";

interface Chore {
  id: string;
  title: string;
  status: string;
  points: number;
  assigned_to: string | null;
  assigned_name: string | null;
}

interface PointsSummary {
  name: string;
  id: string;
  total_points: number;
}

export function ChoreBoard({ compact = false }: { compact?: boolean }) {
  const [chores, setChores] = useState<Chore[]>([]);
  const [pointsSummary, setPointsSummary] = useState<PointsSummary[]>([]);
  const [newChore, setNewChore] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchChores = useCallback(async () => {
    try {
      const res = await fetch("/api/chores");
      const data = await res.json();
      setChores(data.chores || []);
      setPointsSummary(data.pointsSummary || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchChores(); }, [fetchChores]);

  const addChore = async () => {
    const title = newChore.trim();
    if (!title) return;
    setNewChore("");
    await fetch("/api/chores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", title, points: 1 }),
    });
    fetchChores();
  };

  const completeChore = async (chore: Chore) => {
    await fetch("/api/chores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "complete", id: chore.id }),
    });
    fetchChores();
  };

  const pendingChores = chores.filter(c => c.status === "pending");

  if (compact) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Star className="w-4 h-4 text-vinegar-gold" />
          Chores ({pendingChores.length})
        </h3>
        <ul className="space-y-1">
          {pendingChores.slice(0, 4).map(chore => (
            <li key={chore.id} className="flex items-center gap-2 text-xs text-text-secondary">
              <button onClick={() => completeChore(chore)} className="text-steel-mid hover:text-success">
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <span className="flex-1 truncate">{chore.title}</span>
              {chore.points > 0 && <span className="text-vinegar-gold text-[10px]">{chore.points}★</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-orbitron text-text-primary flex items-center gap-2">
          <Star className="w-5 h-5 text-vinegar-gold" />
          Chore Board
        </h2>
      </div>

      {/* Points leaderboard */}
      {pointsSummary.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-1">
          {pointsSummary.filter(p => p.total_points > 0).map((p, i) => (
            <div key={p.id} className="flex items-center gap-2 px-3 py-1.5 bg-charcoal border border-steel-dark rounded-full text-xs shrink-0">
              {i === 0 && <Trophy className="w-3.5 h-3.5 text-vinegar-gold" />}
              <span className="text-text-secondary">{p.name}</span>
              <span className="text-vinegar-gold font-jetbrains">{p.total_points}★</span>
            </div>
          ))}
        </div>
      )}

      {/* Add chore */}
      <div className="flex gap-2">
        <input
          value={newChore}
          onChange={e => setNewChore(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addChore()}
          placeholder="Add chore..."
          className="flex-1 bg-charcoal border border-steel-dark rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted/40 focus:outline-none focus:border-vinegar-gold/40"
        />
        <button onClick={addChore} className="p-2 bg-vinegar-gold/20 border border-vinegar-gold/30 rounded-lg text-vinegar-gold hover:bg-vinegar-gold/30">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Chore list */}
      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : pendingChores.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No chores! Add some or ask Vinegar.</p>
      ) : (
        <ul className="space-y-2">
          {pendingChores.map(chore => (
            <li key={chore.id} className="flex items-center gap-3 py-2 px-3 bg-charcoal border border-steel-dark rounded-lg group hover:border-vinegar-gold/20">
              <button onClick={() => completeChore(chore)} className="text-steel-mid hover:text-success transition-colors">
                <CheckCircle2 className="w-5 h-5" />
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary truncate">{chore.title}</p>
                {chore.assigned_name && <p className="text-[10px] text-text-muted">{chore.assigned_name}</p>}
              </div>
              <div className="flex items-center gap-1 text-vinegar-gold text-xs font-jetbrains">
                {chore.points}
                <Star className="w-3 h-3 fill-vinegar-gold" />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

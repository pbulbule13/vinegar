"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, Clock, MapPin } from "lucide-react";

interface Activity {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  location: string | null;
  family_member_id: string | null;
  recurring: string | null;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ActivitySchedule({ compact = false }: { compact?: boolean }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activities");
      const data = await res.json();
      setActivities(data.activities || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  // Group by day of week for recurring activities
  const now = Math.floor(Date.now() / 1000);
  const upcoming = activities
    .filter(a => a.start_time > now)
    .sort((a, b) => a.start_time - b.start_time);

  const todayActivities = activities.filter(a => {
    const dayStart = now - (now % 86400);
    return a.start_time >= dayStart && a.start_time < dayStart + 86400;
  });

  if (compact) {
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Calendar className="w-4 h-4 text-vinegar-gold" />
          Today&apos;s Activities
        </h3>
        {todayActivities.length === 0 ? (
          <p className="text-xs text-text-muted">No activities today</p>
        ) : (
          <ul className="space-y-1">
            {todayActivities.map(a => (
              <li key={a.id} className="flex items-center gap-2 text-xs text-text-secondary">
                <Clock className="w-3 h-3 text-text-muted" />
                <span>{formatTime(a.start_time)} - {a.title}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // Group upcoming by date
  const grouped = upcoming.slice(0, 20).reduce<Record<string, Activity[]>>((acc, act) => {
    const date = new Date(act.start_time * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    (acc[date] = acc[date] || []).push(act);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-orbitron text-text-primary flex items-center gap-2">
          <Calendar className="w-5 h-5 text-vinegar-gold" />
          Activities
        </h2>
        <span className="text-xs text-text-muted font-jetbrains">{upcoming.length} upcoming</span>
      </div>

      {loading ? (
        <p className="text-sm text-text-muted">Loading...</p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">No upcoming activities. Ask Vinegar to add one!</p>
      ) : (
        <div className="space-y-4">
          {Object.entries(grouped).map(([date, acts]) => (
            <div key={date}>
              <h3 className="text-xs font-jetbrains text-text-muted uppercase tracking-wider mb-2">{date}</h3>
              <ul className="space-y-2">
                {acts.map(act => (
                  <li key={act.id} className="flex items-start gap-3 py-2 px-3 bg-charcoal border border-steel-dark rounded-lg">
                    <div className="text-center mt-0.5 shrink-0">
                      <div className="text-[10px] text-vinegar-gold font-jetbrains">{formatTime(act.start_time)}</div>
                      <div className="text-[10px] text-text-muted">{formatTime(act.end_time)}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-text-primary">{act.title}</p>
                      {act.location && (
                        <p className="text-[10px] text-text-muted flex items-center gap-1 mt-0.5">
                          <MapPin className="w-2.5 h-2.5" />
                          {act.location}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

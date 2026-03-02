"use client";

import { useState, useEffect, useCallback } from "react";
import { Calendar, ChevronLeft, ChevronRight, CalendarX } from "lucide-react";
import { SkeletonList, EmptyState } from "@/components/ui/skeleton";

interface CalendarEvent {
  id: string;
  title: string;
  start_time: number;
  end_time: number;
  all_day: number;
  location: string | null;
  source: string;
}

type ViewMode = "day" | "week";

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function CalendarWidget() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<ViewMode>("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try {
      const start = new Date(currentDate);
      let end: Date;

      if (view === "day") {
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      } else {
        const day = start.getDay();
        start.setDate(start.getDate() - day);
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 7);
      }

      const res = await fetch(`/api/calendar?start=${formatDate(start)}&end=${formatDate(end)}`);
      const data = await res.json();
      setEvents(data.events || []);
    } catch {} finally { setLoading(false); }
  }, [currentDate, view]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const navigate = (dir: number) => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + (view === "day" ? dir : dir * 7));
    setCurrentDate(d);
  };

  const isToday = formatDate(currentDate) === formatDate(new Date());
  const dateLabel = view === "day"
    ? currentDate.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })
    : `Week of ${currentDate.toLocaleDateString([], { month: "short", day: "numeric" })}`;

  // Group events by day for week view
  const grouped = events.reduce<Record<string, CalendarEvent[]>>((acc, evt) => {
    const key = new Date(evt.start_time * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    (acc[key] = acc[key] || []).push(evt);
    return acc;
  }, {});

  return (
    <section className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3" aria-label="Calendar schedule">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <Calendar className="w-4 h-4 text-vinegar-gold" aria-hidden="true" />
          Schedule
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => setView("day")} className={`px-2 py-0.5 text-[10px] rounded ${view === "day" ? "bg-vinegar-gold/20 text-vinegar-gold" : "text-text-muted hover:text-text-secondary"}`}>Day</button>
          <button onClick={() => setView("week")} className={`px-2 py-0.5 text-[10px] rounded ${view === "week" ? "bg-vinegar-gold/20 text-vinegar-gold" : "text-text-muted hover:text-text-secondary"}`}>Week</button>
        </div>
      </div>

      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate(-1)} className="p-1 text-text-muted hover:text-text-primary"><ChevronLeft className="w-4 h-4" /></button>
        <div className="text-center">
          <span className="text-xs text-text-secondary">{dateLabel}</span>
          {!isToday && <button onClick={() => setCurrentDate(new Date())} className="ml-2 text-[10px] text-vinegar-gold hover:underline">Today</button>}
        </div>
        <button onClick={() => navigate(1)} className="p-1 text-text-muted hover:text-text-primary"><ChevronRight className="w-4 h-4" /></button>
      </div>

      {/* Events */}
      {loading ? (
        <SkeletonList items={3} />
      ) : events.length === 0 ? (
        <EmptyState icon={<CalendarX className="w-8 h-8" />} title="No events scheduled" description={`Nothing on ${isToday ? "today's" : "this"} calendar`} />
      ) : view === "day" ? (
        <ul className="space-y-2">
          {events.sort((a, b) => a.start_time - b.start_time).map(evt => (
            <li key={evt.id} className="flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-gunmetal/50">
              <div className="text-[10px] font-jetbrains text-vinegar-gold w-12 shrink-0 pt-0.5">
                {evt.all_day ? "ALL DAY" : formatTime(evt.start_time)}
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-primary truncate">{evt.title}</p>
                {evt.location && <p className="text-[10px] text-text-muted truncate">{evt.location}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="space-y-3">
          {Object.entries(grouped).map(([day, dayEvents]) => (
            <div key={day}>
              <h4 className="text-[10px] font-jetbrains text-text-muted uppercase mb-1">{day}</h4>
              <ul className="space-y-1">
                {dayEvents.sort((a, b) => a.start_time - b.start_time).map(evt => (
                  <li key={evt.id} className="flex items-center gap-2 text-xs">
                    <span className="text-[10px] font-jetbrains text-vinegar-gold w-10">{evt.all_day ? "ALL" : formatTime(evt.start_time)}</span>
                    <span className="text-text-secondary truncate">{evt.title}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

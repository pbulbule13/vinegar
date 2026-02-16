"use client";

import { useState, useEffect, useCallback } from "react";
import { ListTodo, CheckCircle2, AlertTriangle } from "lucide-react";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: number | null;
  category: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-error",
  high: "text-warning",
  medium: "text-text-secondary",
  low: "text-text-muted",
};

export function TasksWidget() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch("/api/tools/manage_task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const data = await res.json();
      setTasks(data.data?.tasks || []);
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const completeTask = async (task: Task) => {
    await fetch("/api/tools/manage_task", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", title: task.id, status: "completed" }),
    });
    fetchTasks();
  };

  const pendingTasks = tasks.filter(t => t.status === "pending" || t.status === "in_progress");
  const now = Math.floor(Date.now() / 1000);
  const overdue = pendingTasks.filter(t => t.due_date && t.due_date < now);

  return (
    <div className="bg-charcoal border border-steel-dark rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary flex items-center gap-2">
          <ListTodo className="w-4 h-4 text-vinegar-gold" />
          Tasks
        </h3>
        <span className="text-[10px] text-text-muted font-jetbrains">{pendingTasks.length} pending</span>
      </div>

      {overdue.length > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 bg-error/10 border border-error/20 rounded-lg text-xs text-error">
          <AlertTriangle className="w-3.5 h-3.5" />
          {overdue.length} overdue task{overdue.length > 1 ? "s" : ""}
        </div>
      )}

      {loading ? (
        <p className="text-xs text-text-muted text-center py-4">Loading...</p>
      ) : pendingTasks.length === 0 ? (
        <p className="text-xs text-text-muted text-center py-4">All clear!</p>
      ) : (
        <ul className="space-y-1.5">
          {pendingTasks.slice(0, 8).map(task => (
            <li key={task.id} className="flex items-center gap-2 py-1 group">
              <button onClick={() => completeTask(task)} className="text-steel-mid hover:text-success shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </button>
              <span className={`flex-1 text-xs truncate ${PRIORITY_COLORS[task.priority] || "text-text-secondary"}`}>
                {task.title}
              </span>
              {task.due_date && task.due_date < now && (
                <span className="text-[10px] text-error">overdue</span>
              )}
              {task.priority === "urgent" && (
                <span className="text-[10px] text-error font-jetbrains">!</span>
              )}
            </li>
          ))}
          {pendingTasks.length > 8 && (
            <li className="text-[10px] text-text-muted text-center">+{pendingTasks.length - 8} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

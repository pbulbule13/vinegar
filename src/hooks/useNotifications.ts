"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface Notification {
  id: string;
  type: "reminder" | "suggestion" | "info";
  message: string;
  priority?: "high" | "medium" | "low";
  timestamp: number;
  dismissed: boolean;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  connected: boolean;
}

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (eventSourceRef.current) return;

    try {
      const es = new EventSource("/api/notifications");
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          switch (data.type) {
            case "connected":
            case "ready":
              setConnected(true);
              break;

            case "reminder":
              setNotifications((prev) => [
                ...prev,
                {
                  id: data.id || `rem_${Date.now()}`,
                  type: "reminder",
                  message: data.message || "Reminder",
                  priority: "high",
                  timestamp: Date.now(),
                  dismissed: false,
                },
              ]);
              break;

            case "suggestions":
              if (Array.isArray(data.suggestions)) {
                const newSuggestions = data.suggestions.map(
                  (s: { id: string; message: string; priority?: string }) => ({
                    id: s.id,
                    type: "suggestion" as const,
                    message: s.message,
                    priority: s.priority || "low",
                    timestamp: Date.now(),
                    dismissed: false,
                  })
                );
                setNotifications((prev) => {
                  // Remove old suggestions, add new ones
                  const nonSuggestions = prev.filter((n) => n.type !== "suggestion");
                  return [...nonSuggestions, ...newSuggestions];
                });
              }
              break;

            case "heartbeat":
              // Connection alive
              break;
          }
        } catch {}
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Reconnect after 5 seconds
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 5000);
      };
    } catch {}
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n))
    );
    // Also dismiss on server if it's a suggestion (fire-and-forget)
    fetch("/api/suggestions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {
      // Non-critical: notification dismissed locally even if server sync fails
    });
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, dismissed: true })));
  }, []);

  const unreadCount = notifications.filter((n) => !n.dismissed).length;

  return { notifications, unreadCount, dismiss, dismissAll, connected };
}

/**
 * Notifications SSE Endpoint
 * GET /api/notifications - SSE stream for real-time reminder delivery + suggestions
 * Clients keep a persistent connection; server pushes events as they occur.
 */

import '@/lib/init';
import { vinegarEvents } from '@/lib/events';
import { getActiveSuggestions } from '@/lib/suggestion-engine';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  // Track intervals and listeners for cleanup
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let suggestionsInterval: ReturnType<typeof setInterval> | null = null;
  let onReminderFired: ((data: unknown) => void) | null = null;

  const cleanup = () => {
    if (onReminderFired) {
      vinegarEvents.off('reminder:fired', onReminderFired);
      onReminderFired = null;
    }
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (suggestionsInterval) {
      clearInterval(suggestionsInterval);
      suggestionsInterval = null;
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      // Listen for fired reminders
      onReminderFired = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'reminder', ...(data as Record<string, unknown>) })}\n\n`));
        } catch {
          // Client disconnected — enqueue failed, trigger cleanup
          cleanup();
        }
      };

      vinegarEvents.on('reminder:fired', onReminderFired);

      // Send active suggestions on connect
      const suggestions = getActiveSuggestions();
      if (suggestions.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', suggestions })}\n\n`));
      }

      // Heartbeat every 30s to keep connection alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', time: Date.now() })}\n\n`));
        } catch {
          cleanup();
        }
      }, 30000);

      // Suggestions update every 5 minutes
      suggestionsInterval = setInterval(() => {
        try {
          const sug = getActiveSuggestions();
          if (sug.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', suggestions: sug })}\n\n`));
          }
        } catch {
          // Suggestion fetch failed — non-critical
        }
      }, 300000);

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ready' })}\n\n`));
    },
    cancel() {
      // Client disconnected — clean up all intervals and listeners
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

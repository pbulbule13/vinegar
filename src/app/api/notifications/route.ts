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

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      // Listen for fired reminders
      const onReminderFired = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'reminder', ...(data as Record<string, unknown>) })}\n\n`));
        } catch {}
      };

      vinegarEvents.on('reminder:fired', onReminderFired);

      // Send active suggestions on connect
      const suggestions = getActiveSuggestions();
      if (suggestions.length > 0) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', suggestions })}\n\n`));
      }

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'heartbeat', time: Date.now() })}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Suggestions update every 5 minutes
      const suggestionsInterval = setInterval(() => {
        try {
          const sug = getActiveSuggestions();
          if (sug.length > 0) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'suggestions', suggestions: sug })}\n\n`));
          }
        } catch {}
      }, 300000);

      // Cleanup on close
      const cleanup = () => {
        vinegarEvents.off('reminder:fired', onReminderFired);
        clearInterval(heartbeat);
        clearInterval(suggestionsInterval);
      };

      // Handle client disconnect via AbortSignal
      // The controller.close() will be called by the runtime when the client disconnects
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'ready' })}\n\n`));

      // Store cleanup for when stream closes
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel() {
      // Client disconnected - this is automatically called
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

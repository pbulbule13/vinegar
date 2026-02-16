/**
 * Vinegar Event Bus
 * In-process EventEmitter for cross-feature communication.
 */

type EventHandler = (...args: unknown[]) => void;

class VinegarEventBus {
  private handlers: Map<string, Set<EventHandler>> = new Map();

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    handlers.forEach(handler => {
      try {
        handler(...args);
      } catch (err) {
        console.error(`[EventBus] Error in handler for "${event}":`, err);
      }
    });
  }

  once(event: string, handler: EventHandler): void {
    const wrapper: EventHandler = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    this.on(event, wrapper);
  }
}

// Singleton
const globalForEvents = globalThis as unknown as { __vinegarEvents?: VinegarEventBus };
export const vinegarEvents: VinegarEventBus = globalForEvents.__vinegarEvents ?? new VinegarEventBus();
if (process.env.NODE_ENV !== 'production') {
  globalForEvents.__vinegarEvents = vinegarEvents;
}

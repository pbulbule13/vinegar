"use client";

import { memo, Component, type ReactNode } from "react";
import type { VisualContext, VisualContextError } from "@/types/visual-context";
import { ContextCard } from "./context-card";
import { Loader2, ImageOff, Eye } from "lucide-react";

// ── Error Boundary ──

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class PanelErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full p-4">
          <p className="text-xs text-white/20 font-mono">Panel error — try refreshing</p>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Empty State ──

function EmptyState({ onExampleClick }: { onExampleClick?: (prompt: string) => void }) {
  const examples = [
    "What is the weather?",
    "Find cafes nearby",
    "Recipe for dal",
    "Show me turmeric",
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 p-6">
      <div className="relative">
        <div className="w-16 h-16 rounded-full border-2 border-dashed border-white/10 flex items-center justify-center animate-[spin_20s_linear_infinite]">
          <Eye className="w-6 h-6 text-white/10" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <p className="text-[10px] font-mono text-white/20 tracking-wider uppercase">Visual Context</p>
        <p className="text-[11px] text-white/15">Topics you discuss will appear here</p>
      </div>
      <div className="flex flex-wrap justify-center gap-1.5">
        {examples.map((example) => (
          <button
            key={example}
            onClick={() => onExampleClick?.(example)}
            className="px-2 py-1 text-[9px] font-mono text-white/20 border border-white/5 rounded-md hover:text-amber-400/50 hover:border-amber-500/20 transition-colors"
          >
            {example}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Loading State ──

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-32 gap-2">
      <Loader2 className="w-4 h-4 text-amber-400/40 animate-spin" />
      <span className="text-[10px] font-mono text-white/20">Loading visual...</span>
    </div>
  );
}

// ── Error State ──

function ErrorState({ error }: { error: VisualContextError }) {
  return (
    <div className="flex items-center justify-center h-32 gap-2 p-4">
      <ImageOff className="w-4 h-4 text-white/15" />
      <span className="text-[10px] font-mono text-white/20">{error.message}</span>
    </div>
  );
}

// ── Main Panel ──

interface ContextPanelProps {
  context: VisualContext | null;
  isLoading: boolean;
  error: VisualContextError | null;
  onExampleClick?: (prompt: string) => void;
}

export const ContextPanel = memo(function ContextPanel({
  context,
  isLoading,
  error,
  onExampleClick,
}: ContextPanelProps) {
  return (
    <PanelErrorBoundary>
      <aside
        role="complementary"
        aria-label="Visual context"
        className="h-full flex flex-col bg-charcoal/80 backdrop-blur-xl border-l border-steel-dark/30"
      >
        {/* Panel header */}
        <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2">
          <Eye className="w-3 h-3 text-white/20" />
          <span className="text-[9px] font-mono text-white/25 tracking-wider uppercase">Context</span>
        </div>

        {/* Panel body — aria-live for screen readers */}
        <div
          className="flex-1 overflow-y-auto p-3 scrollbar-thin"
          aria-live="polite"
          aria-atomic="true"
        >
          {error ? (
            <ErrorState error={error} />
          ) : isLoading && !context ? (
            <LoadingState />
          ) : context ? (
            <div className="space-y-3 motion-safe:animate-fadeSlideIn">
              <ContextCard context={context} />
              {isLoading && (
                <div className="flex items-center gap-1.5 px-1">
                  <Loader2 className="w-3 h-3 text-amber-400/30 animate-spin" />
                  <span className="text-[9px] text-white/15">Updating...</span>
                </div>
              )}
            </div>
          ) : (
            <EmptyState onExampleClick={onExampleClick} />
          )}
        </div>
      </aside>
    </PanelErrorBoundary>
  );
});

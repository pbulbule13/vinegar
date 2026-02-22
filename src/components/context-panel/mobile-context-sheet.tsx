"use client";

import { useState, useCallback, useRef, useEffect, memo } from "react";
import type { VisualContext, VisualContextError } from "@/types/visual-context";
import { ContextCard } from "./context-card";
import { X, ChevronUp, Eye } from "lucide-react";

interface MobileContextSheetProps {
  context: VisualContext | null;
  isLoading: boolean;
  error: VisualContextError | null;
}

/**
 * Mobile bottom sheet that slides up when visual context is available.
 * Collapsed: thin peek bar showing card type.
 * Expanded: scrollable card view (60vh max).
 */
export const MobileContextSheet = memo(function MobileContextSheet({
  context,
  isLoading,
  error,
}: MobileContextSheetProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const dragOffset = useRef(0);

  // Auto-expand when new context arrives
  useEffect(() => {
    if (context) {
      setIsDismissed(false);
      setIsExpanded(false); // Start collapsed (peek bar)
    }
  }, [context?.query]);

  const handleDragStart = useCallback((e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
    dragOffset.current = 0;
  }, []);

  const handleDragMove = useCallback((e: React.TouchEvent) => {
    dragOffset.current = e.touches[0].clientY - dragStartY.current;
    if (sheetRef.current) {
      const translateY = Math.max(0, dragOffset.current);
      sheetRef.current.style.transform = `translateY(${translateY}px)`;
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transform = "";
    }
    // Dismiss if dragged down more than 80px
    if (dragOffset.current > 80) {
      if (isExpanded) {
        setIsExpanded(false);
      } else {
        setIsDismissed(true);
      }
    }
    // Expand if dragged up more than 40px from collapsed
    if (dragOffset.current < -40 && !isExpanded) {
      setIsExpanded(true);
    }
    dragOffset.current = 0;
  }, [isExpanded]);

  if (!context || isDismissed || error) return null;

  return (
    <div className="lg:hidden fixed bottom-16 inset-x-0 z-40">
      <div
        ref={sheetRef}
        className={`mx-2 bg-charcoal/95 backdrop-blur-xl border border-white/10 rounded-t-2xl transition-all duration-300 ease-out ${
          isExpanded ? "max-h-[60vh]" : "max-h-20"
        } overflow-hidden`}
        onTouchStart={handleDragStart}
        onTouchMove={handleDragMove}
        onTouchEnd={handleDragEnd}
      >
        {/* Drag handle */}
        <div className="flex items-center justify-center py-2">
          <div className="w-8 h-1 rounded-full bg-white/20" />
        </div>

        {/* Peek bar (collapsed state) */}
        {!isExpanded && (
          <button
            onClick={() => setIsExpanded(true)}
            className="w-full flex items-center gap-2 px-4 pb-3"
          >
            <Eye className="w-3.5 h-3.5 text-amber-400/60" />
            <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              {context.cardType}
            </span>
            <span className="text-xs text-white/50 truncate flex-1 text-left">
              {context.query}
            </span>
            <ChevronUp className="w-3.5 h-3.5 text-white/30" />
          </button>
        )}

        {/* Expanded content */}
        {isExpanded && (
          <div className="px-3 pb-4 overflow-y-auto max-h-[calc(60vh-3rem)]">
            <div className="flex items-center justify-between mb-2 px-1">
              <div className="flex items-center gap-2">
                <Eye className="w-3 h-3 text-white/20" />
                <span className="text-[9px] font-mono text-white/25 tracking-wider uppercase">
                  Context
                </span>
              </div>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-1 rounded-md hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5 text-white/30" />
              </button>
            </div>
            <ContextCard context={context} />
            {isLoading && (
              <div className="flex items-center gap-1.5 px-1 mt-2">
                <span className="text-[9px] text-white/15">Updating...</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

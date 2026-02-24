"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import type {
  VisualContext, VisualContextError, VisualToolName,
  UseVisualContextOptions, UseVisualContextReturn, WebSearchResult,
} from '@/types/visual-context';
import type { ToolResult } from '@/lib/tool-executor';
import { detectVisualContext, extractVisualHint, buildContextFromToolResult } from '@/lib/visual-context-detector';
import { searchImages } from '@/lib/image-search';

export function useVisualContext(options?: UseVisualContextOptions): UseVisualContextReturn {
  const { onContextChange, onError, debounceMs = 300 } = options || {};

  const [context, setContext] = useState<VisualContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<VisualContextError | null>(null);

  // Race condition prevention
  const abortRef = useRef<AbortController | null>(null);
  const turnRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateContext = useCallback((ctx: VisualContext | null) => {
    setContext(ctx);
    setError(null);
    onContextChange?.(ctx);
  }, [onContextChange]);

  const handleError = useCallback((code: VisualContextError['code'], message: string, retryable = true) => {
    const err: VisualContextError = { code, message, retryable };
    setError(err);
    setIsLoading(false);
    onError?.(err);
  }, [onError]);

  /**
   * Fetch images and build context for a detected topic.
   * Handles abort, coalescing, and error states.
   */
  const fetchAndSetContext = useCallback(async (
    cardType: VisualContext['cardType'],
    query: string,
    confidence: number,
    keywords: string[],
    childSafe?: boolean,
  ) => {
    // Cancel previous fetch
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentTurn = ++turnRef.current;

    setIsLoading(true);

    try {
      const images = await searchImages(query, {
        signal: controller.signal,
        childSafe,
      });

      // Stale turn check
      if (currentTurn !== turnRef.current) return;

      if (images.length === 0 && cardType === 'image-only') {
        // Image-only with no results — don't show empty panel
        setIsLoading(false);
        return;
      }

      const ctx: VisualContext = {
        cardType,
        query,
        confidence,
        extractedKeywords: keywords,
        images,
        toolData: undefined,
      } as VisualContext;

      setIsLoading(false);
      updateContext(ctx);
    } catch {
      if (currentTurn !== turnRef.current) return;
      handleError('IMAGE_SEARCH_FAILED', 'Could not load images');
    }
  }, [updateContext, handleError]);

  /**
   * Tier 1: Detect visual context from user message (instant regex).
   * Called immediately on user message submission.
   */
  const updateFromMessage = useCallback((userMsg: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      const detection = detectVisualContext(userMsg);
      if (detection) {
        fetchAndSetContext(
          detection.cardType,
          detection.query,
          detection.confidence,
          detection.keywords,
        );
      }
    }, debounceMs);
  }, [fetchAndSetContext, debounceMs]);

  /**
   * Tier 2: Extract visual hint from AI response.
   * Called once when SSE stream completes ([DONE]).
   */
  const updateFromResponse = useCallback((aiResponse: string) => {
    const hint = extractVisualHint(aiResponse);
    if (hint) {
      // LLM hint overrides current context with higher confidence
      fetchAndSetContext('image-only', hint, 0.9, []);
    }
  }, [fetchAndSetContext]);

  /**
   * Tool result → rich card.
   * Called when voice path or non-streaming chat path returns tool data.
   */
  const updateFromToolResult = useCallback((toolName: VisualToolName, result: ToolResult) => {
    // Cancel any pending image fetch — tool data takes priority
    abortRef.current?.abort();
    const currentTurn = ++turnRef.current;

    const ctx = buildContextFromToolResult(toolName, result);
    if (!ctx) return;

    // Fetch a relevant image for the card background
    setIsLoading(true);
    searchImages(ctx.query).then(images => {
      if (currentTurn !== turnRef.current) return;
      const enriched = { ...ctx, images } as VisualContext;
      setIsLoading(false);
      updateContext(enriched);
    }).catch(() => {
      if (currentTurn !== turnRef.current) return;
      // Show card without images — still useful
      setIsLoading(false);
      updateContext(ctx);
    });
  }, [updateContext]);

  /**
   * Explicitly search the web for a query and show results in panel.
   * Used by the panel's search bar and auto-search on unanswered questions.
   */
  const searchWeb = useCallback(async (query: string) => {
    if (!query.trim()) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const currentTurn = ++turnRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/web-search?q=${encodeURIComponent(query.trim())}`, {
        signal: controller.signal,
      });
      if (currentTurn !== turnRef.current) return;
      if (!res.ok) throw new Error('Search failed');

      const data = await res.json();
      const results: WebSearchResult[] = (data.results || []).map((r: { title: string; url: string; snippet: string }) => ({
        title: r.title,
        url: r.url,
        snippet: r.snippet,
      }));

      if (results.length === 0 && !data.instantAnswer) {
        setIsLoading(false);
        handleError('FETCH_FAILED', 'No web results found', true);
        return;
      }

      const ctx: VisualContext = {
        cardType: 'web-search',
        query: query.trim(),
        confidence: 0.95,
        extractedKeywords: [],
        images: [],
        toolData: {
          results,
          instantAnswer: data.instantAnswer || undefined,
          source: data.source || undefined,
          sourceUrl: data.sourceUrl || undefined,
        },
      };

      setIsLoading(false);
      updateContext(ctx);
    } catch {
      if (currentTurn !== turnRef.current) return;
      handleError('FETCH_FAILED', 'Web search failed', true);
    }
  }, [updateContext, handleError]);

  const clear = useCallback(() => {
    abortRef.current?.abort();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    turnRef.current++;
    setContext(null);
    setIsLoading(false);
    setError(null);
  }, []);

  // Cleanup on unmount — prevent setState on dead component, cancel in-flight fetches
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      turnRef.current++;
    };
  }, []);

  return {
    context,
    isLoading,
    error,
    updateFromMessage,
    updateFromResponse,
    updateFromToolResult,
    searchWeb,
    clear,
  };
}

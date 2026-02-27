/**
 * Shared Error Utilities
 * Typed error handling, retry logic, and API error responses.
 */

import { NextResponse } from 'next/server';

// ─── Typed Error Classes ───

export class VinegarError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 500) {
    super(message);
    this.name = 'VinegarError';
  }
}

export class ToolError extends VinegarError {
  constructor(toolName: string, message: string) {
    super(`Tool "${toolName}": ${message}`, 'TOOL_ERROR', 400);
    this.name = 'ToolError';
  }
}

export class APIError extends VinegarError {
  constructor(message: string, statusCode: number = 500) {
    super(message, 'API_ERROR', statusCode);
    this.name = 'APIError';
  }
}

export class DatabaseError extends VinegarError {
  constructor(operation: string, cause?: unknown) {
    const msg = cause instanceof Error ? cause.message : 'Unknown database error';
    super(`DB ${operation}: ${msg}`, 'DB_ERROR', 500);
    this.name = 'DatabaseError';
  }
}

// ─── Retry Logic ───

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
}

/**
 * Retry an async operation with exponential backoff.
 * Default: 2 retries, 500ms base delay, retry on network errors only.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 2,
    baseDelayMs = 500,
    maxDelayMs = 5000,
    retryOn = isRetryableError,
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxRetries || !retryOn(err)) throw err;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function isRetryableError(err: unknown): boolean {
  if (err instanceof Error) {
    // Network errors, timeouts, 429, 5xx
    if (err.name === 'AbortError') return true;
    if (err.message.includes('ECONNRESET')) return true;
    if (err.message.includes('fetch failed')) return true;
    if (err.message.includes('429')) return true;
    if (err.message.match(/5\d\d/)) return true;
  }
  return false;
}

// ─── API Route Error Handler ───

/**
 * Wrap an API route handler with consistent error handling.
 * Returns proper JSON errors with appropriate status codes.
 */
export function apiHandler(
  handler: (request: Request) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request: Request) => {
    try {
      return await handler(request);
    } catch (err) {
      if (err instanceof VinegarError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: err.statusCode }
        );
      }

      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error(`[API] ${request.method} ${new URL(request.url).pathname}: ${message}`);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}

// ─── Safe DB Operation ───

/**
 * Execute a database operation with error logging.
 * Returns undefined on failure instead of throwing.
 */
export function safeDB<T>(operation: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    console.error(`[DB] ${operation}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

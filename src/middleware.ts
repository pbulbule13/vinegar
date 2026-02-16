/**
 * Next.js Middleware
 * Adds authentication + rate limiting to all API routes.
 * Uses a shared secret (VINEGAR_AUTH_TOKEN env var).
 * If no token is configured, auth is disabled (dev mode).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/api/health',
];

// ─── Rate Limiting (in-memory, per-IP) ───
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute per IP
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

// Clean stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  rateLimitMap.forEach((val, key) => {
    if (now > val.resetAt) rateLimitMap.delete(key);
  });
}, 300_000);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (record && now < record.resetAt) {
    record.count++;
    return record.count <= RATE_LIMIT_MAX;
  }

  rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  return true;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip for non-API routes (pages, static assets)
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip auth/rate-limit for public paths
  if (PUBLIC_PATHS.some(p => pathname === p)) {
    return NextResponse.next();
  }

  // ─── Rate Limiting ───
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown';
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in a minute.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // ─── Authentication ───
  const authToken = process.env.VINEGAR_AUTH_TOKEN;

  // If no auth token configured, skip auth (dev/LAN mode)
  if (!authToken) {
    return NextResponse.next();
  }

  // Check Authorization header or cookie
  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '');
  const cookieToken = request.cookies.get('vinegar_auth')?.value;

  if (headerToken === authToken || cookieToken === authToken) {
    return NextResponse.next();
  }

  return NextResponse.json(
    { error: 'Unauthorized' },
    { status: 401 }
  );
}

export const config = {
  matcher: '/api/:path*',
};

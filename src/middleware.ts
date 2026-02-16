/**
 * Next.js Middleware
 * Adds authentication to all API routes.
 * Uses a shared secret (VINEGAR_AUTH_TOKEN env var).
 * If no token is configured, auth is disabled (dev mode).
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = [
  '/api/health',
];

export function middleware(request: NextRequest) {
  const authToken = process.env.VINEGAR_AUTH_TOKEN;

  // If no auth token configured, skip auth (dev/LAN mode)
  if (!authToken) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  // Skip auth for non-API routes (pages, static assets)
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Skip auth for public paths
  if (PUBLIC_PATHS.some(p => pathname === p)) {
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

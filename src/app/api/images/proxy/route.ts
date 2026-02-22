/**
 * SSRF-hardened image proxy.
 * Only proxies images from allowlisted hostnames (Pexels, Unsplash).
 * Prevents: SSRF, private IP access, redirect attacks, non-image content.
 */

import { imageProxySchema } from '@/lib/validators';

// Strict hostname allowlist — only known image CDNs
const ALLOWED_HOSTNAMES = new Set([
  'images.pexels.com',
  'images.unsplash.com',
]);

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const parsed = imageProxySchema.safeParse({ url: searchParams.get('url') || '' });

    if (!parsed.success) {
      return new Response('Invalid URL', { status: 400 });
    }

    const targetUrl = parsed.data.url;

    // Parse and validate URL
    let url: URL;
    try {
      url = new URL(targetUrl);
    } catch {
      return new Response('Invalid URL format', { status: 400 });
    }

    // HTTPS only
    if (url.protocol !== 'https:') {
      return new Response('HTTPS required', { status: 400 });
    }

    // Strict hostname allowlist
    if (!ALLOWED_HOSTNAMES.has(url.hostname)) {
      return new Response('Host not allowed', { status: 403 });
    }

    // Fetch the image
    const res = await fetch(targetUrl, {
      redirect: 'error', // Block SSRF via redirects
      signal: AbortSignal.timeout(10000),
      headers: {
        'Accept': 'image/*',
      },
    });

    if (!res.ok) {
      return new Response('Upstream error', { status: 502 });
    }

    // Content-Type validation: must be image/*
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new Response('Not an image', { status: 415 });
    }

    // Size limit: 5MB
    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024) {
      return new Response('Image too large', { status: 413 });
    }

    // Stream the image through
    const body = res.body;
    if (!body) {
      return new Response('No content', { status: 502 });
    }

    return new Response(body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Proxy error', { status: 500 });
  }
}

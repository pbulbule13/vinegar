"use client";

import { memo, useState } from "react";
import type { ImageResult } from "@/types/visual-context";

interface ContextImageProps {
  image: ImageResult;
  className?: string;
}

export const ContextImage = memo(function ContextImage({ image, className = "" }: ContextImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  if (error) return null; // Graceful hide — card without image is still useful

  // Proxy image through our SSRF-safe endpoint
  const proxiedUrl = `/api/images/proxy?url=${encodeURIComponent(image.url)}`;

  // Sanitize credit URL — block javascript: and non-http(s) schemes
  const safeCreditUrl = (() => {
    if (!image.creditUrl) return null;
    try {
      const parsed = new URL(image.creditUrl);
      return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? image.creditUrl : null;
    } catch {
      return null;
    }
  })();

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Loading skeleton */}
      {!loaded && (
        <div className="absolute inset-0 bg-gradient-to-r from-amber-500/5 via-amber-500/10 to-amber-500/5 animate-pulse" />
      )}

      <img
        src={proxiedUrl}
        alt={image.alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        onError={() => setError(true)}
        className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Credit overlay */}
      {image.credit && loaded && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
          {safeCreditUrl ? (
            <a
              href={safeCreditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[8px] text-white/50 hover:text-white/70 transition-colors"
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
            >
              {image.credit}
            </a>
          ) : (
            <span
              className="text-[8px] text-white/50"
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}
            >
              {image.credit}
            </span>
          )}
        </div>
      )}
    </div>
  );
});

"use client";

import { memo } from "react";
import type { VisualContext, CardType } from "@/types/visual-context";
import { ContextImage } from "./context-image";
import { ExternalLink, Globe, Search } from "lucide-react";

// Type-colored accent bars
const ACCENT_COLORS: Record<CardType, string> = {
  weather: 'border-l-sky-400',
  place: 'border-l-violet-400',
  recipe: 'border-l-amber-500',
  traffic: 'border-l-orange-400',
  'image-only': 'border-l-slate-500',
  'web-search': 'border-l-emerald-400',
};

interface CardField {
  label: string;
  value: string;
}

function getCardFields(context: VisualContext): { title: string; fields: CardField[]; hero?: { value: string; unit?: string } } {
  switch (context.cardType) {
    case 'weather':
      return {
        title: context.toolData.location || 'Weather',
        hero: { value: `${context.toolData.temperature}°`, unit: '' },
        fields: [
          { label: 'Condition', value: context.toolData.condition },
          { label: 'Humidity', value: `${context.toolData.humidity}%` },
        ],
      };
    case 'place':
      return {
        title: context.toolData.name || 'Place',
        fields: [
          { label: 'Address', value: context.toolData.address },
          ...(context.toolData.rating ? [{ label: 'Rating', value: `${'★'.repeat(Math.round(context.toolData.rating))} ${context.toolData.rating}` }] : []),
        ],
      };
    case 'recipe':
      return {
        title: context.toolData.recipeName || 'Recipe',
        fields: [
          ...(context.toolData.prepTime ? [{ label: 'Prep', value: context.toolData.prepTime }] : []),
          ...(context.toolData.ingredients.length > 0 ? [{ label: 'Ingredients', value: context.toolData.ingredients.slice(0, 5).join(', ') }] : []),
        ],
      };
    case 'traffic':
      return {
        title: context.toolData.route || 'Traffic',
        hero: { value: `${context.toolData.durationMinutes}`, unit: 'min' },
        fields: [
          { label: 'Distance', value: `${context.toolData.distanceMiles} mi` },
        ],
      };
    case 'image-only':
      return {
        title: context.query,
        fields: [],
      };
    case 'web-search':
      return {
        title: context.query,
        fields: context.toolData.instantAnswer
          ? [{ label: 'Answer', value: context.toolData.instantAnswer }]
          : [],
      };
  }
}

interface ContextCardProps {
  context: VisualContext;
}

export const ContextCard = memo(function ContextCard({ context }: ContextCardProps) {
  const { title, fields, hero } = getCardFields(context);
  const accentClass = ACCENT_COLORS[context.cardType];
  const hasImage = context.images.length > 0;
  const isWebSearch = context.cardType === 'web-search';

  return (
    <div className={`rounded-xl overflow-hidden border border-white/5 bg-[#0a0a0f]/80 backdrop-blur-sm border-l-2 ${accentClass} motion-safe:animate-fadeIn`}>
      {/* Hero image (skip for web-search cards) */}
      {hasImage && !isWebSearch && (
        <ContextImage
          image={context.images[0]}
          className="aspect-[16/10] w-full"
        />
      )}

      {/* Card content */}
      <div className="p-3 space-y-2">
        {/* Title + hero value */}
        <div className="flex items-baseline justify-between gap-2">
          {isWebSearch ? (
            <div className="flex items-center gap-1.5">
              <Search className="w-3 h-3 text-emerald-400/60" />
              <h3 className="text-xs font-medium text-white/80 truncate capitalize">{title}</h3>
            </div>
          ) : (
            <h3 className="text-xs font-medium text-white/80 truncate capitalize">{title}</h3>
          )}
          {hero && (
            <span className="text-lg font-orbitron text-amber-400 whitespace-nowrap">
              {hero.value}
              {hero.unit && <span className="text-[10px] text-white/30 ml-0.5">{hero.unit}</span>}
            </span>
          )}
        </div>

        {/* Instant answer for web-search */}
        {isWebSearch && context.toolData?.instantAnswer && (
          <div className="px-2 py-1.5 rounded-md bg-emerald-500/5 border border-emerald-500/10">
            <p className="text-[11px] text-white/70 leading-relaxed">{context.toolData.instantAnswer}</p>
            {context.toolData.source && (
              <span className="text-[9px] text-emerald-400/40 font-mono">{context.toolData.source}</span>
            )}
          </div>
        )}

        {/* Web search results — clickable links */}
        {isWebSearch && context.toolData?.results && context.toolData.results.length > 0 && (
          <div className="space-y-1.5">
            {context.toolData.results.map((result, i) => (
              <a
                key={i}
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors group border border-transparent hover:border-white/10"
              >
                <div className="flex items-start gap-1.5">
                  <Globe className="w-3 h-3 text-white/20 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-emerald-400/80 group-hover:text-emerald-300 truncate leading-tight">{result.title}</span>
                      <ExternalLink className="w-2.5 h-2.5 text-white/15 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    {result.snippet && (
                      <p className="text-[10px] text-white/35 leading-tight mt-0.5 line-clamp-2">{result.snippet}</p>
                    )}
                    <span className="text-[8px] text-white/15 font-mono truncate block mt-0.5">{new URL(result.url).hostname}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}

        {/* Fields (non web-search) */}
        {!isWebSearch && fields.length > 0 && (
          <div className="space-y-1">
            {fields.map((field) => (
              <div key={field.label} className="flex items-start gap-2">
                <span className="text-[9px] font-mono text-white/30 uppercase tracking-wider min-w-[60px]">{field.label}</span>
                <span className="text-[11px] text-white/60 leading-tight">{field.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Card type badge */}
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-white/20 uppercase tracking-wider">{context.cardType}</span>
          {context.confidence < 0.7 && (
            <span className="text-[8px] text-white/10">approx.</span>
          )}
        </div>
      </div>
    </div>
  );
});

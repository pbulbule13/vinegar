"use client";

/**
 * Reusable skeleton loading components for dashboard widgets.
 * Uses CSS shimmer animation matching the dark theme.
 */

export function SkeletonLine({ width = "100%", height = "h-3" }: { width?: string; height?: string }) {
  return (
    <div
      className={`${height} rounded bg-steel-dark/50 animate-pulse`}
      style={{ width }}
    />
  );
}

export function SkeletonBlock({ lines = 3 }: { lines?: number }) {
  const widths = ["100%", "85%", "70%", "90%", "60%"];
  return (
    <div className="space-y-2.5 py-1">
      {Array.from({ length: lines }, (_, i) => (
        <SkeletonLine key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}

export function SkeletonListItem() {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <div className="w-4 h-4 rounded bg-steel-dark/50 animate-pulse shrink-0" />
      <SkeletonLine width={`${55 + Math.random() * 35}%`} />
    </div>
  );
}

export function SkeletonList({ items = 4 }: { items?: number }) {
  return (
    <div className="space-y-1">
      {Array.from({ length: items }, (_, i) => (
        <SkeletonListItem key={i} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 text-center">
      <div className="text-steel-mid/40 mb-2">{icon}</div>
      <p className="text-xs text-text-muted">{title}</p>
      {description && (
        <p className="text-[10px] text-text-muted/60 mt-1">{description}</p>
      )}
    </div>
  );
}

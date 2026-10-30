import { RATIO, type Ratio } from "./media";

/* Pending states. The shimmer is a slow opacity pulse rather than a sliding
   gradient, and `prefers-reduced-motion` stops it dead (see globals.css). */

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-sunken ${className}`} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="block space-y-2" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3 ${index === lines - 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </span>
  );
}

export function SkeletonTile({ ratio = "3:4" }: { ratio?: Ratio }) {
  return <Skeleton className={`w-full ${RATIO[ratio]}`} />;
}

/** A whole grid of tiles, for a media section that is still loading. */
export function SkeletonGrid({ count = 6, ratio = "3:4" }: { count?: number; ratio?: Ratio }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <SkeletonTile key={index} ratio={ratio} />
      ))}
    </div>
  );
}

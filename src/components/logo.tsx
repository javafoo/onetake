import { PRODUCT_NAME } from "@/lib/product";

/* The wordmark: the O of OneTake is a play button, because what you get is a
   finished post, ready to play. Drawn at the size of the text around it. */

/** The play-button O on its own, for the wordmark and the tab icon. */
export function PlayO({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden className={className}>
      <circle cx="50" cy="50" r="46" fill="var(--color-accent, #7b2f3e)" />
      <path d="M41 32 L70 50 L41 68 Z" fill="var(--color-canvas, #fbf8f3)" strokeLinejoin="round" stroke="var(--color-canvas, #fbf8f3)" strokeWidth="4" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center font-display tracking-tight text-ink ${className}`} aria-label={PRODUCT_NAME} role="img">
      <PlayO className="mr-[0.04em] size-[0.86em] shrink-0 translate-y-[0.02em]" />
      <span aria-hidden>{PRODUCT_NAME.slice(1)}</span>
    </span>
  );
}

import type { ReactNode } from "react";

import { CostTag } from "@/components/ui";

/* The generators and the uploader sit closed above the grid. Opening one is a
   deliberate act, and the price is on the outside of the drawer, before it is
   opened — `credits` is left out on the one that is free, so the brass price
   tag itself means "this costs money". */
export function Drawer({
  id,
  title,
  summary,
  credits,
  creditsTo,
  open = false,
  children,
}: {
  id?: string;
  title: string;
  summary: string;
  credits?: number;
  /** Set where the drawer holds a choice of prices: the tag reads "3–5 credits". */
  creditsTo?: number;
  /** Open on arrival, for a link that brought someone here to use it. */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details id={id} open={open} className="group rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex min-h-16 list-none items-center gap-4 px-4 py-4 sm:px-6">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg text-ink">{title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
            {credits === undefined ? <FreeTag /> : <CostTag credits={credits} to={creditsTo} />}
            <span className="text-sm text-muted">{summary}</span>
          </span>
        </span>
        <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 shrink-0 text-muted transition-transform group-open:rotate-180">
          <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="border-t border-line p-4 sm:p-6">{children}</div>
    </details>
  );
}

/** The counterpart to `<CostTag>`: quiet, and says the thing it is on is free. */
export function FreeTag() {
  return (
    <span className="inline-flex items-center rounded-full border border-line-strong bg-sunken px-2 py-0.5 text-2xs font-semibold text-ink-soft">
      Free
    </span>
  );
}

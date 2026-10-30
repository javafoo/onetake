import type { ReactNode } from "react";

import { CheckIcon } from "./icons";

export type BadgeTone = "good" | "warn" | "plain" | "accent" | "spend";

const TONES: Record<BadgeTone, string> = {
  good: "border-good/20 bg-good-soft text-good",
  warn: "border-warn/25 bg-warn-soft text-warn",
  plain: "border-line-strong bg-sunken text-ink-soft",
  accent: "border-accent/20 bg-accent-soft text-accent",
  spend: "border-spend-line bg-spend-soft text-spend",
};

export function Badge({ tone = "plain", children, className = "" }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-2xs font-semibold tracking-wide whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Done / to-do in one shape, so the eye can count progress at a glance. */
export function DoneDot({ done, label }: { done: boolean; label?: string }) {
  return (
    <span
      className={`grid size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-semibold ${
        done ? "bg-good text-white" : "border border-line-strong bg-surface text-muted"
      }`}
    >
      {done ? <CheckIcon className="size-3" /> : label}
    </span>
  );
}

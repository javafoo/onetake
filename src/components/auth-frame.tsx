import type { ReactNode } from "react";

import { Logo } from "@/components/logo";

/* The signed-out shell. Two columns on a laptop, one on a phone: the promise
   first, the form second, and no chrome around either. */
export function AuthFrame({ headline, lead, children }: { headline: string; lead: string; children: ReactNode }) {
  return (
    <div className="min-h-screen md:grid md:grid-cols-2">
      <section className="flex flex-col justify-between gap-10 border-line px-gutter py-10 md:border-r md:px-12 md:py-14">
        <p className="text-3xl">
          <Logo />
        </p>
        <div className="max-w-md">
          <h1 className="font-display text-3xl tracking-tight text-balance text-ink md:text-5xl">{headline}</h1>
          <p className="mt-4 text-base text-pretty text-ink-soft">{lead}</p>
        </div>
        <p className="hidden text-xs text-muted md:block">Built with NVIDIA Nemotron on Nebius Token Factory.</p>
      </section>
      <section className="flex flex-col items-center justify-center gap-6 bg-surface px-gutter py-10 md:py-14">
        {children}
        <p className="max-w-sm text-center text-xs text-muted">Only upload photos of yourself, or photos you have the right to use. You must be 18 or over.</p>
      </section>
    </div>
  );
}

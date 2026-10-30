import type { ReactNode } from "react";

/* The top of every page: which step this is, the name in the display serif, one
   line of plain-words lead, and the page's own controls on the right. */

export function PageHeader({
  eyebrow,
  title,
  lead,
  children,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`mb-8 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 max-w-2xl">
          {eyebrow && <p className="eyebrow mb-2 text-muted">{eyebrow}</p>}
          <h1 className="font-display text-3xl tracking-tight text-balance text-ink sm:text-4xl">{title}</h1>
          {lead && <p className="mt-3 text-base text-pretty text-ink-soft">{lead}</p>}
        </div>
        {children && <div className="flex shrink-0 flex-wrap items-center gap-3">{children}</div>}
      </div>
    </header>
  );
}

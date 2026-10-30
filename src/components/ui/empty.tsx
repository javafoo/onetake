import type { ReactNode } from "react";

/* An empty state says the one next thing to do, and offers the control that
   does it. `title` is the state, `children` is the instruction, `action` is the
   way out. Nothing decorative. */

export function EmptyState({
  title,
  children,
  action,
  className = "",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center ${className}`}>
      <p className="font-display text-xl text-ink">{title}</p>
      {children && <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{children}</p>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

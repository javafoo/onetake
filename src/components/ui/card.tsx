import type { ReactNode } from "react";

/* Paper. One card style, three weights of prominence, no nesting of borders. */

export function Card({
  children,
  className = "",
  as: Tag = "section",
  tone = "paper",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
  tone?: "paper" | "sunken" | "quiet";
  /** For a link that lands on this card. */
  id?: string;
}) {
  const tones = {
    paper: "border border-line bg-surface shadow-card",
    sunken: "border border-line bg-sunken",
    quiet: "border border-line bg-transparent",
  };
  return <Tag id={id} className={`rounded-xl ${tones[tone]} ${className}`}>{children}</Tag>;
}

/** A titled block of a page: small-caps eyebrow, optional line, optional action. */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
  id,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={className}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h2 className="eyebrow text-muted">{title}</h2>
          {description && <p className="mt-1.5 max-w-prose text-sm text-ink-soft">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** An inline, quiet aside: the source note, the "what happens next" line. */
export function Note({ children, tone = "plain", className = "" }: { children: ReactNode; tone?: "plain" | "warn" | "spend"; className?: string }) {
  const tones = {
    plain: "border-line bg-sunken text-ink-soft",
    warn: "border-warn/25 bg-warn-soft text-warn",
    spend: "border-spend-line bg-spend-soft text-spend",
  };
  return <p className={`rounded-lg border px-4 py-3 text-sm ${tones[tone]} ${className}`}>{children}</p>;
}

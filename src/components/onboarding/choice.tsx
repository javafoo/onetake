import type { ReactNode } from "react";

/* A radio dressed as a card: the whole row is the tap target, which is the only
   shape that works with a thumb. The same component carries the "coming soon"
   option, which is present and plainly unavailable rather than hidden — being
   told a thing does not exist yet beats wondering where it went.

   The checked styling hangs off the label (`group-has-[:checked]`) rather than
   off the input's siblings: the marks it has to reach are nested, and the peer
   combinator only ever sees siblings. */

export function ChoiceCard({
  name,
  value,
  title,
  children,
  defaultChecked,
  disabled,
  note,
}: {
  name: string;
  value: string;
  title: string;
  children?: ReactNode;
  defaultChecked?: boolean;
  disabled?: boolean;
  /** Right-hand label, for example "Coming soon". */
  note?: string;
}) {
  return (
    <label
      className={`group relative block rounded-xl border p-4 transition-colors ${
        disabled
          ? "cursor-not-allowed border-line bg-sunken/60"
          : "cursor-pointer border-line-strong bg-surface hover:border-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        disabled={disabled}
        className="sr-only"
      />
      <span className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border border-line-strong bg-surface group-has-[:checked]:border-accent"
        >
          <span className="size-2.5 rounded-full bg-accent opacity-0 group-has-[:checked]:opacity-100" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`font-medium ${disabled ? "text-muted" : "text-ink"}`}>{title}</span>
            {note && (
              <span className="rounded-full border border-line-strong bg-sunken px-2 py-0.5 text-2xs font-semibold tracking-wide text-muted">
                {note}
              </span>
            )}
          </span>
          {children && <span className="mt-1 block text-sm text-muted">{children}</span>}
        </span>
      </span>
    </label>
  );
}

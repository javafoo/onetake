import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/* Form controls. Every control is wrapped by `Field`, which owns the visible
   label and the hint, so an input without a label is not something a page can
   accidentally write. */

/* No `outline-none` here: the focus ring in globals.css is the one focus
   treatment in the product, and a control that removes it is unusable by
   keyboard. The border change is on top of it, not instead of it. */
export const FIELD =
  "w-full rounded-md border border-line-strong bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted/70 transition-colors focus:border-accent sm:text-sm";

const LABEL = "block text-sm font-medium text-ink";
const HINT = "mt-1 text-xs text-muted";

type FieldProps = {
  label: string;
  hint?: ReactNode;
  /** Right-hand note on the label row, e.g. a character budget. */
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Field({ label, hint, aside, children, className = "" }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={LABEL}>{label}</span>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </span>
      {hint && <span className={`${HINT} block`}>{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD} ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD} resize-y leading-relaxed ${className}`} {...rest} />;
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={`${FIELD} min-h-11 appearance-none pr-9 ${className}`} {...rest}>
        {children}
      </select>
      <svg
        viewBox="0 0 12 8"
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-3 -translate-y-1/2 text-muted"
      >
        <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** A labelled group of related controls. */
export function Fieldset({ legend, hint, children, className = "" }: { legend: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={className}>
      <legend className={LABEL}>{legend}</legend>
      {hint && <p className={HINT}>{hint}</p>}
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}

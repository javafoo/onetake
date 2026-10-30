import type { ButtonHTMLAttributes, ReactNode } from "react";

/* Button variants.

   `spend` is the only coloured button in the product: brass, with the price
   printed inside it. If a tap costs the creator money it wears this, and
   nothing that is free ever does, so the colour itself is the warning. */

export type ButtonVariant = "primary" | "accent" | "quiet" | "ghost" | "spend" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium tracking-tight transition-colors disabled:cursor-wait disabled:opacity-55";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-ink text-canvas hover:bg-black",
  accent: "bg-accent text-white hover:bg-accent-strong",
  quiet: "border border-line-strong bg-surface text-ink hover:border-ink hover:bg-sunken/40",
  ghost: "text-ink-soft hover:bg-sunken hover:text-ink",
  spend: "border border-spend-line bg-spend-soft text-spend hover:bg-spend-line/45",
  /* Outlined rather than filled: the one destructive button in the product
     should read as serious, not as the obvious thing to press. */
  danger: "border border-accent bg-surface text-accent hover:bg-accent hover:text-white",
};

const SIZE: Record<ButtonSize, string> = {
  // Every size clears a 44px tap target on a phone; `sm` is allowed to shrink
  // once there is a mouse pointer and a bigger screen.
  sm: "min-h-11 px-3 text-xs sm:min-h-9",
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]} ${extra}`.trim();
}

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
};

export function Button({ variant = "primary", size = "md", className = "", type = "button", ...rest }: Props) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

/* A photo is one credit now, so every price on a control has to be able to
   say "1 credit" without the s. One helper, used by all of them. */
export const creditWord = (credits: number) => `${credits} credit${credits === 1 ? "" : "s"}`;

/** The price, printed inside or beside the control that charges it. `to` makes
    it a range, for a control whose price depends on what is chosen inside it. */
export function CostTag({ credits, to, className = "" }: { credits: number; to?: number; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border border-spend-line bg-spend-soft px-2 py-0.5 text-2xs font-semibold text-spend ${className}`}
    >
      {to === undefined || to === credits ? creditWord(credits) : `${credits}–${creditWord(to)}`}
    </span>
  );
}

/** Plain-words price in a sentence: "Costs 3 credits.", "Costs 1 credit." */
export const costSentence = (credits: number) => `Costs ${creditWord(credits)}.`;

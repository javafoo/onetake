import Link from "next/link";
import type { ReactNode } from "react";

import type { EntitlementUser } from "@/billing/entitlements";
import { decidePaidAction } from "@/billing/gate";
import { buttonClass } from "@/components/ui/button";

/* The one place a paid control is allowed to appear.
 *
 * Given who this is, what they have and what the action costs, it either shows
 * the control or replaces it with the reason and the link that fixes it. The
 * point of replacing rather than disabling: a disabled button explains nothing
 * and still invites a tap. The decision is the same pure function the job
 * itself will apply a moment later (`requireCanGenerate`, then `reserve`), so
 * the page and the server cannot disagree about whether a tap will work.
 */

type Props = {
  /** The `users` row, or its id. */
  user: EntitlementUser;
  balance: number;
  /** The price of the action, from `creditsFor`. */
  cost: number;
  /** What it makes, in the user's words: "photo", "clip". */
  noun: string;
  children: ReactNode;
  /**
   * Set when a `<PaidActionNotice>` higher up the page already explains why
   * generating is off. The control is then simply hidden rather than repeating
   * the same paragraph; a shortfall of credits is specific to this action, so
   * that one is still said here.
   */
  quiet?: boolean;
  className?: string;
};

type NoticeProps = Omit<Props, "children"> & {
  /**
   * Replaces the shortfall sentence, for a page that sells more than one
   * thing and wants to price them all in one breath.
   */
  lowCreditsDetail?: string;
};

const TONES = {
  low_credits: "border-spend-line bg-spend-soft",
} as const;

/**
 * The blocked half on its own: the explanation and the link, or nothing at all
 * when the action is allowed. For a page with many copies of the same button,
 * where repeating the same paragraph beside each one would be shouting.
 */
export function PaidActionNotice({ user, balance, cost, noun, lowCreditsDetail, className = "" }: NoticeProps) {
  const decision = decidePaidAction({ user, balance, cost, noun });
  if (decision.allowed) return null;
  const detail = decision.reason === "low_credits" && lowCreditsDetail ? lowCreditsDetail : decision.detail;

  return (
    <div className={`rounded-xl border px-4 py-5 sm:px-6 ${TONES[decision.reason]} ${className}`}>
      <p className="font-display text-lg text-ink">{decision.headline}</p>
      <p className="mt-1.5 max-w-prose text-sm text-ink-soft">{detail}</p>
      <Link
        href={decision.fix.href}
        className={buttonClass(decision.reason === "low_credits" ? "spend" : "primary", "md", "mt-4")}
      >
        {decision.fix.label}
      </Link>
    </div>
  );
}

export function PaidActionGate({ user, balance, cost, noun, children, quiet = false, className = "" }: Props) {
  const decision = decidePaidAction({ user, balance, cost, noun });

  if (!decision.allowed) {
    if (quiet && decision.reason !== "low_credits") return null;
    return <PaidActionNotice user={user} balance={balance} cost={cost} noun={noun} className={className} />;
  }

  /* A free action (assembling a reel) still needs the entitlement check above,
     and a word about credits under it would imply it costs something. */
  if (cost === 0) return <div className={className}>{children}</div>;

  /* Allowed, but worth a word if there is not much left: running out halfway
     through an afternoon of work is the thing this is here to prevent. It says
     how many more it buys, not the balance: that number is on Billing only. */
  if (decision.runsLeft > 3) return <div className={className}>{children}</div>;

  return (
    <div className={className}>
      {children}
      <p className="mt-3 text-xs text-spend">
        Enough credits for {decision.runsLeft} more {noun}
        {decision.runsLeft === 1 ? "" : "s"}.{" "}
        <Link href="/billing#credits" className="font-semibold underline underline-offset-2">
          Add credits
        </Link>
      </p>
    </div>
  );
}

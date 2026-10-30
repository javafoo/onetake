/* The safety net, not the business model.

   Credits are what a user pays; this is what we pay. Every paid call is
   recorded in `provider_costs` before it is made, so a crash mid-request still
   counts against the day and the cap cannot be raced past by much. It is a
   hard stop across all users, meant to bound the damage from a bug or an abuse
   run, and it is deliberately separate from `GENERATION_DAILY_BUDGET_USD`,
   which capped the old synchronous path. */

export const DEFAULT_GLOBAL_DAILY_BUDGET_USD = 25;

export function globalDailyBudgetUsd(): number {
  const raw = process.env.GLOBAL_DAILY_BUDGET_USD;
  if (raw === undefined || raw.trim() === "") return DEFAULT_GLOBAL_DAILY_BUDGET_USD;
  const cap = Number(raw);
  if (!Number.isFinite(cap) || cap < 0) throw new Error("GLOBAL_DAILY_BUDGET_USD must be a number >= 0");
  return cap;
}

export class BudgetExceededError extends Error {
  readonly spentUsd: number;
  readonly capUsd: number;
  readonly requestedUsd: number;

  constructor(spentUsd: number, capUsd: number, requestedUsd: number) {
    super(
      "We have hit our own daily limit for making photos and clips. Nothing was charged. " +
        "Try again tomorrow, or email us if it is urgent.",
    );
    this.name = "BudgetExceededError";
    /* The figures are for us, not the user: the message above is shown as it
       is, and three places throw this, so the one log line lives here. */
    console.warn(
      `budget: daily cap reached — $${spentUsd.toFixed(2)} spent of $${capUsd.toFixed(2)}, $${requestedUsd.toFixed(2)} asked`,
    );
    this.spentUsd = spentUsd;
    this.capUsd = capUsd;
    this.requestedUsd = requestedUsd;
  }
}

/** True when one more call of `costUsd` would take us past the cap. */
export function overBudget(spentUsd: number, costUsd: number, capUsd: number): boolean {
  return spentUsd + costUsd > capUsd + 1e-9;
}

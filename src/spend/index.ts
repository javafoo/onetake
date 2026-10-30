import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

import { ACTION_ESTIMATE_USD, type ActionShape } from "@/ai/estimates";
import { TEXT_MODEL } from "@/ai/gemini";
import { reportUsage, setUsageSink, type ObservedCall } from "@/ai/usage";
import { reserveSpend, settleSpend } from "@/data/spend";
import { BudgetExceededError, globalDailyBudgetUsd } from "@/jobs/budget";
import { requireVerifiedForFreeUse } from "@/lib/email-gate";
import { requireWithinLimit, type LimitedUser } from "@/lib/rate-limit";
import type { LimitName } from "@/lib/limits";

/* The front door for every model call that is not a job.
 *
 * `startJob` has always checked entitlement and the daily cap. Nothing else
 * did, and most of what calls Gemini is not a job: hook writing, the whole
 * setup interview, topic suggestions, face finding, the brief builder. Those
 * calls were invisible to `GLOBAL_DAILY_BUDGET_USD` and to `provider_costs`,
 * so the cap counted a fraction of what we actually spend and a free account
 * could loop any of them.
 *
 * `withModelSpend` does four things, in this order, because the order is the
 * protection: an account with no plan has to have a confirmed email address
 * (an inbox is the one thing a seconds-old account cannot fake in a loop),
 * then the person's own limit (cheapest, and refuses the abuse case), then
 * the global cap with the cost reserved in the same statement, then the work. Afterwards the reservation is settled with what the calls
 * really cost, read from Gemini's own token counts where the response carried
 * them.
 */

interface SpendScope {
  calls: ObservedCall[];
}

const scope = new AsyncLocalStorage<SpendScope>();

/* Installed once, when this module is first imported — which is when a server
   action or a route handler is loaded, because those are the only things that
   import it. A call made outside a scope is reported into nothing, which is
   what the CLI scripts want. */
setUsageSink((call) => {
  scope.getStore()?.calls.push(call);
});

/** Re-exported so a caller can report a non-Gemini cost into the open scope. */
export { reportUsage };

export interface SpendOptions {
  /** The person's own limit to take from. */
  limit: LimitName;
  /** What this action is expected to cost us. */
  shape: ActionShape;
  /** Counts as this many against the named limit. */
  cost?: number;
  /** Extra detail for the `provider_costs` row. Never a prompt and never bytes. */
  meta?: Record<string, unknown>;
}

/**
 * Run `fn` with its provider spend limited, capped and recorded.
 *
 * Throws `EmailNotVerifiedError` when an account has not confirmed its
 * address, `RateLimitedError` when the person is over their own
 * allowance and `BudgetExceededError` when the app is over its daily one. All
 * three carry a message that can be shown as written.
 */
export async function withModelSpend<T>(
  user: LimitedUser,
  options: SpendOptions,
  fn: () => Promise<T>,
): Promise<T> {
  /* The allowance first: it is one conditional upsert on our own database.
     The email check can cost a Clerk call, and a loop of refused attempts must
     be stopped by the limiter, not by Clerk's rate limit. */
  await requireWithinLimit(user, options.limit, { cost: options.cost });
  await requireVerifiedForFreeUse(user);

  const estimate = ACTION_ESTIMATE_USD[options.shape];
  const cap = globalDailyBudgetUsd();
  const reservation = await reserveSpend(
    {
      userId: user.id,
      provider: "gemini",
      model: TEXT_MODEL(),
      kind: options.shape,
      costUsd: estimate,
      meta: { estimate: true, ...options.meta },
    },
    cap,
  );
  if (!reservation.ok) throw new BudgetExceededError(reservation.spentUsd, cap, estimate);

  const calls: ObservedCall[] = [];
  try {
    return await scope.run({ calls }, fn);
  } finally {
    /* Settled whatever happened. A call that threw halfway through still cost
       us whatever it had already spent, and a reservation that is never
       settled counts its estimate against the cap forever. */
    await settleSpend(reservation.id, {
      status: "done",
      costUsd: measured(calls),
      meta: { estimate: false, calls: calls.length },
    }).catch((error) => {
      console.error("spend: could not settle a provider cost —", error instanceof Error ? error.message : error);
    });
  }
}

/**
 * What the calls inside a scope really cost, or undefined.
 *
 * Undefined when no call reported a price — no response carried
 * `usageMetadata`, or nothing ran at all — and the estimate stands. A partial
 * answer is not used: if three calls ran and only two priced themselves, the
 * sum would be an undercount presented as a measurement, and undercounting is
 * exactly how a cap gets walked past.
 */
function measured(calls: ObservedCall[]): number | undefined {
  if (calls.length === 0) return undefined;
  if (calls.some((call) => call.costUsd === undefined)) return undefined;
  return calls.reduce((total, call) => total + (call.costUsd ?? 0), 0);
}

/**
 * The cap alone, for a call that is already limited some other way.
 *
 * Used by the photo upload endpoint, which has its own rate limit and does its
 * decoding locally, but whose screening pass is a model call like any other.
 */
export async function requireDailyBudget(estimateUsd: number): Promise<void> {
  const cap = globalDailyBudgetUsd();
  const reservation = await reserveSpend(
    { userId: null, provider: "gemini", model: TEXT_MODEL(), kind: "budget_check", costUsd: estimateUsd },
    cap,
  );
  if (!reservation.ok) throw new BudgetExceededError(reservation.spentUsd, cap, estimateUsd);
  await settleSpend(reservation.id, { status: "done" });
}

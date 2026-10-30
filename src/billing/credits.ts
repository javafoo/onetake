/* Credits: the balance, reservations, refunds and grants.

   The ledger in `credit_ledger` is append-only and the balance is its sum, so
   nothing here ever updates a row. Every account starts with `FREE_CREDITS`,
   granted once on first use; there is no way to buy more, so credits are a
   spending cap rather than a currency. Everything that touches the database
   goes through a `CreditStore` (see `store.ts`) so the whole file can be tested
   against an in-memory fake. */

import { FREE_CREDITS } from "./pricing";
import { dbCreditStore } from "./store.db";
import type { CreditStore, LedgerReason } from "./store";

export class InsufficientCreditsError extends Error {
  readonly balance: number;
  readonly required: number;
  readonly shortfall: number;

  constructor(balance: number, required: number) {
    const shortfall = required - balance;
    super(`Not enough credits: ${required} needed, ${balance} available, ${shortfall} short.`);
    this.name = "InsufficientCreditsError";
    this.balance = balance;
    this.required = required;
    this.shortfall = shortfall;
  }
}

/** The note the free grant carries. The store dedupes on it, so the grant lands once. */
export const FREE_GRANT_NOTE = "free_credits";

export async function balance(userId: string, store: CreditStore = dbCreditStore): Promise<number> {
  return store.balance(userId);
}

/**
 * Give this account its free credits if it has never had them. Idempotent:
 * the store writes the row only when no `free_grant` with the same note
 * exists, under the same lock a reservation takes, so two first requests
 * racing each other grant once. Returns true if the grant was written now.
 */
export async function ensureFreeCredits(userId: string, store: CreditStore = dbCreditStore): Promise<boolean> {
  return store.grant({ userId, credits: FREE_CREDITS, reason: "free_grant", note: FREE_GRANT_NOTE });
}

/** The balance a person can spend right now, after the free grant has landed. */
export async function spendableBalance(userId: string, store: CreditStore = dbCreditStore): Promise<number> {
  await ensureFreeCredits(userId, store);
  return store.balance(userId);
}

/**
 * Hold `credits` for `jobId`. Throws `InsufficientCreditsError` if the balance
 * does not cover it. The check and the write happen in one atomic step inside
 * the store, so two requests racing for the last credits cannot both win.
 */
export async function reserve(userId: string, credits: number, jobId: string, store: CreditStore = dbCreditStore): Promise<number> {
  if (!Number.isInteger(credits) || credits < 0) throw new Error(`reserve() needs a whole, non-negative number of credits, got ${credits}`);
  if (credits === 0) return store.balance(userId); // free actions write no row
  const result = await store.tryReserve({ userId, credits, jobId });
  if (!result.reserved) throw new InsufficientCreditsError(result.balance, credits);
  return result.balance;
}

/**
 * Give back everything reserved for `jobId`. Idempotent: the second call
 * returns 0 and writes nothing, so a retried failure handler cannot mint
 * credits. Returns the credits refunded.
 */
export async function refund(jobId: string, store: CreditStore = dbCreditStore): Promise<number> {
  return store.refundJob({ jobId });
}

/**
 * Add credits. With a `note`, idempotent: the same user, reason and note grant
 * once. Returns true if a row was written.
 */
export async function grant(
  userId: string,
  credits: number,
  reason: LedgerReason,
  note?: string | null,
  store: CreditStore = dbCreditStore,
): Promise<boolean> {
  if (!Number.isInteger(credits) || credits <= 0) throw new Error(`grant() needs a whole, positive number of credits, got ${credits}`);
  return store.grant({ userId, credits, reason, note });
}

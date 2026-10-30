/* The narrow database surface billing needs. Everything below `src/billing`
   talks to these interfaces, never to Drizzle directly, so the unit tests can
   run credits and entitlements against an in-memory fake with no Postgres and
   no network.

   `store.db.ts` is the Postgres implementation, `store.memory.ts` the fake. */

export type LedgerReason = "free_grant" | "job_reserve" | "job_refund" | "adjustment";

/** One row of `credit_ledger`. The ledger is append-only; the balance is its sum. */
export interface LedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: LedgerReason;
  jobId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface ReserveResult {
  /** False when the balance was too low; nothing was written. */
  reserved: boolean;
  /** The balance after the attempt: after the reservation if it succeeded, the unchanged balance if it did not. */
  balance: number;
}

export interface CreditStore {
  balance(userId: string): Promise<number>;
  /** Every ledger row for the user, oldest first. */
  ledger(userId: string): Promise<LedgerRow[]>;
  /**
   * Append a `job_reserve` row for `credits` if and only if the balance covers
   * it. Must be atomic against a concurrent call for the same user: two
   * reservations may never take the balance below zero.
   */
  tryReserve(input: { userId: string; credits: number; jobId: string; note?: string }): Promise<ReserveResult>;
  /**
   * Append a `job_refund` row returning everything reserved for `jobId`, unless
   * one already exists. Returns the credits refunded, or 0 if already refunded
   * or nothing was ever reserved.
   */
  refundJob(input: { jobId: string; note?: string }): Promise<number>;
  /**
   * Append a positive row. When `note` is set, a second call with the same
   * user, reason and note writes nothing: that is what makes the free grant
   * land once however many requests race for it. Returns true if a row was
   * written.
   */
  grant(input: { userId: string; credits: number; reason: LedgerReason; note?: string | null }): Promise<boolean>;
}

/** The billing columns of `users`. */
export interface UserBillingRow {
  id: string;
  email: string;
}

export interface UserStore {
  find(userId: string): Promise<UserBillingRow | null>;
  /** Insert the row if this Clerk user has none yet, then return it. */
  ensure(input: { id: string; email: string }): Promise<UserBillingRow>;
}

export interface BillingStore {
  credits: CreditStore;
  users: UserStore;
}

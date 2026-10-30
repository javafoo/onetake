/* An in-memory BillingStore for tests. It keeps the same guarantees the
   Postgres store gets from advisory locks and unique indexes: every mutating
   call runs through a per-key queue, so a test can fire two reservations
   without awaiting the first and still see exactly one of them win. */

import type { BillingStore, CreditStore, LedgerRow, ReserveResult, UserBillingRow, UserStore } from "./store";

/** Serialises calls that share a key, the way `pg_advisory_xact_lock` does. */
function keyedQueue() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve();
    const next = previous.then(async () => {
      // A microtask turn between taking the lock and running the body, so a
      // racing caller really is queued rather than accidentally interleaved.
      await Promise.resolve();
      return fn();
    });
    tails.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  };
}

export interface MemoryBillingStore extends BillingStore {
  /** Every ledger row ever written, in order, for assertions. */
  rows: LedgerRow[];
  /** Seed a user. */
  putUser(user: Partial<UserBillingRow> & { id: string }): UserBillingRow;
  /** Seed credits directly, bypassing the grant guards. */
  seedLedger(row: Partial<LedgerRow> & { userId: string; delta: number; reason: LedgerRow["reason"] }): LedgerRow;
}

export function memoryStore(): MemoryBillingStore {
  const rows: LedgerRow[] = [];
  const users = new Map<string, UserBillingRow>();
  const withLock = keyedQueue();
  let sequence = 0;

  const nextId = () => `row_${String(++sequence).padStart(4, "0")}`;
  const balanceOf = (userId: string) => rows.filter((r) => r.userId === userId).reduce((sum, r) => sum + r.delta, 0);

  function append(row: Partial<LedgerRow> & { userId: string; delta: number; reason: LedgerRow["reason"] }): LedgerRow {
    const full: LedgerRow = {
      id: row.id ?? nextId(),
      userId: row.userId,
      delta: row.delta,
      reason: row.reason,
      jobId: row.jobId ?? null,
      note: row.note ?? null,
      createdAt: row.createdAt ?? new Date(Date.UTC(2026, 0, 1) + sequence * 1000),
    };
    rows.push(full);
    return full;
  }

  const credits: CreditStore = {
    async balance(userId) {
      return balanceOf(userId);
    },

    async ledger(userId) {
      return rows
        .filter((r) => r.userId === userId)
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
    },

    async tryReserve({ userId, credits: amount, jobId, note }): Promise<ReserveResult> {
      return withLock(`credits:${userId}`, () => {
        const balance = balanceOf(userId);
        if (balance < amount) return { reserved: false, balance };
        append({ userId, delta: -amount, reason: "job_reserve", jobId, note: note ?? null });
        return { reserved: true, balance: balance - amount };
      });
    },

    async refundJob({ jobId, note }) {
      return withLock(`job:${jobId}`, () => {
        if (rows.some((r) => r.jobId === jobId && r.reason === "job_refund")) return 0;
        const reserved = rows.filter((r) => r.jobId === jobId && r.reason === "job_reserve");
        const amount = -reserved.reduce((sum, r) => sum + r.delta, 0);
        if (amount <= 0) return 0;
        const owner = reserved[0].userId;
        append({ userId: owner, delta: amount, reason: "job_refund", jobId, note: note ?? null });
        return amount;
      });
    },

    async grant({ userId, credits: amount, reason, note }) {
      return withLock(`credits:${userId}`, () => {
        const dedupeNote = note ?? null;
        const duplicate = dedupeNote !== null && rows.some((r) => r.userId === userId && r.reason === reason && r.note === dedupeNote);
        if (duplicate) return false;
        append({ userId, delta: amount, reason, note: dedupeNote });
        return true;
      });
    },
  };

  function blankUser(id: string, email: string): UserBillingRow {
    return { id, email };
  }

  const userStore: UserStore = {
    async find(userId) {
      return users.get(userId) ?? null;
    },
    async ensure({ id, email }) {
      const existing = users.get(id);
      if (existing) return existing;
      const created = blankUser(id, email);
      users.set(id, created);
      return created;
    },
  };

  return {
    credits,
    users: userStore,
    rows,
    putUser(user) {
      const merged = { ...blankUser(user.id, user.email ?? `${user.id}@example.test`), ...user };
      users.set(user.id, merged);
      return merged;
    },
    seedLedger(row) {
      return append(row);
    },
  };
}

import { globalDailyBudgetUsd } from "@/jobs/budget";
import { dbJobStore } from "@/jobs/store.db";

/* Deprecated, and down to three functions with one caller each.
 *
 * This used to own a `generation_ledger` table and reserve every paid call
 * against it from inside the provider clients. That is gone: paid work is a
 * job now, `provider_costs` is the record of what we spend, and
 * `src/jobs/budget.ts` owns the cap. Nothing writes or reads
 * `generation_ledger` any more; the table is left in the database only so its
 * history is not thrown away by a migration nobody asked for.
 *
 * What survives is the one reading the overview page does. It stays here,
 * against the new table, so that page keeps working untouched while the design
 * branch has it open. Anything new calls `src/jobs/budget.ts` directly.
 */

/** No-op: there is no table of ours to create any more. */
export async function ensureLedger(): Promise<void> {}

/** The cap that is actually enforced, so the page shows the number that stops work. */
export function dailyCapUsd(): number {
  return globalDailyBudgetUsd();
}

/** Everything spent today, across all users, from `provider_costs`. */
export function spentTodayUsd(): Promise<number> {
  return dbJobStore.spentTodayUsd(new Date());
}

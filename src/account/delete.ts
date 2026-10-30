import { eq } from "drizzle-orm";

import { db, schema } from "@/db/client";
import { getStorage } from "@/lib/get-storage";
import { userPrefix } from "@/lib/storage";

/* Erasing an account. The in-app button and the Clerk webhook both call this.
 *
 * Order matters. The stored objects go first, because the rows are the only
 * record of which objects exist: delete the rows first and a crash in the
 * middle leaves bytes nobody can find, and therefore bytes nobody will ever
 * delete. Deleting objects first can leave a row pointing at nothing, which is
 * a broken image for a few milliseconds on an account that is about to stop
 * existing.
 *
 * `users` cascades to avatars, media, drafts, jobs, the ledger, onboarding,
 * brand profiles, rate limits and safety refusals, so one delete is the whole
 * tenant. `provider_costs` is deliberately set-null rather than cascade: what
 * we spent is our accounting record, not the customer's data, and it carries
 * nothing about them once the user id is gone.
 *
 * Idempotent throughout, because a webhook is delivered more than once.
 */

export interface DeletionResult {
  /** True when there was a row to delete. False on a repeat delivery. */
  existed: boolean;
  /** How many media rows were on the account. */
  media: number;
}

/** What the row says before anything is touched. Null when there is no row. */
export interface AccountSnapshot {
  media: number;
}

/** The outside world, injected so the order of steps can be proved with fakes. */
export interface DeletionDeps {
  snapshot(userId: string): Promise<AccountSnapshot | null>;
  deleteObjects(userId: string): Promise<void>;
  /** Delete the `users` row. True when there was one. */
  deleteRows(userId: string): Promise<boolean>;
}

/** The steps in their order, over injected dependencies. */
export async function eraseAccount(userId: string, deps: DeletionDeps): Promise<DeletionResult> {
  if (!userId) throw new Error("deleteAccountData needs a user id");

  const account = await deps.snapshot(userId);
  if (!account) return { existed: false, media: 0 };

  /* Everything under users/<id>/. One call per storage implementation, and
     both of them page until there is nothing left. */
  await deps.deleteObjects(userId);
  const existed = await deps.deleteRows(userId);

  return { existed, media: account.media };
}

function liveDeps(): DeletionDeps {
  return {
    snapshot: async (userId) => {
      const [row] = await db().select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      if (!row) return null;
      const media = await db()
        .select({ id: schema.media.id })
        .from(schema.media)
        .where(eq(schema.media.userId, userId));
      return { media: media.length };
    },
    deleteObjects: (userId) => getStorage().deletePrefix(userPrefix(userId)),
    deleteRows: async (userId) => {
      const deleted = await db()
        .delete(schema.users)
        .where(eq(schema.users.id, userId))
        .returning({ id: schema.users.id });
      return deleted.length > 0;
    },
  };
}

export async function deleteAccountData(userId: string): Promise<DeletionResult> {
  return eraseAccount(userId, liveDeps());
}

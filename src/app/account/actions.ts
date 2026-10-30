"use server";

import { clerkClient } from "@clerk/nextjs/server";

import { CONFIRMATION } from "@/account/confirm";
import { deleteAccountData } from "@/account/delete";
import { guardedAction } from "@/lib/action-guard";
import { InvalidRequestError } from "@/lib/errors";

/* "Delete my account and data", done in the order that cannot strand anything.
 *
 * 1. `deleteAccountData` deletes the stored objects, then the rows.
 * 2. Delete the Clerk user, which ends every session they have anywhere.
 *
 * Step 2 also fires the `user.deleted` webhook, which runs step 1 again. That
 * is on purpose: whichever of the two paths a deletion arrives by, the other
 * one is a no-op, and a deletion that dies between steps is finished by the
 * webhook rather than left half done.
 */

export type AccountState = { ok: boolean; message: string; done?: boolean } | null;

export async function deleteAccountAction(_: AccountState, form: FormData): Promise<AccountState> {
  return guardedAction<{ message: string }, AccountState>(form, {
    where: "deleteAccountAction",
    run: async (user) => {
      const typed = String(form.get("confirm") ?? "").trim().toLowerCase();
      if (typed !== CONFIRMATION) {
        throw new InvalidRequestError(`Type “${CONFIRMATION}” exactly to confirm, then press the button again.`);
      }

      await deleteAccountData(user.id);

      /* Last, because it ends the session this request is running under. A
         failure here leaves a Clerk account with no data behind it, which the
         next sign-in simply treats as a new account. */
      try {
        await (await clerkClient()).users.deleteUser(user.id);
      } catch (error) {
        console.error(
          `account deletion: data erased for ${user.id} but the Clerk user remains —`,
          error instanceof Error ? error.message : error,
        );
      }

      return { message: "Your account and everything in it have been deleted." };
    },
    done: (outcome) => ({ ok: true, message: outcome.message, done: true }),
    failed: (message) => ({ ok: false, message }),
  });
}

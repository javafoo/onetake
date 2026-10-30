"use client";

import { useClerk } from "@clerk/nextjs";
import { useActionState, useEffect, useState } from "react";

import { buttonClass, Field, Input, ResultMessage } from "@/components/ui";

import { CONFIRMATION } from "@/account/confirm";
import { deleteAccountAction, type AccountState } from "@/app/account/actions";

/* The last thing a person does here. Three deliberate frictions, and no more:
 * the sentence has to be typed, the button says what it does rather than "OK",
 * and nothing happens on a single stray click.
 *
 * On success the session is ended from the browser. The server has already
 * deleted the Clerk user, which invalidates every session everywhere; this
 * clears the local one straight away so the next paint is the signed-out
 * screen rather than a page that half-renders against an account that no
 * longer exists.
 */
export function DeleteAccount() {
  const [state, formAction, pending] = useActionState<AccountState, FormData>(
    (previous, form) => {
      form.set("requestId", crypto.randomUUID());
      return deleteAccountAction(previous, form);
    },
    null,
  );
  const [typed, setTyped] = useState("");
  const { signOut } = useClerk();

  useEffect(() => {
    if (!state?.done) return;
    /* The Clerk user no longer exists, so signOut has nothing to revoke and may
       never resolve or navigate. Whatever it does, the browser leaves this page. */
    // A full navigation on purpose: the client router would keep the dead session's state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    const leave = () => window.location.assign("/sign-in?deleted=1");
    // The confirmation sentence stays readable for a few seconds first.
    const timer = setTimeout(() => {
      signOut({ redirectUrl: "/sign-in?deleted=1" }).then(leave, leave);
    }, 3000);
    // Whatever signOut does with a session whose user is gone, the browser leaves.
    const fallback = setTimeout(leave, 8000);
    return () => {
      clearTimeout(timer);
      clearTimeout(fallback);
    };
  }, [state?.done, signOut]);

  const armed = typed.trim().toLowerCase() === CONFIRMATION;

  return (
    <form action={formAction} className="space-y-4" aria-busy={pending}>
      <Field
        label={`Type “${CONFIRMATION}” to confirm`}
        hint="This is not reversible, and there is no copy of any of it afterwards."
      >
        <Input
          name="confirm"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-label={`Type ${CONFIRMATION} to confirm`}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!armed || pending} className={buttonClass("danger")}>
          {pending ? "Deleting…" : "Delete my account and data"}
        </button>
        {!armed && !state && <p className="text-xs text-muted">The button turns on once the words match.</p>}
      </div>

      {state && <ResultMessage ok={state.ok}>{state.message}</ResultMessage>}
    </form>
  );
}

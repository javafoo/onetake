import type { ReactNode } from "react";

import { CheckIcon } from "./icons";

/* The result of an action, shown next to the button that caused it rather than
   floating in a corner: on a phone a toast in the top-right is easy to miss and
   impossible to re-read. Success is announced politely, failure assertively. */

export function ResultMessage({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <p
      role="status"
      aria-live={ok ? "polite" : "assertive"}
      className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
        ok ? "border-good/20 bg-good-soft text-good" : "border-danger/25 bg-danger-soft text-danger"
      }`}
    >
      {ok ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0" />
      ) : (
        <span aria-hidden="true" className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-current text-[0.625rem] font-bold">
          !
        </span>
      )}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/** The quiet "this is running" line that sits under a pending button. */
export function PendingNote({ children }: { children: ReactNode }) {
  return (
    <p role="status" className="text-sm text-muted">
      {children}
    </p>
  );
}

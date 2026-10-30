"use client";

import { useActionState, type ReactNode } from "react";

import type { ActionState } from "@/app/actions";
import { JobStatus } from "@/components/job-status";
import { buttonClass, creditWord, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { ResultMessage } from "@/components/ui/message";

type Props = {
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  children?: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Set on anything that spends credits: it prints the price inside the button
      and switches it to the brass "this costs money" skin. */
  cost?: number;
  /** One quiet line beside the button: what happens next and how long it takes. */
  hint?: ReactNode;
  /** Blocks submission while the form is not ready. The `hint` has to say why. */
  disabled?: boolean;
  className?: string;
  /** Layout of the row holding the button and the result message. */
  actionsClassName?: string;
  /** Rendered beside the submit button, for a Cancel that leaves the form. */
  secondary?: ReactNode;
  /** Called once the action has answered, for a form that closes when it succeeds. */
  onResult?: (state: NonNullable<ActionState>) => void;
};

/** A form bound to a server action, with a pending label and the action's result message. */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  variant,
  size = "md",
  cost,
  hint,
  disabled = false,
  className,
  actionsClassName = "flex flex-wrap items-center gap-x-3 gap-y-2",
  secondary,
  onResult,
}: Props) {
  /* One id per submission, attached before the request leaves the browser. If
     that request is delivered twice (a retry, a proxy replay) both copies carry
     the same id and the server runs the work, and any charge, once. */
  const [state, formAction, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    form.set("requestId", crypto.randomUUID());
    const next = await action(previous, form);
    if (next) onResult?.(next);
    return next;
  }, null);

  const skin: ButtonVariant = variant ?? (cost === undefined ? "primary" : "spend");

  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(event) => (pending || disabled) && event.preventDefault()}
      aria-busy={pending}
    >
      {children}
      <div className={actionsClassName}>
        {/* `disabled` is a wait, not a refusal: the shared skin already dims a
            disabled button, and the hint beside it says what is still missing. */}
        <button type="submit" disabled={pending || disabled} className={buttonClass(skin, size)}>
          {pending ? (pendingLabel ?? "Working…") : submitLabel}
          {cost !== undefined && !pending && (
            <span className="rounded-full border border-spend-line bg-surface/70 px-2 py-0.5 text-2xs font-semibold">
              {creditWord(cost)}
            </span>
          )}
        </button>
        {secondary}
        {hint && !state && <p className="text-xs text-muted">{hint}</p>}
        {state && !state.jobId && <ResultMessage ok={state.ok}>{state.message}</ResultMessage>}
      </div>
      {/* Paid and slow actions return a job: its progress, result or refund shows here, and the page refreshes when it finishes. */}
      {state?.jobId && <JobStatus key={state.jobId} jobId={state.jobId} className="mt-3" />}
    </form>
  );
}

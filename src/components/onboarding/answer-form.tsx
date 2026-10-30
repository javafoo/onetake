"use client";

import { useActionState, useState } from "react";

import type { SetupState } from "@/app/onboarding/actions";
import { buttonClass } from "@/components/ui/button";
import { Note } from "@/components/ui/card";
import { FIELD } from "@/components/ui/field";
import { ResultMessage } from "@/components/ui/message";

/* One question, two or three sentences to tap, and a box.

   Three things make this more than a textarea. Tapping a suggestion records
   that she tapped it, because an answer she wrote and an answer she accepted
   are not the same evidence and the compiler treats them differently. Editing
   after tapping downgrades it to "edited", which is the truth. And a suggestion
   carrying a number she has never typed is called out the moment she taps it,
   because that number would otherwise end up in a caption as a fact. */

export type Option = {
  /** What she reads on the card. */
  preview: string;
  /** Which boxes it fills. The offer suggestion fills the keyword too. */
  fills: Record<string, string>;
  /** Numbers in this suggestion that she has never typed anywhere. */
  untraced: string[];
};

export type FieldSpec = {
  id: string;
  label?: string;
  hint?: string;
  placeholder?: string;
  /** Zero draws a single-line box: the comment keyword is one word. */
  rows: number;
  value: string;
  options: Option[];
};

type Source = "typed" | "picked" | "edited";

export function AnswerForm({
  step,
  fields,
  action,
  submitLabel = "Continue",
}: {
  step: string;
  fields: FieldSpec[];
  action: (state: SetupState, form: FormData) => Promise<SetupState>;
  submitLabel?: string;
}) {
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((field) => [field.id, field.value])),
  );
  const [source, setSource] = useState<Source>(() => (fields.some((field) => field.value) ? "typed" : "typed"));
  const [flagged, setFlagged] = useState<string[]>([]);

  const [state, formAction, pending] = useActionState(async (previous: SetupState, form: FormData) => {
    form.set("requestId", crypto.randomUUID());
    return action(previous, form);
  }, null);

  function pick(option: Option) {
    setValues((current) => ({ ...current, ...option.fills }));
    setSource("picked");
    setFlagged(option.untraced);
  }

  function edit(id: string, next: string) {
    const updated = { ...values, [id]: next };
    setValues(updated);
    /* A warning about 285,000 disappears the moment she deletes it, rather than
       sitting there telling her off for something she has already fixed. */
    const all = Object.values(updated).join(" ");
    setFlagged((numbers) => numbers.filter((number) => all.includes(number)));
    setSource((current) => (current === "picked" || current === "edited" ? "edited" : "typed"));
  }

  return (
    <form action={formAction} aria-busy={pending} onSubmit={(event) => pending && event.preventDefault()}>
      <input type="hidden" name="step" value={step} />
      <input type="hidden" name="source" value={source} />

      <div className="space-y-7">
        {fields.map((field) => (
          <div key={field.id}>
            {field.label && (
              <label htmlFor={`f-${field.id}`} className="block text-sm font-medium text-ink">
                {field.label}
              </label>
            )}
            {field.hint && <p className="mt-0.5 text-xs text-muted">{field.hint}</p>}

            {field.options.length > 0 && (
              <ul className="mt-3 space-y-2">
                {field.options.map((option, index) => (
                  <li key={index}>
                    <button
                      type="button"
                      onClick={() => pick(option)}
                      className="w-full rounded-xl border border-line-strong bg-surface px-4 py-3 text-left text-sm text-ink-soft transition-colors hover:border-ink hover:bg-sunken/40"
                    >
                      {option.preview}
                      {option.untraced.length > 0 && (
                        <span className="mt-1.5 block text-2xs font-semibold tracking-wide text-warn uppercase">
                          contains a number you have not typed
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {field.rows === 0 ? (
              <input
                id={`f-${field.id}`}
                name={field.id}
                autoComplete="off"
                autoCapitalize="characters"
                placeholder={field.placeholder}
                value={values[field.id] ?? ""}
                onChange={(event) => edit(field.id, event.target.value)}
                className={`${FIELD} mt-3 min-h-11 uppercase`}
              />
            ) : (
              <textarea
                id={`f-${field.id}`}
                name={field.id}
                rows={field.rows}
                placeholder={field.placeholder}
                value={values[field.id] ?? ""}
                onChange={(event) => edit(field.id, event.target.value)}
                className={`${FIELD} mt-3 resize-y leading-relaxed`}
              />
            )}
          </div>
        ))}
      </div>

      {flagged.length > 0 && (
        <Note tone="warn" className="mt-4">
          That suggestion mentions {flagged.join(", ")}. You have not typed {flagged.length === 1 ? "that" : "those"}{" "}
          anywhere, so we cannot stand behind {flagged.length === 1 ? "it" : "them"}. Change{" "}
          {flagged.length === 1 ? "it to a number" : "them to numbers"} you could show a screenshot of, or take{" "}
          {flagged.length === 1 ? "it" : "them"} out.
        </Note>
      )}

      {state?.pushback && (
        <div className="mt-5 rounded-xl border border-warn/25 bg-warn-soft p-4">
          <p className="eyebrow text-warn">One more go</p>
          <p className="mt-1.5 text-sm text-ink">{state.pushback}</p>
          {state.sharper && (
            <button
              type="button"
              onClick={() =>
                pick({ preview: state.sharper!, fills: { [fields[0].id]: state.sharper! }, untraced: [] })
              }
              className="mt-3 w-full rounded-lg border border-line-strong bg-surface px-3 py-2.5 text-left text-sm text-ink-soft hover:border-ink"
            >
              <span className="eyebrow block text-muted">Or use your answer, tightened</span>
              <span className="mt-1 block">{state.sharper}</span>
            </button>
          )}
        </div>
      )}

      {state && !state.ok && !state.pushback && (
        <div className="mt-4">
          <ResultMessage ok={false}>{state.message}</ResultMessage>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <button type="submit" disabled={pending} className={buttonClass("primary", "lg", "w-full")}>
          {pending ? "Reading it…" : submitLabel}
        </button>
        {state?.pushback && (
          <button
            type="submit"
            name="keep"
            value="1"
            disabled={pending}
            className={buttonClass("quiet", "lg", "w-full")}
          >
            Keep what I wrote
          </button>
        )}
      </div>
    </form>
  );
}

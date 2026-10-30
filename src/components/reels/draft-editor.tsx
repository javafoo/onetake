"use client";

import { useState, type ReactNode } from "react";

import type { ActionState } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Button, Field, Textarea } from "@/components/ui";
import { countWords, readingSeconds } from "@/reel/timing";

/* The hook, and the way to change it.
 *
 * Closed, a draft card reads as it always did. Open, the three pieces a person
 * actually wants to fix — the hook on screen, the caption under it, the line
 * that asks for the comment — are plain fields with Save and Cancel. The rules
 * are enforced on the server (`checkDraftEdit`); what is here is the counting
 * that tells her she is about to break one before she presses anything. */

export type EditableDraft = {
  id: string;
  hook: string;
  caption: string;
  cta: string;
};

export function DraftEditor({
  draft,
  action,
  maxHookWords,
  maxCaptionChars,
  keywords,
  children,
}: {
  draft: EditableDraft;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  maxHookWords: number;
  maxCaptionChars: number;
  /** Her comment keywords, the default first; empty if she has not set one. */
  keywords: string[];
  /** The read-only caption panel, hidden while the fields are open. */
  children: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [hook, setHook] = useState(draft.hook);
  const [caption, setCaption] = useState(draft.caption);
  const [cta, setCta] = useState(draft.cta);

  /* Reseeded from the row every time it opens, so an edit saved a moment ago —
     or on another tab — is what the fields start from, not what this component
     happened to be holding. */
  function open() {
    setHook(draft.hook);
    setCaption(draft.caption);
    setCta(draft.cta);
    setEditing(true);
  }

  const words = countWords(hook);
  const overBy = words - maxHookWords;
  // With more than one offer, a post asks for any one of her keywords.
  const missingKeyword = keywords.length > 0 && !keywords.some((word) => cta.toLowerCase().includes(word.toLowerCase()));
  const named = keywords.length > 1 ? `one of ${keywords.join(", ")}` : keywords[0];

  if (!editing) {
    return (
      <>
        <p className="mt-3 font-display text-xl leading-snug text-balance text-ink sm:text-2xl">{draft.hook}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <span>
            {Math.round(readingSeconds(draft.hook))}s reel
          </span>
          <Button variant="ghost" size="sm" onClick={open} className="-my-1 px-2">
            Edit
          </Button>
        </p>
        {children}
      </>
    );
  }

  return (
    <ActionForm
      action={action}
      submitLabel="Save"
      pendingLabel="Saving…"
      variant="primary"
      size="sm"
      className="mt-3 space-y-4"
      onResult={(state) => state.ok && setEditing(false)}
      secondary={
        <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      }
    >
      <input type="hidden" name="id" value={draft.id} />

      <Field
        label="Hook"
        aside={
          <span className={overBy > 0 ? "font-semibold text-accent" : undefined}>
            {overBy > 0 ? `${overBy} word${overBy === 1 ? "" : "s"} over` : `${words}/${maxHookWords} words`}
          </span>
        }
      >
        {/* Four rows holds a whole hook at phone width. It is the one field
            here that has to be read as a whole to be judged. */}
        <Textarea name="hook" rows={4} value={hook} onChange={(event) => setHook(event.target.value)} />
      </Field>
      {/* The same line the card shows, moving as she types: the reel is exactly
          as long as the hook takes to read. */}
      <p className="text-xs text-muted">
        {words === 0 ? "An empty hook has no reel." : `${Math.round(readingSeconds(hook))}s reel at reading speed.`}
      </p>

      <Field
        label="Caption"
        aside={
          <span className={caption.length > maxCaptionChars ? "font-semibold text-accent" : undefined}>
            {caption.length.toLocaleString("en-US")}/{maxCaptionChars.toLocaleString("en-US")}
          </span>
        }
      >
        <Textarea name="caption" rows={6} value={caption} onChange={(event) => setCaption(event.target.value)} />
      </Field>

      {/* A textarea rather than a one-line input: a CTA is a sentence, and on a
          phone an input hides the end of it behind a sideways scroll. */}
      <Field
        label="Call to action"
        hint={named ? `Has to ask for ${named} by name.` : "Set a comment keyword on the Brand page."}
        aside={missingKeyword ? <span className="font-semibold text-accent">Missing {keywords.length > 1 ? "a keyword" : named}</span> : undefined}
      >
        <Textarea name="cta" rows={2} value={cta} onChange={(event) => setCta(event.target.value)} />
      </Field>
    </ActionForm>
  );
}

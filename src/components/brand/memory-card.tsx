"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { addFactAction, deleteFactAction, editFactAction, type MemoryState } from "@/app/brand/memory-actions";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";
import { ResultMessage } from "@/components/ui/message";

/* The facts the writers may use beyond the form above: what the agent wrote
   down in chat, and what she typed here. It sits outside the big form because
   that form's save rewrites the whole profile; each fact is saved on its own.
   A delete is confirmed in place, like a hook's. */

export type FactRow = { id: string; text: string; source: "agent" | "her" };

export function MemoryCard({ facts, maxChars }: { facts: FactRow[]; maxChars: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<MemoryState | null>(null);

  const run = (work: () => Promise<MemoryState>, after?: () => void) =>
    start(async () => {
      const result = await work();
      setNote(result);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <Card className="p-5 sm:p-7" id="memory">
      <h2 className="font-display text-xl text-ink">What the agent remembers</h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        Facts about her that the writers may use, the same as her story and proof points. The agent adds one when you tell it something new in Create. You can add, change or delete them here. Free.
      </p>

      {facts.length === 0 ? (
        <p className="mt-5 text-sm text-ink-soft">Nothing yet.</p>
      ) : (
        <ul className="mt-5 divide-y divide-line rounded-xl border border-line">
          {facts.map((fact) => (
            <FactItem
              key={fact.id}
              fact={fact}
              maxChars={maxChars}
              busy={pending}
              onSave={(text, done) => run(() => editFactAction({ id: fact.id, text }), done)}
              onDelete={() => run(() => deleteFactAction({ id: fact.id }))}
            />
          ))}
        </ul>
      )}

      <form
        className="mt-5 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          run(() => addFactAction({ text: draft }), () => setDraft(""));
        }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">A new fact</span>
          <Input value={draft} maxLength={maxChars} onChange={(event) => setDraft(event.target.value)} placeholder="She has two kids and works nights." />
        </label>
        <Button type="submit" variant="quiet" disabled={pending || !draft.trim()}>
          {pending ? "Saving…" : "Add"}
        </Button>
      </form>
      <p className="mt-1.5 text-xs text-muted">One fact per line. Only what is true. Adding one is free.</p>

      {note && (
        <div className="mt-3">
          <ResultMessage ok={note.ok}>{note.message}</ResultMessage>
        </div>
      )}
    </Card>
  );
}

function FactItem({
  fact,
  maxChars,
  busy,
  onSave,
  onDelete,
}: {
  fact: FactRow;
  maxChars: number;
  busy: boolean;
  onSave: (text: string, done: () => void) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [text, setText] = useState(fact.text);

  if (editing) {
    return (
      <li className="space-y-2 px-4 py-3">
        <label className="block">
          <span className="text-xs font-medium text-muted">Change the fact</span>
          <Textarea rows={2} maxLength={maxChars} value={text} onChange={(event) => setText(event.target.value)} className="mt-1" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !text.trim() || text.trim() === fact.text} onClick={() => onSave(text, () => setEditing(false))}>
            {busy ? "Saving…" : "Save"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setText(fact.text);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="text-[0.95rem] leading-snug text-ink">{fact.text}</p>
        <span className="mt-1 inline-block">
          <Badge>{fact.source === "agent" ? "Added by the agent" : "Added by you"}</Badge>
        </span>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {confirm ? (
          <>
            <span className="text-sm text-ink-soft">Delete this fact?</span>
            <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
              {busy ? "Deleting…" : "Delete"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
          </>
        ) : (
          <>
            <Button variant="quiet" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" size="sm" className="text-muted" onClick={() => setConfirm(true)}>
              Delete
            </Button>
          </>
        )}
      </div>
    </li>
  );
}

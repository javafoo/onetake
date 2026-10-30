"use client";

import { useState } from "react";

import { addHookAction, writeHooksAction } from "@/app/hooks/actions";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Select, Textarea } from "@/components/ui";
import { MAX_SAVED_HOOK_CHARS } from "@/data/hook-rules";
import { countWords } from "@/reel/timing";

/* The two ways a hook arrives: the writer, in her voice, or her own words.
   Both are free and both say so beside the button. */
export function HookTools({ maxWords }: { maxWords: number }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const words = countWords(draft);

  return (
    <Card className="mb-6 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <ActionForm
          action={writeHooksAction}
          submitLabel="Write hooks"
          pendingLabel="Writing…"
          hint="Free."
          className="flex flex-wrap items-end gap-3"
          actionsClassName="flex flex-wrap items-center gap-x-3 gap-y-2"
        >
          <label className="block">
            <span className="block text-xs font-medium text-muted">How many</span>
            <Select name="count" defaultValue="5" className="mt-1 w-20">
              {[3, 5, 10].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </Select>
          </label>
          {/* Off writes hooks on any subject, without her niche, offer or story. */}
          <input type="hidden" name="brandAsked" value="1" />
          <label className="flex min-h-9 items-center gap-2 text-sm text-ink-soft" title="Off: writes without your niche, offer and story.">
            <input type="checkbox" name="useBrand" defaultChecked className="size-4 accent-accent" />
            Use my brand
          </label>
        </ActionForm>
        {!adding && (
          <Button variant="quiet" onClick={() => setAdding(true)}>
            Add a hook
          </Button>
        )}
      </div>

      {adding && (
        <ActionForm
          action={addHookAction}
          submitLabel="Save hook"
          pendingLabel="Saving…"
          hint="Free."
          className="mt-4 max-w-2xl space-y-3 border-t border-line pt-4"
          onResult={(state) => {
            if (state.ok) {
              setDraft("");
              setAdding(false);
            }
          }}
          secondary={
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          }
        >
          <label className="block">
            <span className="flex items-baseline justify-between gap-2">
              <span className="text-xs font-medium text-muted">Your hook, as it should read on screen</span>
              <span className={`text-xs ${words > maxWords ? "font-semibold text-accent" : "text-muted"}`}>
                {words}/{maxWords} words
              </span>
            </span>
            <Textarea
              name="hook"
              rows={3}
              required
              maxLength={MAX_SAVED_HOOK_CHARS}
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="I stopped filming myself six months ago"
              className="mt-1"
            />
          </label>
        </ActionForm>
      )}
    </Card>
  );
}

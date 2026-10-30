"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { archiveHooksAction, deleteHooksAction, editHookAction, markHookCopiedAction, type HookBatchState } from "@/app/hooks/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Textarea } from "@/components/ui";
import { ChevronIcon } from "@/components/ui/icons";
import { ResultMessage } from "@/components/ui/message";
import { hookUseHref, MAX_SAVED_HOOK_CHARS, type HookFilter } from "@/data/hook-rules";
import { countWords } from "@/reel/timing";

/* The list. One compact row per hook: the words in full, small marks for what
   it became, and one Use button. Tapping a row opens it to edit, archive or
   delete; Select is for doing that to many. Nothing here asks the browser for
   a dialog: a delete is confirmed in place, where the finger already is. */

export type HookRow = { id: string; text: string; marks: string[]; archived: boolean };

export function HookList({ hooks, filter, maxWords }: { hooks: HookRow[]; filter: HookFilter; maxWords: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBatch, setConfirmBatch] = useState(false);
  const [note, setNote] = useState<HookBatchState | null>(null);

  const run = (work: () => Promise<HookBatchState>, after?: () => void) =>
    start(async () => {
      const result = await work();
      setNote(result);
      if (result.ok) {
        after?.();
        router.refresh();
      }
    });

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
    setConfirmBatch(false);
  };

  const ids = [...selected];
  // On the Archived view the batch brings hooks back; everywhere else it puts them away.
  const unarchive = filter === "archived";

  return (
    <div>
      <div className="mb-3 flex min-h-11 flex-wrap items-center gap-2">
        {selecting ? (
          <>
            <span className="mr-auto text-sm text-ink-soft">{ids.length ? `${ids.length} selected` : "Tap hooks to select them"}</span>
            {confirmBatch ? (
              <>
                <span className="text-sm text-ink-soft">Delete {ids.length === 1 ? "this hook" : `these ${ids.length}`}? This cannot be undone.</span>
                <Button variant="danger" size="sm" disabled={pending} onClick={() => run(() => deleteHooksAction({ ids }), stopSelecting)}>
                  {pending ? "Deleting…" : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmBatch(false)}>
                  Keep them
                </Button>
              </>
            ) : (
              <>
                <Button variant="quiet" size="sm" disabled={pending || ids.length === 0} onClick={() => run(() => archiveHooksAction({ ids, archived: !unarchive }), stopSelecting)}>
                  {unarchive ? "Unarchive" : "Archive"}
                </Button>
                <Button variant="quiet" size="sm" disabled={pending || ids.length === 0} onClick={() => setConfirmBatch(true)}>
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={stopSelecting}>
                  Done
                </Button>
              </>
            )}
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setSelecting(true);
              setOpen(null);
              setMenu(null);
              setNote(null);
            }}
          >
            Select
          </Button>
        )}
      </div>

      {note && (
        <div className="mb-3">
          <ResultMessage ok={note.ok}>{note.message}</ResultMessage>
        </div>
      )}

      <ul className="divide-y divide-line overflow-visible rounded-xl border border-line bg-surface">
        {hooks.map((hook) => (
          <HookItem
            key={hook.id}
            hook={hook}
            maxWords={maxWords}
            open={!selecting && open === hook.id}
            menuOpen={!selecting && menu === hook.id}
            selecting={selecting}
            selected={selected.has(hook.id)}
            busy={pending}
            onTap={() => {
              if (selecting) return toggle(hook.id);
              setMenu(null);
              setOpen((current) => (current === hook.id ? null : hook.id));
            }}
            onMenu={(show) => setMenu(show ? hook.id : null)}
            onCopied={() => run(() => markHookCopiedAction({ id: hook.id }))}
            onArchive={() => run(() => archiveHooksAction({ ids: [hook.id], archived: !hook.archived }), () => setOpen(null))}
            onDelete={() => run(() => deleteHooksAction({ ids: [hook.id] }), () => setOpen(null))}
          />
        ))}
      </ul>
    </div>
  );
}

function HookItem({
  hook,
  maxWords,
  open,
  menuOpen,
  selecting,
  selected,
  busy,
  onTap,
  onMenu,
  onCopied,
  onArchive,
  onDelete,
}: {
  hook: HookRow;
  maxWords: number;
  open: boolean;
  menuOpen: boolean;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onTap: () => void;
  onMenu: (show: boolean) => void;
  onCopied: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const [text, setText] = useState(hook.text);
  const [confirm, setConfirm] = useState(false);
  const words = countWords(text);

  const copy = async () => {
    onMenu(false);
    try {
      await navigator.clipboard.writeText(hook.text);
    } catch {
      // A browser that refuses the clipboard still gets the mark; the words are on screen to copy by hand.
    }
    onCopied();
  };

  return (
    <li className={`relative ${selected ? "bg-accent-soft/60" : ""} ${open ? "bg-sunken/40" : ""}`}>
      <div className="flex items-start gap-3 px-4 py-3">
        {selecting && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onTap}
            aria-label={`Select: ${hook.text}`}
            className="mt-1 size-5 shrink-0 accent-ink"
          />
        )}
        <button type="button" onClick={onTap} aria-expanded={selecting ? undefined : open} className="min-w-0 flex-1 text-left">
          {/* A hook written in groups keeps its groups, a small gap apart rather than a whole blank line. */}
          {hook.text.split(/\n\n+/).map((group, index) => (
            <span key={index} className={`block whitespace-pre-line text-[0.95rem] leading-snug text-ink ${index > 0 ? "mt-1.5" : ""}`}>
              {group}
            </span>
          ))}
          {(hook.marks.length > 0 || hook.archived) && (
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {hook.marks.map((mark) => (
                <Badge key={mark} tone="good">
                  {mark}
                </Badge>
              ))}
              {hook.archived && <Badge>Archived</Badge>}
            </span>
          )}
        </button>
        {!selecting && (
          <div className="relative shrink-0">
            <Button variant="quiet" size="sm" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => onMenu(!menuOpen)}>
              Use
              <ChevronIcon className={`size-3.5 transition-transform ${menuOpen ? "rotate-90" : "-rotate-90"}`} />
            </Button>
            {menuOpen && (
              <>
                {/* The whole screen behind the menu closes it, so a stray tap never lands on another row. */}
                <button type="button" aria-label="Close the menu" className="fixed inset-0 z-40 cursor-default" onClick={() => onMenu(false)} />
                <div role="menu" className="absolute top-full right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-line bg-surface shadow-card">
                  <Link role="menuitem" href={hookUseHref(hook, "video")} className="block px-4 py-3 hover:bg-sunken">
                    <span className="block text-sm font-medium text-ink">Make a reel</span>
                    <span className="block text-xs text-muted">Opens Create with these words. Add a clip with +. Free.</span>
                  </Link>
                  <Link role="menuitem" href={hookUseHref(hook, "slides")} className="block border-t border-line px-4 py-3 hover:bg-sunken">
                    <span className="block text-sm font-medium text-ink">Make a carousel</span>
                    <span className="block text-xs text-muted">Opens Create on Slides with these words. Free.</span>
                  </Link>
                  <button type="button" role="menuitem" onClick={copy} className="block w-full border-t border-line px-4 py-3 text-left hover:bg-sunken">
                    <span className="block text-sm font-medium text-ink">Copy text</span>
                    <span className="block text-xs text-muted">To post it yourself. Marks it Copied.</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-3 px-4 pb-4">
          <ActionForm
            action={editHookAction}
            submitLabel="Save"
            pendingLabel="Saving…"
            size="sm"
            disabled={text.trim() === hook.text || words === 0}
            className="space-y-2"
          >
            <input type="hidden" name="id" value={hook.id} />
            <label className="block">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted">Edit the words</span>
                <span className={`text-xs ${words > maxWords ? "font-semibold text-accent" : "text-muted"}`}>
                  {words}/{maxWords} words
                </span>
              </span>
              <Textarea name="text" rows={3} maxLength={MAX_SAVED_HOOK_CHARS} value={text} onChange={(event) => setText(event.target.value)} className="mt-1" />
            </label>
          </ActionForm>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            {confirm ? (
              <>
                <span className="text-sm text-ink-soft">Delete this hook? This cannot be undone.</span>
                <Button variant="danger" size="sm" disabled={busy} onClick={onDelete}>
                  {busy ? "Deleting…" : "Delete"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <>
                <Button variant="quiet" size="sm" disabled={busy} onClick={onArchive}>
                  {hook.archived ? "Unarchive" : "Archive"}
                </Button>
                <Button variant="ghost" size="sm" className="text-muted" onClick={() => setConfirm(true)}>
                  Delete
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

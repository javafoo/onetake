"use client";

import type { ThreadSummary } from "@/app/create/v2-actions";
import { Button } from "@/components/ui";

import { Modal } from "./modal";

/* The drawer of chats: the last ten for this avatar, newest first, and a new
   one. A chat keeps only its own messages; what the agent remembers about
   her lives on the Brand page and carries into every chat. */

const shortDate = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function ThreadList({
  threads,
  currentId,
  busy,
  onOpen,
  onNew,
  onClose,
}: {
  threads: ThreadSummary[];
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Your chats"
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 flex-1 text-xs text-muted">Chats are free. What it remembers is on the Brand page.</p>
          <Button size="sm" disabled={busy} onClick={onNew}>
            New chat
          </Button>
        </div>
      }
    >
      {threads.length === 0 ? (
        <p className="px-2 py-6 text-center text-sm text-muted">No chats yet. Your first message starts one.</p>
      ) : (
        <ul className="space-y-1">
          {threads.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onOpen(thread.id)}
                aria-current={thread.id === currentId ? "true" : undefined}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors disabled:opacity-60 ${thread.id === currentId ? "border-accent bg-accent-soft" : "border-transparent hover:bg-sunken/60"}`}
              >
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted">{shortDate(thread.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

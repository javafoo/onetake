"use client";

import { useEffect, useId, type ReactNode } from "react";

import { CloseIcon } from "@/components/ui/icons";

/* A sheet over the chat. On a phone it rises from the bottom and leaves the
   chat visible above it, so a quick choice (model, text style) does not feel
   like leaving the page; `full` gives the library picker the whole screen,
   which a list with a preview needs. A centred panel once there is room.
   Escape and the backdrop close it; nothing inside it submits the form
   behind it. */

export function Modal({
  title,
  onClose,
  children,
  footer,
  full = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
}) {
  const titleId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div className={`fixed inset-0 z-50 flex justify-center bg-ink/40 sm:items-center sm:p-4 ${full ? "items-stretch" : "items-end"}`} onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        className={`flex w-full flex-col bg-surface sm:h-auto sm:max-h-[85vh] sm:rounded-xl sm:border sm:border-line sm:shadow-card ${full ? "h-full sm:max-w-3xl" : "max-h-[85vh] rounded-t-2xl sm:max-w-lg"}`}
      >
        <div className={`flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:pt-3 ${full ? "pt-[calc(env(safe-area-inset-top)+0.75rem)]" : ""}`}>
          <h2 id={titleId} className="font-display text-lg text-ink">
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink">
            <CloseIcon className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3">{footer}</div>}
      </div>
    </div>
  );
}

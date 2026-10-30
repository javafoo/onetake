"use client";

import { useRef, useState } from "react";

import { buttonClass } from "@/components/ui/button";
import { FIELD } from "@/components/ui/field";

/* Copying, for the Connect Claude page, in a way that works on a phone.

   The clipboard API needs a secure page and a tap that just happened, and
   some phone browsers still refuse it; the old select-and-copy command works
   on most of those, through an off-screen text box. When both fail, the
   button says to press and hold: the visible text selects whole on a tap. */

async function copy(text: string, box: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: try the older way below.
  }
  if (!box) return false;
  box.focus();
  box.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  }
}

type Said = "idle" | "copied" | "select";

function useCopy() {
  const [said, setSaid] = useState<Said>("idle");
  const run = async (text: string, box: HTMLTextAreaElement | null) => {
    setSaid((await copy(text, box)) ? "copied" : "select");
    setTimeout(() => setSaid("idle"), 2000);
  };
  return { said, run };
}

function label(said: Said, idle: string): string {
  if (said === "copied") return "Copied";
  if (said === "select") return "Press and hold to copy";
  return idle;
}

/** The text in a box that wraps (a long link must not be cut off on a phone), with a Copy button beside it or below it. */
export function CopyField({ value, label: fieldLabel }: { value: string; label: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const { said, run } = useCopy();
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <p className={`${FIELD} min-w-0 font-mono break-all select-all`}>
        <span className="sr-only">{fieldLabel}: </span>
        {value}
      </p>
      {/* Off screen, not hidden: the older copy command needs a real text box to select. */}
      <textarea ref={box} readOnly value={value} aria-hidden="true" tabIndex={-1} className="pointer-events-none fixed -left-[9999px] h-px w-px opacity-0" />
      <button type="button" onClick={() => run(value, box.current)} className={buttonClass("primary", "md", "shrink-0")}>
        <span aria-live="polite">{label(said, "Copy link")}</span>
      </button>
    </div>
  );
}

/** One thing to say to Claude, with a small Copy button. */
export function CopyLine({ text }: { text: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const { said, run } = useCopy();
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-sunken px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0 text-sm text-pretty text-ink">&ldquo;{text}&rdquo;</p>
      {/* Off screen, not hidden: the older copy command needs a real text box to select. */}
      <textarea ref={box} readOnly value={text} aria-hidden="true" tabIndex={-1} className="pointer-events-none fixed -left-[9999px] h-px w-px opacity-0" />
      <button type="button" onClick={() => run(text, box.current)} className={buttonClass("quiet", "sm", "shrink-0 self-start sm:self-auto")}>
        <span aria-live="polite">{label(said, "Copy")}</span>
      </button>
    </div>
  );
}

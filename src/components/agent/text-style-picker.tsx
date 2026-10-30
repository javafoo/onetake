"use client";

import { Button } from "@/components/ui";
import { TEXT_STYLE_IDS, TEXT_STYLES, type TextSize, type TextStyle } from "@/content/text-styles";

import { Modal } from "./modal";

/* The five on-image looks, each drawn as the word "Text" the way that look
   draws it, then the size and the case. One choice sets the reel's hook, the
   set's slides and words on a photo alike. */

const SAMPLE: Record<TextStyle, string> = {
  bold: "font-sans font-bold text-white",
  pastel: "font-sans font-bold text-[#f3e38f]",
  boxed: "font-sans font-bold text-black bg-white rounded-md px-2.5 py-0.5",
  serif: "font-display font-medium text-white",
  serif_boxed: "font-display font-medium text-black bg-white px-2.5 py-0.5",
};

const PILL = "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors";
const pillState = (on: boolean) => (on ? "border-ink bg-ink text-canvas" : "border-line-strong text-ink hover:border-ink");

export type TextLookChoice = { style: TextStyle; size: TextSize; lowercase: boolean };

export function TextStylePicker({
  value,
  onChange,
  onClose,
}: {
  value: TextLookChoice;
  /** Only the part she changed, so the composer can tell a size she set from one she left alone. */
  onChange: (change: Partial<TextLookChoice>) => void;
  onClose: () => void;
}) {
  return (
    <Modal
      title="Text style"
      onClose={onClose}
      footer={
        <Button type="button" onClick={onClose}>
          Done
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted">How the words look on a reel, on slides and on a photo. Free to change.</p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {TEXT_STYLE_IDS.map((id) => (
          <li key={id}>
            <button
              type="button"
              onClick={() => onChange({ style: id })}
              aria-pressed={value.style === id}
              className={`block w-full rounded-xl border p-1 text-left transition-colors ${value.style === id ? "border-accent ring-2 ring-accent" : "border-line-strong hover:border-ink"}`}
            >
              {/* A short tile: the sample is the word, not a phone screen, so it needs only a band of dark behind it. */}
              <span className="grid h-16 place-items-center rounded-lg bg-neutral-900">
                <span className={`text-2xl leading-none ${SAMPLE[id]}`}>{value.lowercase ? "text" : "Text"}</span>
              </span>
              <span className="mt-1.5 mb-0.5 block px-1 text-sm font-medium text-ink">{TEXT_STYLES[id].label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2" role="group" aria-label="Size">
          <span className="mr-1 text-sm text-muted">Size</span>
          {(["large", "small"] as const).map((size) => (
            <button key={size} type="button" onClick={() => onChange({ size })} aria-pressed={value.size === size} className={`${PILL} ${pillState(value.size === size)}`}>
              {/* A tiny sample of the size: the same letter, big or small. */}
              <span aria-hidden className={`font-semibold leading-none ${size === "large" ? "text-base" : "text-[10px]"}`}>
                A
              </span>
              {size === "large" ? "Large" : "Small"}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2" role="group" aria-label="Case">
          <span className="mr-1 text-sm text-muted">Case</span>
          <button type="button" onClick={() => onChange({ lowercase: false })} aria-pressed={!value.lowercase} aria-label="As typed" className={`${PILL} ${pillState(!value.lowercase)}`}>
            Aa
          </button>
          <button type="button" onClick={() => onChange({ lowercase: true })} aria-pressed={value.lowercase} aria-label="All lowercase" className={`${PILL} ${pillState(value.lowercase)}`}>
            aa
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted">Small sets the words about half the size in a narrow column, a phrase to a line. aa puts every word in lowercase.</p>
    </Modal>
  );
}

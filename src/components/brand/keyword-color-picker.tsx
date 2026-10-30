"use client";

import { useState } from "react";

import { Fieldset } from "@/components/ui";
import { KEYWORD_SWATCHES, keywordPaint, normalizeHex, type KeywordPaint } from "@/content/keyword-color";

/* The keyword colour on the Brand page: no colour (each look's own), a
   swatch, or any colour from the system picker. The preview draws the
   keyword on the two backgrounds it lands on, a white box and a dark clip,
   the way the renderers will: in her colour, or on a block of it where the
   colour alone would not read. The server checks the value again. */

const ON_BOX = "#ffffff";
const ON_CLIP = "#1c1c1c";

function Sample({ keyword, paint, ink, background }: { keyword: string; paint: KeywordPaint | null; ink: string; background: string }) {
  const word = !paint
    ? { color: ink }
    : paint.kind === "text"
      ? { color: paint.color }
      : { color: paint.ink, background: paint.fill, borderRadius: "0.25em", padding: "0 0.18em" };
  return (
    <span className="inline-flex items-center rounded-lg px-3 py-2 text-sm font-semibold ring-1 ring-line" style={{ background, color: ink }}>
      Comment&nbsp;<span style={word}>{keyword}</span>
    </span>
  );
}

export function KeywordColorPicker({ defaultValue, keyword }: { defaultValue?: string; keyword: string }) {
  const [color, setColor] = useState<string | null>(normalizeHex(defaultValue));
  const word = keyword.trim().toUpperCase() || "AVATAR";
  const custom = color && !KEYWORD_SWATCHES.some((swatch) => swatch.hex === color) ? color : null;
  const ring = (on: boolean) => (on ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "ring-1 ring-line");

  return (
    <Fieldset legend="Keyword colour" hint="Your comment keyword is drawn in this colour on reels and on a carousel's last slide. Where the colour would be hard to read, the word sits on a small block of it instead.">
      <input type="hidden" name="keywordColor" value={color ?? ""} />
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setColor(null)}
          aria-pressed={color === null}
          className={`h-9 rounded-full px-3.5 text-sm text-ink ${ring(color === null)}`}
        >
          Same as the text
        </button>
        {KEYWORD_SWATCHES.map((swatch) => (
          <button
            key={swatch.hex}
            type="button"
            onClick={() => setColor(swatch.hex)}
            aria-pressed={color === swatch.hex}
            aria-label={swatch.label}
            title={swatch.label}
            className={`size-9 rounded-full ${ring(color === swatch.hex)}`}
            style={{ background: swatch.hex }}
          />
        ))}
        <label className={`relative flex h-9 cursor-pointer items-center gap-2 rounded-full px-3.5 text-sm text-ink ${ring(Boolean(custom))}`}>
          <span className="size-4 rounded-full ring-1 ring-line" style={{ background: custom ?? "conic-gradient(#e8322b, #ffd23f, #2fbf71, #2f7bff, #8b5cf6, #e8322b)" }} />
          Other
          <input
            type="color"
            value={custom ?? "#e8322b"}
            onChange={(event) => setColor(normalizeHex(event.target.value))}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Pick any colour"
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2" aria-hidden>
        <Sample keyword={word} paint={color ? keywordPaint(color, ON_BOX) : null} ink="#111111" background={ON_BOX} />
        <Sample keyword={word} paint={color ? keywordPaint(color, ON_CLIP) : null} ink="#ffffff" background={ON_CLIP} />
      </div>
    </Fieldset>
  );
}

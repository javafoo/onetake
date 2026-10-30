/* The reel fonts (Inter, EB Garamond) have letters, numbers, punctuation and
   the plain arrows, and no emoji: an emoji in a hook prints as a "no glyph"
   box, which is what happened to a "➡️" copied from a reference post on
   2026-09-23. Emoji arrows become real arrows, which read the same on screen;
   every other emoji is dropped. Pure, so the writer and the renderer agree. */

const ARROWS: [RegExp, string][] = [
  [/[➡⮕⇨⇒👉🫵]/gu, "→"],
  [/[⬇⇩⇓👇]/gu, "↓"],
  [/[⬅⇦⇐👈]/gu, "←"],
  [/[⬆⇧⇑👆☝]/gu, "↑"],
];

/** Variation selectors, joiners and skin tones that ride along with emoji. */
const RIDERS = /[\u{FE0E}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]/gu;
/** Every pictograph the fonts cannot draw, once the arrows have been swapped. */
const PICTOGRAPHS = /\p{Extended_Pictographic}/gu;

/** The text as the reel fonts can draw it. */
export function tidyGlyphs(text: string): string {
  let out = text.replace(RIDERS, "");
  for (const [pattern, arrow] of ARROWS) out = out.replace(pattern, arrow);
  out = out.replace(PICTOGRAPHS, "");
  // A dropped emoji leaves a double space or a space before a line end behind.
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+(\n|$)/g, "$1");
}

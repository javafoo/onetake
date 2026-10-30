/* The five on-image text looks, shared by reels (the hook overlay) and
   carousels (the kit picker). This module is pure and client-safe: the
   composer imports it to draw the picker, the renderers import it to know
   what to draw. Keep it free of server modules. */

export type TextStyle = "bold" | "pastel" | "boxed" | "serif" | "serif_boxed";

export const TEXT_STYLES: Record<TextStyle, { label: string; blurb: string }> = {
  bold: { label: "Bold", blurb: "White sans over a lightly dimmed clip, no boxes." },
  pastel: { label: "Pastel", blurb: "Pastel yellow sans over a lightly dimmed clip, no boxes." },
  boxed: { label: "Bold box", blurb: "Black sans in white boxes over the clip." },
  serif: { label: "Serif", blurb: "White serif over a lightly dimmed clip, no boxes." },
  serif_boxed: { label: "Serif box", blurb: "Black serif in white boxes over the clip." },
};

export const TEXT_STYLE_IDS = Object.keys(TEXT_STYLES) as TextStyle[];

export const DEFAULT_TEXT_STYLE: TextStyle = "boxed";

export function isTextStyle(value: unknown): value is TextStyle {
  return typeof value === "string" && Object.hasOwn(TEXT_STYLES, value);
}

/* Rows written before the five looks existed carry the two old reel ids and
   the carousel's "standard"; they keep working by mapping onto the look they
   were. Anything unknown gets the default rather than an error, because a
   stored style must never stop a reel from rendering. */
const LEGACY: Record<string, TextStyle> = {
  box: "boxed",
  standard: "boxed",
  elegant: "serif",
};

export function normalizeTextStyle(value: unknown): TextStyle {
  if (isTextStyle(value)) return value;
  if (typeof value === "string" && Object.hasOwn(LEGACY, value)) return LEGACY[value];
  return DEFAULT_TEXT_STYLE;
}

/* How big the words are drawn. "large" is every look as it was first built;
   "small" is the founder's reference quote (2026-09-24): about half the
   size, in a narrow centred column, one phrase to a line. */
export type TextSize = "large" | "small";

export const TEXT_SIZES: Record<TextSize, { label: string }> = {
  large: { label: "Large" },
  small: { label: "Small" },
};

export const DEFAULT_TEXT_SIZE: TextSize = "large";

/** The small column, as a share of the frame's width, centred (founder's reference, 2026-09-24). */
export const SMALL_COLUMN = 0.62;
/** Pastel small is drawn 30% bigger than first cut (owner, 2026-10-05). Only this look: bold, serif and the boxed looks keep their small size. */
export const PASTEL_SMALL_BOOST = 1.3;
/* The bigger type needs a wider column or every phrase wraps. 0.72 still
   leaves 14% of the frame's width free either side, so nothing runs near the edge. */
export const PASTEL_SMALL_COLUMN = 0.72;

/** How much bigger than the shared small size a look's small type is drawn: 1 for every look but pastel. */
export function smallBoost(style: string): number {
  return style === "pastel" ? PASTEL_SMALL_BOOST : 1;
}

/** The small column for a look, as a share of the frame's width. Reels, carousels and words on a photo all use it. */
export function smallColumn(style: string): number {
  return style === "pastel" ? PASTEL_SMALL_COLUMN : SMALL_COLUMN;
}

export function isTextSize(value: unknown): value is TextSize {
  return value === "large" || value === "small";
}

/** Rows written before sizes existed have none: they were large. */
export function normalizeTextSize(value: unknown): TextSize {
  return isTextSize(value) ? value : DEFAULT_TEXT_SIZE;
}

/**
 * The words as they go on screen: lowercased when she asked for it, otherwise
 * exactly as typed. Lowercased by the rules of the language they are written
 * in (`localeFor` in ./languages.ts gives the tag); English when not said.
 */
export function onScreenCase(text: string, lowercase: boolean | undefined, locale = "en"): string {
  return lowercase === true ? text.toLocaleLowerCase(locale) : text;
}

/**
 * The Text chip's words: the look, then only what differs from the defaults,
 * so the usual pick reads "Text · Pastel" and a changed one "Text · Pastel · Small · aa".
 */
export function textChipLabel(style: TextStyle, size: TextSize, lowercase: boolean): string {
  return ["Text", TEXT_STYLES[style].label, ...(size === "small" ? ["Small"] : []), ...(lowercase ? ["aa"] : [])].join(" · ");
}

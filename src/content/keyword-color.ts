import type { BrandProfile } from "./hooks";
import { keywordsOf } from "./offers";

/* The keyword colour (first paying user, F2 in docs/MASTER-PLAN.md).
 *
 * One colour per avatar, set on the Brand page. Her comment keyword is drawn
 * in it wherever it appears on a reel (the hook and the cue) and on a
 * carousel's last slide. Unset, every look draws the keyword as it always did.
 *
 * A colour she picks may not read on the look it lands on: pale yellow on a
 * white box, navy on a darkened clip. Then the word gets a small block of her
 * colour behind it, in black or white type, rather than vanishing. So her
 * colour always shows and the word always reads.
 *
 * Pure and browser-safe: the Brand page imports it for the swatches. */

/** The swatches on the Brand page. She can also type any #rrggbb. */
export const KEYWORD_SWATCHES = [
  { label: "Red", hex: "#e8322b" },
  { label: "Coral", hex: "#ff6b57" },
  { label: "Pink", hex: "#ff5fa8" },
  { label: "Yellow", hex: "#ffd23f" },
  { label: "Green", hex: "#2fbf71" },
  { label: "Blue", hex: "#2f7bff" },
  { label: "Purple", hex: "#8b5cf6" },
] as const;

/** `#abc` or `#aabbcc`, any case, as `#aabbcc`; anything else is null. */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-f]{3}$/.test(raw)) return `#${[...raw.slice(1)].map((digit) => digit + digit).join("")}`;
  return null;
}

/** Her keyword colour, or null for the look's own. */
export function keywordColorOf(profile: Pick<BrandProfile, "keywordColor">): string | null {
  return normalizeHex(profile.keywordColor);
}

/** Every keyword she uses and her colour for them, or null when she has not picked one. */
export function keywordMarkOf(profile: BrandProfile): { words: string[]; color: string } | null {
  const color = keywordColorOf(profile);
  const words = keywordsOf(profile);
  return color && words.length ? { words, color } : null;
}

function channels(hex: string): [number, number, number] {
  const value = normalizeHex(hex) ?? "#000000";
  return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16) / 255) as [number, number, number];
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Black or white, whichever reads better on this colour. */
export function inkOn(hex: string): "#111111" | "#ffffff" {
  return contrast(hex, "#111111") >= contrast(hex, "#ffffff") ? "#111111" : "#ffffff";
}

/* Big display type, so the large-text threshold (3:1) is the bar. */
const READABLE = 3;

export type KeywordPaint =
  /** The word in her colour, straight on what is behind it. */
  | { kind: "text"; color: string }
  /** A block of her colour behind the word, the word in black or white. */
  | { kind: "block"; fill: string; ink: string };

/** How to draw the keyword in `color` over `background` so it shows and reads. */
export function keywordPaint(color: string, background: string): KeywordPaint {
  if (contrast(color, background) >= READABLE) return { kind: "text", color };
  return { kind: "block", fill: color, ink: inkOn(color) };
}

export type Run = { text: string; keyword: boolean };

/**
 * A line cut into runs, each of her keywords a run of its own, matched as a
 * whole word in any case ("Comment guide" finds GUIDE; "guidebook" does not).
 * Joined back together, the runs are the line exactly.
 */
export function keywordRuns(line: string, keywords: readonly string[]): Run[] {
  const wanted = new Set(keywords.map((word) => word.trim().toLocaleLowerCase()).filter(Boolean));
  if (!wanted.size || !line) return line ? [{ text: line, keyword: false }] : [];
  const runs: Run[] = [];
  const push = (text: string, keyword: boolean) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && !last.keyword && !keyword) last.text += text;
    else runs.push({ text, keyword });
  };
  let at = 0;
  for (const match of line.matchAll(/[\p{L}\p{N}]+/gu)) {
    const index = match.index ?? 0;
    push(line.slice(at, index), false);
    push(match[0], wanted.has(match[0].toLocaleLowerCase()));
    at = index + match[0].length;
  }
  push(line.slice(at), false);
  return runs;
}

/** Whether a line has one of her keywords in it. */
export function hasKeyword(line: string, keywords: readonly string[]): boolean {
  return keywordRuns(line, keywords).some((run) => run.keyword);
}

import { existsSync } from "node:fs";
import { join } from "node:path";

import { GlobalFonts, createCanvas, type SKRSContext2D } from "@napi-rs/canvas";

import { keywordPaint, keywordRuns, type KeywordPaint } from "../content/keyword-color";
import { phraseLines } from "../content/phrases";
import { DEFAULT_TEXT_SIZE, DEFAULT_TEXT_STYLE, TEXT_STYLES, smallBoost, smallColumn, type TextSize, type TextStyle } from "../content/text-styles";
import { tidyGlyphs } from "./glyphs";

/* The hook is drawn once as a transparent 1080x1920 image and laid over the
   clip. Drawing it ourselves (instead of ffmpeg drawtext) is what allows rounded
   boxes, measured line breaks and a font size that adapts to the hook length.

   Five looks, the ids shared with the carousel picker (src/content/text-styles.ts).
   Two of them box the type: black in white rounded boxes, the text a viewer
   cannot miss. The other three set it straight on the clip, which the
   assembler veils with a light black layer so white (or pastel) type reads;
   that is the quieter, more editorial look the founder asked for on 2026-09-23. */

export const FRAME = { width: 1080, height: 1920 } as const;
export type ReelStyle = TextStyle;
export const REEL_STYLES = TEXT_STYLES;

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const SANS_FAMILY = "HookSans";
const SERIF_FAMILY = "HookSerif";
/* TikTok Sans (Open Font License) at semibold: the sans every bold look and
   the carousel kits share since 2026-09-24. Inter is the fallback if the file
   is ever missing. */
const SANS_FILES = ["TikTokSans-Variable.ttf", "Inter-Variable.ttf"];
const SANS_WEIGHT = 600;
/* EB Garamond (Open Font License) at a medium weight; the serif the carousel
   kits already use is the fallback if the file is ever missing. */
const SERIF_FILES = ["EBGaramond-Variable.ttf", "InstrumentSerif-Regular.ttf"];
const SERIF_WEIGHT = 500;

/** The carousel pastel kit's yellow, so a pastel reel and a pastel carousel match. */
const PASTEL_YELLOW = "#F9F4AC";

type Metrics = { sizes: readonly number[]; cueSizes: readonly number[]; lineHeight: number; maxWidth: number; maxLines: number };
type Look = Metrics & { face: "sans" | "serif"; boxes: boolean; color: string };

/* 110px margins either side. */
const BOXED: Metrics = { sizes: [58, 54, 50, 46, 42, 38, 34], cueSizes: [40, 36, 32], lineHeight: 1.42, maxWidth: 860, maxLines: 4 };
/* Garamond carries less ink and a lower x-height than the sans, so in a box
   it is set a step larger and a touch tighter to fill the same shape. */
const SERIF_BOXED: Metrics = { sizes: [66, 62, 58, 54, 50, 46, 42], cueSizes: [46, 42, 38], lineHeight: 1.3, maxWidth: 860, maxLines: 4 };
/* A serif with no box to hold it, set small and quiet the way the reference
   reels are typed (a quarter smaller than the first cut, founder 2026-09-24),
   on margins half as wide again (165px). A hook written as short lines keeps
   its line breaks, with a gap between groups, so it reads like the founder's
   example rather than a paragraph. */
const OPEN_SERIF: Metrics = { sizes: [50, 47, 44, 41, 38, 35, 32, 29], cueSizes: [32, 29, 26], lineHeight: 1.2, maxWidth: 750, maxLines: 8 };
/* The same quiet layout for the sans, a step smaller because the sans is wider. */
const OPEN_SANS: Metrics = { sizes: [44, 41, 38, 36, 34, 32, 30, 28], cueSizes: [30, 28, 26], lineHeight: 1.28, maxWidth: 750, maxLines: 8 };

const LOOK: Record<TextStyle, Look> = {
  bold: { ...OPEN_SANS, face: "sans", boxes: false, color: "#ffffff" },
  pastel: { ...OPEN_SANS, face: "sans", boxes: false, color: PASTEL_YELLOW },
  boxed: { ...BOXED, face: "sans", boxes: true, color: "#111111" },
  serif: { ...OPEN_SERIF, face: "serif", boxes: false, color: "#ffffff" },
  serif_boxed: { ...SERIF_BOXED, face: "serif", boxes: true, color: "#111111" },
};

/* The small size (founder, 2026-09-24): the same look, set smaller in a
   narrow centred column, with lines broken at the pauses. On a photo it is
   half the large size; a reel's large type is already set for a phone held at
   arm's length, so half would not read, and it steps down by less. */
export const SMALL_REEL_SCALE = 0.8;
/** Small never goes below this on a reel: a phone at arm's length has to read it. */
const SMALL_REEL_FLOOR = 44;
/** Small lines are read as a quote, a phrase at a time, so they get more air between them. */
const SMALL_LEADING = 1.25;
/* A boxed look keeps its own line height at the small size: the box's padding
   already parts the rows, and the extra air left a gap inside one box about
   twice what the founder wanted (2026-10-07). */

/** The sizes a look's small reel type steps through, largest first. Every look's small type
    sat at the 44px floor before pastel was made 30% bigger (owner, 2026-10-05); pastel now
    starts at 57px (44 x 1.3) and steps down 3px at a time to that floor, so a long phrase
    shrinks to fit rather than overflowing. Other looks keep their small sizes exactly. */
export function smallReelSizes(style: TextStyle, sizes: readonly number[]): readonly number[] {
  const boost = smallBoost(style);
  if (boost === 1) return sizes.map((value) => Math.max(SMALL_REEL_FLOOR, Math.round(value * SMALL_REEL_SCALE)));
  const ladder: number[] = [];
  for (let px = Math.round(SMALL_REEL_FLOOR * boost); px > SMALL_REEL_FLOOR; px -= 3) ladder.push(px);
  return [...ladder, SMALL_REEL_FLOOR];
}

function metricsFor(style: TextStyle, size: TextSize): Look {
  const look = LOOK[style];
  if (size !== "small") return look;
  return {
    ...look,
    sizes: smallReelSizes(style, look.sizes),
    cueSizes: smallReelSizes(style, look.cueSizes),
    maxWidth: Math.round(FRAME.width * smallColumn(style)),
    maxLines: MAX_WRITTEN_LINES,
    lineHeight: look.boxes ? look.lineHeight : look.lineHeight * SMALL_LEADING,
  };
}

/** Whether the assembler must veil the clip under this look: only the looks with no box need it. */
export function styleVeils(style: TextStyle): boolean {
  return !LOOK[style].boxes;
}

/** A hook written as lines and groups may run to this many lines; the size drops to fit. */
const MAX_WRITTEN_LINES = 12;

/** The blank line between two groups of an elegant hook, as a share of the
    line height: a whole empty line, the way the founder's reference reels are
    typed (one blank line between ideas, the lines of a list tight), 2026-09-24. */
const GROUP_GAP = 1;

/** Boxed looks stack their groups close, the way caption boxes are stacked in the
    reference posts: each box already separates its line, so a whole blank line
    between groups is wasted height (founder, 2026-09-24). */
const BOXED_GROUP_GAP = 0.3;

const PAD_X = 0.46;
const RADIUS = 0.34;

let registered = false;
function ensureFonts(): void {
  if (registered) return;
  const sans = SANS_FILES.map((file) => join(FONT_DIR, file)).find((path) => existsSync(path));
  if (sans) GlobalFonts.registerFromPath(sans, SANS_FAMILY);
  const serif = SERIF_FILES.map((file) => join(FONT_DIR, file)).find((path) => existsSync(path));
  if (serif) GlobalFonts.registerFromPath(serif, SERIF_FAMILY);
  registered = true;
}

function context(): SKRSContext2D {
  ensureFonts();
  return createCanvas(FRAME.width, FRAME.height).getContext("2d");
}

function setFont(ctx: SKRSContext2D, size: number, style: ReelStyle): void {
  if (LOOK[style].face === "serif") {
    ctx.fontVariationSettings = `"wght" ${SERIF_WEIGHT}`;
    ctx.font = `${size}px "${SERIF_FAMILY}"`;
    return;
  }
  ctx.fontVariationSettings = `"wght" ${SANS_WEIGHT}`;
  ctx.font = `${size}px "${SANS_FAMILY}"`;
}

function wrap(ctx: SKRSContext2D, words: string[], maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || ctx.measureText(candidate).width <= maxWidth) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Greedy wrapping leaves a one-word last line. Narrowing the box until the line
    count would grow gives even lines at the same count. */
function balancedWrap(ctx: SKRSContext2D, words: string[], maxWidth: number): string[] {
  const greedy = wrap(ctx, words, maxWidth);
  let low = 0;
  let high = maxWidth;
  let best = greedy;
  while (high - low > 4) {
    const mid = (low + high) / 2;
    const attempt = wrap(ctx, words, mid);
    if (attempt.length <= greedy.length && attempt.every((line) => ctx.measureText(line).width <= maxWidth)) {
      best = attempt;
      high = mid;
    } else low = mid;
  }
  return best;
}

/** A line of "" is a gap between groups: nothing is drawn there, and it is shorter than a line. */
export type HookLayout = {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** The top of each line, in pixels from the top of the block. */
  tops: number[];
  blockHeight: number;
  style: ReelStyle;
};

function stack(lines: string[], lineHeight: number, gap: number = GROUP_GAP): { tops: number[]; blockHeight: number } {
  const tops: number[] = [];
  let y = 0;
  for (const line of lines) {
    tops.push(y);
    y += line ? lineHeight : Math.round(lineHeight * gap);
  }
  return { tops, blockHeight: y };
}

/** The writer's own line breaks, kept: each line wrapped only if it is too
    wide, a blank line kept as a gap, never two gaps in a row and none at the ends. */
function keepBreaks(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) {
      if (out.length && out[out.length - 1] !== "") out.push("");
      continue;
    }
    out.push(...wrap(ctx, line.split(" "), maxWidth));
  }
  while (out[out.length - 1] === "") out.pop();
  return out;
}

/** The smallest a hook is ever set when it has to shrink to fit a height. */
const MIN_FIT_SIZE = 24;

/** `maxHeight`, in pixels, is the most the block may take: a long written
    hook steps down past the style's own sizes until it fits (never below
    MIN_FIT_SIZE), so it stays inside the safe area with room for its cue. */
export function layoutHook(raw: string, style: ReelStyle = DEFAULT_TEXT_STYLE, maxHeight?: number, size: TextSize = DEFAULT_TEXT_SIZE): HookLayout {
  const text = tidyGlyphs(raw);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) throw new Error("Hook text is empty");
  const ctx = context();
  const spec = metricsFor(style, size);
  /* Line breaks the writer (or she) put in are kept in every style: in a
     boxed style each group becomes its own stack of boxes, the way a story
     post is captioned; in an open style the gap is air. */
  const written = /\n/.test(text.trim());
  const maxLines = written ? MAX_WRITTEN_LINES : spec.maxLines;
  const smallest = spec.sizes[spec.sizes.length - 1];
  const sizes = maxHeight ? [...spec.sizes, ...Array.from({ length: Math.max(0, Math.floor((smallest - MIN_FIT_SIZE) / 2)) }, (_, i) => smallest - 2 * (i + 1))] : [...spec.sizes];
  let lines: string[] = [];
  let fontSize: number = sizes[sizes.length - 1];
  const measure = (line: string) => ctx.measureText(line).width;
  for (const px of sizes) {
    setFont(ctx, px, style);
    // Small breaks at the pauses, one phrase to a line; her own breaks win in both sizes.
    lines = written ? keepBreaks(ctx, text, spec.maxWidth) : size === "small" ? phraseLines(text, measure, spec.maxWidth) : balancedWrap(ctx, words, spec.maxWidth);
    fontSize = px;
    const fitsLines = lines.filter(Boolean).length <= maxLines;
    const fitsHeight = !maxHeight || stack(lines, Math.round(px * spec.lineHeight), gapFor(spec)).blockHeight <= maxHeight;
    /* A word wider than the column (a German compound) is a line on its own
       that no wrap can shorten: the size keeps dropping until it fits. */
    const fitsWidth = lines.every((line) => measure(line) <= spec.maxWidth);
    // Past the style's own sizes only height matters: the line count was already allowed to grow.
    if ((fitsLines || px < smallest) && fitsHeight && fitsWidth) break;
  }
  const lineHeight = Math.round(fontSize * spec.lineHeight);
  return { lines, fontSize, lineHeight, ...stack(lines, lineHeight, gapFor(spec)), style };
}

function gapFor(look: Look): number {
  return look.boxes ? BOXED_GROUP_GAP : GROUP_GAP;
}

/** The cue is one short line in the hook's own style and at the hook's own
    size, so the two read as one voice (founder, 2026-09-24: a smaller cue was
    too small to read). Without a hook size it takes the style's cue sizes. A
    cue too long for one line is a writing mistake, so it is shrunk rather than
    wrapped. */
export function layoutCue(text: string, style: ReelStyle = DEFAULT_TEXT_STYLE, hookSize?: number, size: TextSize = DEFAULT_TEXT_SIZE): HookLayout {
  const line = tidyGlyphs(text).trim().replace(/\s+/g, " ");
  if (!line) throw new Error("Cue text is empty");
  const ctx = context();
  const spec = metricsFor(style, size);
  const sizes = hookSize ? [hookSize, ...spec.cueSizes.filter((px) => px < hookSize)] : spec.cueSizes;
  let fontSize: number = sizes[sizes.length - 1];
  for (const px of sizes) {
    setFont(ctx, px, style);
    fontSize = px;
    if (ctx.measureText(line).width <= spec.maxWidth) break;
  }
  const lineHeight = Math.round(fontSize * spec.lineHeight);
  return { lines: [line], fontSize, lineHeight, tops: [0], blockHeight: lineHeight, style };
}

/** Her keywords and the colour they are drawn in. Absent: every word in the look's own colour. */
export type KeywordMark = { words: readonly string[]; color: string };

/* What the keyword sits on: a white box, or the veiled clip, which reads as
   near black under white type. */
const VEILED_CLIP = "#1c1c1c";

/** How a look draws her keyword: in her colour if it reads there, else on a block of it. */
export function keywordPaintFor(style: ReelStyle, color: string): KeywordPaint {
  return keywordPaint(color, LOOK[style].boxes ? "#ffffff" : VEILED_CLIP);
}

/**
 * One line, centred on `centreX`, its keyword runs in her colour. Drawn run by
 * run from the line's left edge so the words land where a single fillText of
 * the line would have put them.
 */
function fillLine(ctx: SKRSContext2D, line: string, centreX: number, y: number, ink: string, fontSize: number, keyword: KeywordMark | undefined, paint: KeywordPaint | null): void {
  const runs = keyword && paint ? keywordRuns(line, keyword.words) : [];
  if (!paint || !runs.some((run) => run.keyword)) {
    ctx.textAlign = "center";
    ctx.fillStyle = ink;
    ctx.fillText(line, centreX, y);
    return;
  }
  ctx.textAlign = "left";
  let x = centreX - ctx.measureText(line).width / 2;
  for (const run of runs) {
    const width = ctx.measureText(run.text).width;
    if (run.keyword && paint.kind === "block") {
      // The block is drawn without the letter shadow: it is a shape, not type.
      ctx.save();
      ctx.shadowColor = "transparent";
      const padX = fontSize * 0.18;
      const height = fontSize * 1.12;
      ctx.fillStyle = paint.fill;
      ctx.beginPath();
      ctx.roundRect(x - padX, y - height / 2, width + padX * 2, height, fontSize * 0.16);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = !run.keyword ? ink : paint.kind === "block" ? paint.ink : paint.color;
    ctx.fillText(run.text, x, y);
    x += width;
  }
}

/** `top` is the y of the block's upper edge in pixels. Returns PNG bytes. */
export function renderOverlay(layout: HookLayout, top: number, keyword?: KeywordMark): Buffer {
  ensureFonts();
  const canvas = createCanvas(FRAME.width, FRAME.height);
  const ctx = canvas.getContext("2d");
  setFont(ctx, layout.fontSize, layout.style);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const centreX = FRAME.width / 2;
  const paint = keyword?.words.length ? keywordPaintFor(layout.style, keyword.color) : null;

  const look = LOOK[layout.style];
  if (!look.boxes) {
    /* Type straight on the veiled clip. The veil is the assembler's
       quarter-strength black layer; here only a thin, tight shadow hugs each
       letter, close enough to read as a hairline edge, so a word over a bright
       patch is still legible without any glow around the block (founder,
       2026-09-24: an edge, not a glow). */
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
    ctx.shadowBlur = layout.fontSize * 0.08;
    ctx.shadowOffsetY = layout.fontSize * 0.02;
    layout.lines.forEach((line, index) => {
      if (line) fillLine(ctx, line, centreX, top + layout.tops[index] + layout.lineHeight / 2, look.color, layout.fontSize, keyword, paint);
    });
    return canvas.toBuffer("image/png");
  }

  const padX = layout.fontSize * PAD_X;
  // The serif box is a plain block, square-cornered like a caption card; the sans box is rounded (founder, 2026-09-24).
  const radius = layout.style === "serif_boxed" ? 0 : layout.fontSize * RADIUS;

  // Boxes first, as one path, so neighbouring lines merge into a single shape.
  ctx.beginPath();
  layout.lines.forEach((line, index) => {
    if (!line) return;
    const width = ctx.measureText(line).width + padX * 2;
    ctx.roundRect(centreX - width / 2, top + layout.tops[index] - 1, width, layout.lineHeight + 2, radius);
  });
  ctx.fillStyle = "#ffffff";
  ctx.fill();

  /* "middle" centres the em box; both faces sit a little high in it, the
     serif more so, so the ink is nudged down to sit centred in its box. */
  const nudge = layout.fontSize * (look.face === "serif" ? 0.06 : 0.04);
  layout.lines.forEach((line, index) => {
    if (line) fillLine(ctx, line, centreX, top + layout.tops[index] + layout.lineHeight / 2 + nudge, look.color, layout.fontSize, keyword, paint);
  });
  return canvas.toBuffer("image/png");
}

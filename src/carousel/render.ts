import { join } from "node:path";

import { GlobalFonts, createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";

import { genericAsk, isEnglish, LANGUAGES, localeFor, normaliseLanguage } from "@/content/languages";
import { inkOn, keywordPaint, keywordRuns, normalizeHex } from "@/content/keyword-color";
import { onScreenCase, smallBoost, smallColumn, type TextSize } from "@/content/text-styles";

import { kitFonts, serifWordFont, type FontSpec, type PaletteKey, type StyleKit } from "./kits";
import { askText, FORMATS, type CarouselSpec, type CoverSlide, type GridSlide, type KeywordSlide, type PaperSlide, type Slide, type SplitSlide, type Title } from "./spec";
import { parseEmphasis } from "./text";

/* The renderer is the fixed half of the system: the model may only choose words
   and slide types, never pixels. Everything here is deterministic, so the same
   spec and kit always produce the same PNGs. */

export type FaceBox = { top: number; bottom: number; left: number; right: number };
export type PhotoInput = { data: Buffer; face?: FaceBox | null };
export type Photos = Record<string, PhotoInput>;
export type RenderedSlide = { file: string; png: Buffer };
export type RenderResult = { slides: RenderedSlide[]; sheet: Buffer };

/**
 * The size and case she picked in the Text picker. Size changes the words on
 * a photo (covers, and words on her own photo); lowercase changes every word
 * a slide draws. Absent is large, as typed: every set drawn before these existed.
 */
/* What type over a photo sits on, for judging whether her keyword colour
   reads there: the dimmed photo under a scrim is near black. */
const PHOTO_BEHIND = "#1c1a19";

export type TextLook = {
  size?: TextSize;
  lowercase?: boolean;
  /** Her keyword colour (src/content/keyword-color.ts), #rrggbb. Absent: the kit's own. */
  keywordColor?: string;
};

/** Small type is about half the kit's largest title (pastel: 30% more than that, see `smallBoost`). */
export const SMALL_SCALE = 0.5;
/** The gap between small lines, as a share of the type size. */
const SMALL_LINE_GAP = 0.42;
/** Large words on her own photo keep a margin either side: they ran nearly edge to edge (founder, 2026-09-24). */
export const TEXT_PHOTO_LARGE_COLUMN = 0.8;

/**
 * A set's words lowercased, for a set drawn with lowercase on: titles, accent
 * lines, subs, bodies and promises. The comment keyword is left as it is,
 * because it is the word a viewer types. The stored spec keeps her case; this
 * is applied at draw time only.
 */
export function lowercaseSpec(spec: CarouselSpec): CarouselSpec {
  const locale = localeFor(spec.language);
  const lower = (text: string) => onScreenCase(text, true, locale);
  const title = (value: Title): Title => ({ ...value, lines: value.lines.map(lower), ...(value.accent ? { accent: lower(value.accent) } : {}) });
  const slides = spec.slides.map((slide): Slide => {
    switch (slide.type) {
      case "cover":
        return { ...slide, title: title(slide.title), ...(slide.sub ? { sub: lower(slide.sub) } : {}) };
      case "paper":
        return { ...slide, title: title(slide.title), body: lower(slide.body) };
      case "keyword":
        return { ...slide, promise: lower(slide.promise) };
      case "split":
        return { ...slide, lines: [lower(slide.lines[0]), lower(slide.lines[1])] };
      case "line":
        return { ...slide, text: lower(slide.text) };
      case "grid":
        return { ...slide, headline: lower(slide.headline), ...(slide.sub ? { sub: lower(slide.sub) } : {}) };
    }
  });
  return { ...spec, slides };
}

/** The kit and spec as drawn under her look: a kit that sets titles in caps stops doing so when she asked for lowercase. */
/** The look's keyword colour, checked: the doc is json. */
function keywordColorFrom(look: TextLook): string | undefined {
  return normalizeHex(look.keywordColor) ?? undefined;
}

function withLook(spec: CarouselSpec, kit: StyleKit, look: TextLook): { spec: CarouselSpec; kit: StyleKit } {
  if (look.lowercase !== true) return { spec, kit };
  return { spec: lowercaseSpec(spec), kit: { ...kit, titleUppercase: false } };
}

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const registered = new Set<string>();

export function registerKitFonts(kit: StyleKit): void {
  registerFontFiles(kitFonts(kit));
}

/**
 * Font files from `assets/fonts` under a family name, each family once. A
 * family may be given several files (the weights of one face); the first
 * call for a family registers all of them, a later one nothing.
 */
export function registerFontFiles(fonts: readonly { file: string; family: string }[]): void {
  const fresh = fonts.filter((font) => !registered.has(font.family));
  for (const font of fresh) GlobalFonts.registerFromPath(join(FONT_DIR, font.file), font.family);
  for (const font of fresh) registered.add(font.family);
}

let measuringContext: SKRSContext2D | null = null;
function measurer(): SKRSContext2D {
  if (!measuringContext) measuringContext = createCanvas(8, 8).getContext("2d");
  return measuringContext;
}

function applyFont(ctx: SKRSContext2D, font: FontSpec, size: number): void {
  ctx.fontVariationSettings = font.slant === undefined ? `"wght" ${font.weight}` : `"wght" ${font.weight}, "slnt" ${font.slant}`;
  ctx.font = `${size}px "${font.family}"`;
  ctx.letterSpacing = `${(font.tracking * size).toFixed(2)}px`;
}

/** measureText counts the tracking after the last glyph; the ink does not. */
function trailing(font: FontSpec, size: number): number {
  return font.tracking * size;
}

function color(kit: StyleKit, key: PaletteKey): string {
  return kit.palette[key];
}

function alpha(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${amount})`;
}

/* --- title layout -------------------------------------------------------- */

type LaidRun = { text: string; emphasis: boolean; x: number; width: number };
type LaidLine = {
  kind: "caps" | "accent";
  runs: LaidRun[];
  size: number;
  width: number;
  top: number;
  ascent: number;
  height: number;
};
export type TitleLayout = { lines: LaidLine[]; size: number; width: number; height: number; fitted: boolean };

function capsText(kit: StyleKit, text: string): string {
  return kit.titleUppercase ? text.toUpperCase() : text;
}

function measureLine(kit: StyleKit, line: string, size: number, asTyped = false, literal = false): { runs: LaidRun[]; width: number; ascent: number; descent: number } {
  const ctx = measurer();
  const runs: LaidRun[] = [];
  let x = 0;
  let ascent = 0;
  let descent = 0;
  const parsed = literal ? [{ text: line, emphasis: false }] : parseEmphasis(line);
  // An italic word leans into whatever follows it, so it is given a little room.
  const afterItalic = kit.emphasis === "italic" ? size * 0.06 : 0;
  for (const [index, run] of parsed.entries()) {
    const font = run.emphasis ? kit.fonts.emphasis : kit.fonts.title;
    applyFont(ctx, font, run.emphasis ? size * (kit.emphasisScale ?? 1) : size);
    const text = asTyped || (run.emphasis && kit.emphasisKeepsCase) ? run.text : capsText(kit, run.text);
    const advance = ctx.measureText(text).width + (run.emphasis && index < parsed.length - 1 ? afterItalic : 0);
    const metrics = ctx.measureText(text.trim() || "H");
    ascent = Math.max(ascent, metrics.actualBoundingBoxAscent);
    descent = Math.max(descent, metrics.actualBoundingBoxDescent);
    runs.push({ text, emphasis: run.emphasis, x, width: advance });
    x += advance;
  }
  const last = parsed[parsed.length - 1];
  const lastFont = last.emphasis ? kit.fonts.emphasis : kit.fonts.title;
  return { runs, width: x - trailing(lastFont, last.emphasis ? size * (kit.emphasisScale ?? 1) : size), ascent, descent };
}

function measureAccent(kit: StyleKit, text: string, size: number): { runs: LaidRun[]; width: number; ascent: number; descent: number } {
  const ctx = measurer();
  applyFont(ctx, kit.fonts.accent, size);
  const advance = ctx.measureText(text).width;
  const metrics = ctx.measureText(text);
  return {
    runs: [{ text, emphasis: false, x: 0, width: advance }],
    width: advance - trailing(kit.fonts.accent, size),
    ascent: metrics.actualBoundingBoxAscent,
    descent: metrics.actualBoundingBoxDescent,
  };
}

/** One line pitch for every line, from the face rather than each line's own ink,
    so a line with a comma or a descender does not sit further off than the rest. */
function evenMetrics(kit: StyleKit, size: number): { ascent: number; descent: number } {
  const ctx = measurer();
  applyFont(ctx, kit.fonts.title, size);
  const metrics = ctx.measureText("Hdgy,");
  return { ascent: metrics.actualBoundingBoxAscent, descent: metrics.actualBoundingBoxDescent };
}

function layoutAt(kit: StyleKit, title: Title, size: number, even = false): TitleLayout {
  const pitch = even ? evenMetrics(kit, size) : null;
  const lines: LaidLine[] = [];
  let y = 0;
  let width = 0;
  title.lines.forEach((line, index) => {
    const ink = measureLine(kit, line, size, title.asTyped, title.literal);
    const measured = pitch ? { ...ink, ...pitch } : ink;
    if (index > 0) y += size * kit.lineGap;
    lines.push({
      kind: "caps",
      runs: measured.runs,
      size,
      width: measured.width,
      top: y,
      ascent: measured.ascent,
      height: measured.ascent + measured.descent,
    });
    y += measured.ascent + measured.descent;
    width = Math.max(width, measured.width);
  });
  if (title.accent) {
    const accentSize = size * kit.accentScale;
    const measured = measureAccent(kit, title.accent, accentSize);
    y += size * kit.accentGap;
    lines.push({
      kind: "accent",
      runs: measured.runs,
      size: accentSize,
      width: measured.width,
      top: y,
      ascent: measured.ascent,
      height: measured.ascent + measured.descent,
    });
    y += measured.ascent + measured.descent;
    width = Math.max(width, measured.width);
  }
  return { lines, size, width, height: y, fitted: true };
}

const ABSOLUTE_MIN_TITLE = 30;

/** One shared size for every caps line: the block shrinks until the widest line
    fits the margins and the whole block fits the space it was given. Text never
    overflows, even if that means going under the kit's preferred minimum. */
export function layoutTitle(
  kit: StyleKit,
  title: Title,
  box: { maxWidth: number; maxHeight: number; maxSize?: number; evenLines?: boolean },
): TitleLayout {
  registerKitFonts(kit);
  let fallback: TitleLayout | null = null;
  for (let size = box.maxSize ?? kit.titleSize.max; size >= ABSOLUTE_MIN_TITLE; size -= 2) {
    const layout = layoutAt(kit, title, size, box.evenLines);
    const fits = layout.width <= box.maxWidth && layout.height <= box.maxHeight;
    if (fits) return { ...layout, fitted: size >= kit.titleSize.min };
    fallback = layout;
  }
  return { ...(fallback ?? layoutAt(kit, title, ABSOLUTE_MIN_TITLE, box.evenLines)), fitted: false };
}

/** Words for wrapping: a *marked* group stays whole, so its stars never land on two lines. */
export function wrapUnits(text: string): string[] {
  return text.trim().match(/\*[^*]+\*\S*|\S+/g) ?? [];
}

/** Lines as even as they can be at the fewest lines greedy wrapping needs,
    measured by the caller so a line of mixed faces measures true. */
export function balancedLines(text: string, measure: (line: string) => number, maxWidth: number): string[] {
  const units = wrapUnits(text);
  const at = (limit: number) => {
    const lines: string[] = [];
    let current = "";
    for (const unit of units) {
      const candidate = current ? `${current} ${unit}` : unit;
      if (!current || measure(candidate) <= limit) current = candidate;
      else {
        lines.push(current);
        current = unit;
      }
    }
    if (current) lines.push(current);
    return lines;
  };
  const greedy = at(maxWidth);
  if (greedy.length < 2) return greedy;
  let low = 0;
  let high = maxWidth;
  let best = greedy;
  while (high - low > 4) {
    const mid = (low + high) / 2;
    const attempt = at(mid);
    if (attempt.length <= greedy.length && attempt.every((line) => measure(line) <= maxWidth)) {
      best = attempt;
      high = mid;
    } else low = mid;
  }
  return best;
}

/** A title at one set size that wraps onto more lines rather than shrinking,
    so a short title is not blown up and a long one is not squeezed. It only
    gets smaller when it would need more than `maxLines`. */
export function layoutWrapped(kit: StyleKit, text: string, box: { size: number; maxWidth: number; maxLines: number; asTyped?: boolean }): TitleLayout {
  registerKitFonts(kit);
  let fallback: TitleLayout | null = null;
  for (let size = box.size; size >= ABSOLUTE_MIN_TITLE; size -= 2) {
    const lines = balancedLines(text, (line) => measureLine(kit, line, size, box.asTyped).width, box.maxWidth);
    const layout = layoutAt(kit, { lines, asTyped: box.asTyped }, size, true);
    if (lines.length <= box.maxLines && layout.width <= box.maxWidth) return { ...layout, fitted: true };
    fallback = layout;
  }
  return { ...(fallback ?? layoutAt(kit, { lines: [text], asTyped: box.asTyped }, ABSOLUTE_MIN_TITLE, true)), fitted: false };
}

type TitleColors = { title: string; accent: string; emphasis: string; decoration: string };

function drawTitle(ctx: SKRSContext2D, kit: StyleKit, layout: TitleLayout, centreX: number, top: number, colors: TitleColors): void {
  ctx.textBaseline = "alphabetic";
  for (const line of layout.lines) {
    const baseline = top + line.top + line.ascent;
    let x = centreX - line.width / 2;
    for (const run of line.runs) {
      const isAccent = line.kind === "accent";
      const font = isAccent ? kit.fonts.accent : run.emphasis ? kit.fonts.emphasis : kit.fonts.title;
      const size = run.emphasis && !isAccent ? line.size * (kit.emphasisScale ?? 1) : line.size;
      applyFont(ctx, font, size);
      const ink = run.text.trim() ? ctx.measureText(run.text.trimEnd()).width - trailing(font, size) : 0;
      if (run.emphasis && kit.emphasis === "highlight") {
        const padX = line.size * 0.1;
        const padY = line.size * 0.1;
        ctx.fillStyle = colors.decoration;
        ctx.beginPath();
        ctx.roundRect(x - padX, baseline - line.ascent - padY, ink + padX * 2, line.height + padY * 2, line.size * 0.08);
        ctx.fill();
      }
      ctx.fillStyle = isAccent ? colors.accent : run.emphasis ? colors.emphasis : colors.title;
      ctx.fillText(run.text, x, baseline);
      if (run.emphasis && kit.emphasis === "underline") {
        const thickness = Math.max(3, line.size * 0.065);
        ctx.fillStyle = colors.decoration;
        ctx.fillRect(x, baseline + line.size * 0.15, ink, thickness);
      }
      x += run.width;
    }
  }
}

function lighten(hex: string, amount: number): string {
  const value = hex.replace("#", "");
  const channel = (index: number) => {
    const base = parseInt(value.slice(index * 2, index * 2 + 2), 16);
    return Math.round(base + (255 - base) * amount);
  };
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
}

/** On paper the emphasis carries the kit's colour; over a photo it has to stay
    readable first, so the word goes white and only its mark keeps the colour. */
function titleColors(kit: StyleKit, onPhoto: boolean): TitleColors {
  if (onPhoto) {
    const title = color(kit, kit.photo.titleColor);
    return {
      title,
      accent: color(kit, kit.photo.accentColor),
      emphasis: title,
      decoration: kit.emphasis === "highlight" ? color(kit, "accent") : lighten(color(kit, "accent"), 0.42),
    };
  }
  const title = color(kit, kit.paper.titleColor);
  const emphasis =
    kit.emphasis === "highlight" ? color(kit, "contrast") : kit.emphasisColor === "same" ? title : color(kit, kit.emphasisColor);
  return { title, accent: color(kit, kit.paper.accentColor), emphasis, decoration: color(kit, "accent") };
}

/* --- paragraphs ---------------------------------------------------------- */

export type Paragraph = { lines: string[]; size: number; lineHeight: number; ascent: number; height: number };

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
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

/** Every line inside the measure. Only a word longer than the measure can break this. */
function fitsWidth(ctx: SKRSContext2D, lines: string[], maxWidth: number): boolean {
  return lines.every((line) => ctx.measureText(line).width <= maxWidth);
}

/** Greedy wrapping leaves a one-word last line. Narrowing the measure until the
    line count would grow gives even lines at the same count. */
function balancedWrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const greedy = wrap(ctx, text, maxWidth);
  if (greedy.length < 2) return greedy;
  let low = 0;
  let high = maxWidth;
  let best = greedy;
  while (high - low > 4) {
    const mid = (low + high) / 2;
    const attempt = wrap(ctx, text, mid);
    if (attempt.length <= greedy.length && attempt.every((line) => ctx.measureText(line).width <= maxWidth)) {
      best = attempt;
      high = mid;
    } else low = mid;
  }
  return best;
}

export function layoutParagraph(
  kit: StyleKit,
  text: string,
  options: { size: number; maxWidth: number; maxLines: number; lineHeight?: number },
): Paragraph {
  registerKitFonts(kit);
  const ctx = measurer();
  const ratio = options.lineHeight ?? 1.42;
  let size = options.size;
  let lines: string[] = [];
  while (size > 16) {
    applyFont(ctx, kit.fonts.body, size);
    lines = balancedWrap(ctx, text, options.maxWidth);
    // A single long word (a German compound) is one unbreakable line: the size drops until it fits too.
    if (lines.length <= options.maxLines && fitsWidth(ctx, lines, options.maxWidth)) break;
    size -= 2;
  }
  applyFont(ctx, kit.fonts.body, size);
  const ascent = ctx.measureText("Hxp").actualBoundingBoxAscent;
  const lineHeight = size * ratio;
  return { lines, size, lineHeight, ascent, height: (lines.length - 1) * lineHeight + ascent + size * 0.24 };
}

function drawParagraph(ctx: SKRSContext2D, kit: StyleKit, para: Paragraph, centreX: number, top: number, fill: string): void {
  applyFont(ctx, kit.fonts.body, para.size);
  ctx.fillStyle = fill;
  ctx.textBaseline = "alphabetic";
  para.lines.forEach((line, index) => {
    const width = ctx.measureText(line).width - trailing(kit.fonts.body, para.size);
    ctx.fillText(line, centreX - width / 2, top + para.ascent + index * para.lineHeight);
  });
}

/* --- photo placement ----------------------------------------------------- */

export type Band = { top: number; reason: "default" | "below_face" | "above_face" | "lowest_safe" };

/** Where a text block sits over a portrait. Pure pixel geometry: the face is a
    box in frame coordinates, the answer never covers it unless nothing else fits. */
export function placeBand(
  blockHeight: number,
  face: { top: number; bottom: number } | null,
  safe: { top: number; bottom: number; preferredCentre: number },
  margin: number,
): Band {
  const clamp = (value: number) => Math.min(Math.max(value, safe.top), Math.max(safe.top, safe.bottom - blockHeight));
  const centred = clamp(safe.preferredCentre - blockHeight / 2);
  if (!face) return { top: centred, reason: "default" };
  const overlaps = centred < face.bottom + margin && centred + blockHeight > face.top - margin;
  if (!overlaps) return { top: centred, reason: "default" };

  const below = face.bottom + margin;
  if (below >= safe.top && below + blockHeight <= safe.bottom) return { top: below, reason: "below_face" };
  const above = face.top - margin - blockHeight;
  if (above >= safe.top && above + blockHeight <= safe.bottom) return { top: above, reason: "above_face" };
  return { top: Math.max(safe.top, safe.bottom - blockHeight), reason: "lowest_safe" };
}

type DrawnPhoto = { face: { top: number; bottom: number } | null };

/** Cover-crops the photo into the frame, keeping the face inside and, when the
    caller gave no anchor, sitting it in the upper third where a portrait reads. */
function drawPhoto(
  ctx: SKRSContext2D,
  image: Image,
  frame: { width: number; height: number },
  photo: PhotoInput,
  anchor: number | undefined,
): DrawnPhoto {
  const scale = Math.max(frame.width / image.width, frame.height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const face = photo.face ?? null;

  const slackY = drawHeight - frame.height;
  const slackX = drawWidth - frame.width;
  let offsetY = -slackY / 2;
  let offsetX = -slackX / 2;
  if (anchor !== undefined) {
    offsetY = -slackY * anchor;
  } else if (face) {
    const faceCentre = ((face.top + face.bottom) / 2) * drawHeight;
    offsetY = Math.min(0, Math.max(-slackY, frame.height * 0.34 - faceCentre));
    const faceCentreX = ((face.left + face.right) / 2) * drawWidth;
    offsetX = Math.min(0, Math.max(-slackX, frame.width / 2 - faceCentreX));
  }
  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
  return {
    face: face
      ? { top: face.top * drawHeight + offsetY, bottom: face.bottom * drawHeight + offsetY }
      : null,
  };
}

/** The same crop into one cell of the frame: a half, or a quarter of a grid. */
function drawPhotoInCell(
  ctx: SKRSContext2D,
  image: Image,
  cell: { x: number; y: number; width: number; height: number },
  photo: PhotoInput,
): DrawnPhoto {
  ctx.save();
  ctx.beginPath();
  ctx.rect(cell.x, cell.y, cell.width, cell.height);
  ctx.clip();
  ctx.translate(cell.x, cell.y);
  const drawn = drawPhoto(ctx, image, cell, photo, undefined);
  ctx.restore();
  return { face: drawn.face ? { top: drawn.face.top + cell.y, bottom: drawn.face.bottom + cell.y } : null };
}

/* --- slides -------------------------------------------------------------- */

type Frame = { width: number; height: number };

/** True for the 9:16 story frame, false for the 4:5 carousel frame. */
function tall(frame: Frame): boolean {
  return frame.height / frame.width > 1.4;
}

/** The largest title size, in layout pixels, a cover or words-on-photo may start at. Small is half the kit's
    size, and pastel small is 30% more than that (owner, 2026-10-05); the layout still shrinks it to fit. */
export function coverTitleMax(kit: StyleKit, frame: Frame, size: TextSize): number {
  const full = tall(frame) ? kit.titleSize.max * 1.18 : kit.titleSize.max;
  return size === "small" ? full * SMALL_SCALE * smallBoost(kit.id) : full;
}

/** The sentence under a cover's title: same rule as the title, small is a touch above half the kit's size. */
export function coverSubSize(kit: StyleKit, size: TextSize): number {
  return Math.round(kit.photo.subSize * (size === "small" ? SMALL_SCALE * 1.3 * smallBoost(kit.id) : 1));
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paper without grain reads as a screen; a little noise reads as print. */
function addGrain(ctx: SKRSContext2D, frame: Frame, amount: number): void {
  if (amount <= 0) return;
  const image = ctx.getImageData(0, 0, frame.width, frame.height);
  const data = image.data;
  const random = seeded(0x51ce);
  const strength = amount * 30;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (random() - 0.5) * strength;
    data[i] += noise;
    data[i + 1] += noise;
    data[i + 2] += noise;
  }
  ctx.putImageData(image, 0, 0);
}

function drawBrand(ctx: SKRSContext2D, kit: StyleKit, frame: Frame, brand: string | undefined, onPhoto: boolean): void {
  if (!brand) return;
  applyFont(ctx, kit.fonts.body, kit.brandSize);
  ctx.letterSpacing = `${(kit.brandSize * 0.12).toFixed(2)}px`;
  const text = brand.toUpperCase();
  const width = ctx.measureText(text).width - kit.brandSize * 0.12;
  ctx.fillStyle = onPhoto ? alpha(color(kit, "contrast"), 0.78) : alpha(color(kit, "muted"), 0.95);
  ctx.textBaseline = "alphabetic";
  // On a story the foot of the screen belongs to the platform, so the handle
  // sits above it rather than under the reply bar.
  const baseline = tall(frame) ? frame.height * 0.86 : frame.height - kit.margins.bottom * 0.46;
  ctx.fillText(text, (frame.width - width) / 2, baseline);
}

function paintPaperSlide(
  ctx: SKRSContext2D,
  kit: StyleKit,
  frame: Frame,
  slide: PaperSlide,
  index: number,
  /** How many paper slides came before this one: the tone alternates on those,
      not on the slide number, so two paper slides in a row always differ. */
  ordinal: number,
  brand?: string,
): void {
  const background = ordinal % 2 === 1 ? kit.paper.alternate : kit.paper.background;
  ctx.fillStyle = color(kit, background);
  ctx.fillRect(0, 0, frame.width, frame.height);
  addGrain(ctx, frame, kit.paper.grain);

  const centreX = frame.width / 2;
  const indexHeight = kit.paper.index ? 56 : 0;
  const top = kit.margins.top + indexHeight;
  // A 9:16 story keeps its content clear of the platform's own furniture at the
  // foot of the screen, so the block sits higher than on a 4:5 carousel.
  const bottom = tall(frame)
    ? frame.height * 0.74
    : frame.height - kit.margins.bottom - (brand ? kit.brandSize * 2.2 : 0);

  const body = layoutParagraph(kit, slide.body, {
    size: kit.paper.bodySize,
    maxWidth: frame.width - 2 * (kit.margins.side + 40),
    maxLines: 4,
    lineHeight: 1.46,
  });

  // Title and closing sentence are one group, optically centred: a title pinned
  // to the top with a sentence at the foot reads as two unrelated slides.
  const layout = layoutTitle(kit, slide.title, {
    maxWidth: frame.width - 2 * kit.margins.side,
    maxHeight: (bottom - top) * 0.66,
    maxSize: tall(frame) ? kit.titleSize.max * 1.18 : undefined,
  });
  const gap = kit.paper.rule ? layout.size * 0.62 + 52 : layout.size * 0.66 + 24;
  const groupHeight = layout.height + gap + body.height;
  const groupTop = Math.max(top, top + (bottom - top - groupHeight) * 0.44);

  if (kit.paper.index) {
    const label = String(index + 1).padStart(2, "0");
    applyFont(ctx, kit.fonts.body, 26);
    ctx.letterSpacing = "7px";
    const width = ctx.measureText(label).width - 7;
    ctx.fillStyle = alpha(color(kit, "accent"), 0.95);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, centreX - width / 2, kit.margins.top + 8);
  }

  drawTitle(ctx, kit, layout, centreX, groupTop, titleColors(kit, false));

  const bodyTop = groupTop + layout.height + gap;
  if (kit.paper.rule) {
    ctx.fillStyle = alpha(color(kit, "muted"), 0.6);
    ctx.fillRect(centreX - 44, bodyTop - 46, 88, 2);
  }
  drawParagraph(ctx, kit, body, centreX, bodyTop, alpha(color(kit, kit.paper.bodyColor), 0.9));
  drawBrand(ctx, kit, frame, brand, false);
}

function paintCoverSlide(
  ctx: SKRSContext2D,
  kit: StyleKit,
  frame: Frame,
  slide: CoverSlide,
  image: Image,
  photo: PhotoInput,
  brand?: string,
  /** `column` is the title's measure as a share of the frame's width; absent keeps the kit's photo margins. */
  options: { size?: TextSize; column?: number; keywordColor?: string | null } = {},
): void {
  const drawn = drawPhoto(ctx, image, frame, photo, slide.anchor);
  /* The keyword slide of an all-photo set is a cover whose marked word is her
     keyword. In her colour, it is drawn like a highlight when the colour
     would not read on the type's own background. */
  const mine = options.keywordColor ? keywordPaint(options.keywordColor, kit.photo.boxes ? color(kit, kit.photo.boxes) : PHOTO_BEHIND) : null;
  if (mine?.kind === "block") kit = { ...kit, emphasis: "highlight" };
  const small = options.size === "small";
  /* Small type is read as a quote, a phrase to a line, so it gets air between
     lines and an even pitch rather than a title's tight stack. */
  if (small) kit = { ...kit, lineGap: Math.max(kit.lineGap, SMALL_LINE_GAP) };
  if (kit.photo.dim > 0) {
    ctx.fillStyle = `rgba(12, 10, 10, ${kit.photo.dim})`;
    ctx.fillRect(0, 0, frame.width, frame.height);
  }

  const centreX = frame.width / 2;
  const column = options.column ?? (small ? smallColumn(kit.id) : undefined);
  const maxWidth = column ? frame.width * column : frame.width - 2 * kit.margins.photoSide;
  const titleMax = coverTitleMax(kit, frame, small ? "small" : "large");
  /* Some looks put the accent line last, as the payoff under the sentence,
     the way a creator captions a selfie: headline, sentence, "here is what
     happened". Then the title is laid out without it and it gets its own block. */
  const payoffLast = kit.photo.accentAfterSub && Boolean(slide.title.accent);
  const layout = layoutTitle(kit, payoffLast ? { lines: slide.title.lines } : slide.title, {
    maxWidth,
    maxHeight: frame.height * 0.42,
    maxSize: Math.round(titleMax),
    evenLines: small,
  });
  const sub = slide.sub
    ? layoutParagraph(kit, slide.sub, { size: coverSubSize(kit, small ? "small" : "large"), maxWidth: small ? maxWidth : frame.width * 0.82, maxLines: small ? 6 : 4, lineHeight: 1.28 })
    : null;
  // The payoff never outgrows the title: title, then sentence, then payoff, in that order of size.
  const payoff = payoffLast
    ? layoutTitle(kit, { lines: [], accent: slide.title.accent }, { maxWidth, maxHeight: frame.height * 0.2, maxSize: Math.max(ABSOLUTE_MIN_TITLE, layout.size * 0.9) })
    : null;
  // A highlighted last line already carries a block of colour: it needs more air, and so do boxes.
  const subGap = layout.size * (kit.emphasis === "highlight" ? 0.5 : kit.photo.boxes ? 0.62 : 0.36);
  const payoffGap = payoff ? layout.size * (kit.photo.boxes ? 0.6 : 0.5) : 0;
  const blockHeight = layout.height + (sub ? subGap + sub.height : 0) + (payoff ? payoffGap + payoff.height : 0);

  const safeTop = kit.margins.top;
  const safeBottom = tall(frame)
    ? frame.height * 0.82 // clear of the handle, which sits higher on a story
    : frame.height - kit.margins.bottom - (brand ? kit.brandSize * 2.4 : 0);
  const band = placeBand(blockHeight, drawn.face, { top: safeTop, bottom: safeBottom, preferredCentre: frame.height * (tall(frame) ? 0.58 : 0.63) }, frame.height * 0.06);

  if (kit.photo.scrim > 0) {
    // A gradient behind the band, running to the nearer edge, so the title holds
    // up over a bright photo without flattening the whole picture.
    const toBottom = band.top + blockHeight / 2 > frame.height / 2;
    const start = toBottom ? Math.max(0, band.top - frame.height * 0.22) : Math.min(frame.height, band.top + blockHeight + frame.height * 0.22);
    const end = toBottom ? frame.height : 0;
    const gradient = ctx.createLinearGradient(0, start, 0, end);
    gradient.addColorStop(0, "rgba(10, 8, 8, 0)");
    gradient.addColorStop(0.55, `rgba(10, 8, 8, ${(kit.photo.scrim * 0.7).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(10, 8, 8, ${kit.photo.scrim.toFixed(3)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, Math.min(start, end), frame.width, Math.abs(end - start));
  }

  const subTop = band.top + layout.height + subGap;
  const payoffTop = subTop + (sub ? sub.height : -subGap) + payoffGap;
  const colors = mineColors(titleColors(kit, true), kit, mine);
  if (kit.photo.boxes) {
    /* Each line in its own white box: the box carries the type, so the photo
       is left as it is. */
    const fill = color(kit, kit.photo.boxes);
    drawLineBoxes(ctx, kit, layout, centreX, band.top, fill);
    if (sub) drawParagraphBoxes(ctx, kit, sub, centreX, subTop, fill);
    if (payoff) drawLineBoxes(ctx, kit, payoff, centreX, payoffTop, fill);
    drawTitle(ctx, kit, layout, centreX, band.top, colors);
    if (payoff) drawTitle(ctx, kit, payoff, centreX, payoffTop, colors);
  } else {
    drawTitle(ctx, kit, layout, centreX, band.top, colors);
    if (payoff) drawTitle(ctx, kit, payoff, centreX, payoffTop, colors);
  }

  if (sub) {
    drawParagraph(ctx, kit, sub, centreX, subTop, alpha(color(kit, kit.photo.subColor), kit.photo.boxes ? 1 : 0.9));
  }
  drawBrand(ctx, kit, frame, brand, true);
}

/** The title colours with her keyword colour on the marked word. */
function mineColors(colors: TitleColors, kit: StyleKit, mine: ReturnType<typeof keywordPaint> | null): TitleColors {
  if (!mine) return colors;
  if (mine.kind === "block") return { ...colors, emphasis: mine.ink, decoration: mine.fill };
  // A highlight kit already draws a block behind the word: the block takes her colour, the word whatever reads on it.
  if (kit.emphasis === "highlight") return { ...colors, emphasis: inkOn(mine.color), decoration: mine.color };
  return { ...colors, emphasis: mine.color, decoration: mine.color };
}

/** The serif box look is square-cornered, like the reel's; every other boxed look is rounded. */
function squareBoxes(kit: StyleKit): boolean {
  return kit.id === "serif_boxed";
}

/** A box behind every line of a title, sized to the line. */
function drawLineBoxes(ctx: SKRSContext2D, kit: StyleKit, layout: TitleLayout, centreX: number, top: number, fill: string): void {
  ctx.fillStyle = fill;
  for (const line of layout.lines) {
    const padX = line.size * 0.34;
    const padY = line.size * 0.2;
    ctx.beginPath();
    ctx.roundRect(centreX - line.width / 2 - padX, top + line.top - padY, line.width + padX * 2, line.height + padY * 2, squareBoxes(kit) ? 0 : line.size * 0.22);
    ctx.fill();
  }
}

/** The same for a wrapped sentence: one box per line, merging where lines touch. */
function drawParagraphBoxes(ctx: SKRSContext2D, kit: StyleKit, para: Paragraph, centreX: number, top: number, fill: string): void {
  applyFont(ctx, kit.fonts.body, para.size);
  ctx.fillStyle = fill;
  const padX = para.size * 0.4;
  const padY = para.size * 0.12;
  ctx.beginPath();
  para.lines.forEach((line, index) => {
    const width = ctx.measureText(line).width - trailing(kit.fonts.body, para.size);
    const lineTop = top + index * para.lineHeight;
    ctx.roundRect(centreX - width / 2 - padX, lineTop - padY, width + padX * 2, para.lineHeight + padY, squareBoxes(kit) ? 0 : para.size * 0.3);
  });
  ctx.fill();
}

function paintKeywordSlide(
  ctx: SKRSContext2D,
  kit: StyleKit,
  frame: Frame,
  slide: KeywordSlide,
  image: Image | null,
  photo: PhotoInput | null,
  brand?: string,
  language?: string,
  keywordColor?: string | null,
): void {
  const onPhoto = Boolean(image && photo);
  if (image && photo) {
    drawPhoto(ctx, image, frame, photo, slide.photo ? undefined : 0.2);
    ctx.fillStyle = `rgba(12, 10, 10, ${Math.max(0.5, kit.photo.dim + 0.2)})`;
    ctx.fillRect(0, 0, frame.width, frame.height);
  } else {
    ctx.fillStyle = color(kit, kit.keyword.background);
    ctx.fillRect(0, 0, frame.width, frame.height);
    addGrain(ctx, frame, kit.paper.grain);
  }

  const centreX = frame.width / 2;
  // A generic ask (save, share, follow) is its own word: there is nothing to comment.
  const english = isEnglish(language);
  const locale = localeFor(language);
  const label = slide.action ? "" : english ? "COMMENT" : LANGUAGES[normaliseLanguage(language)].comment.toLocaleUpperCase(locale);
  // The big word: her keyword as it is, or the generic ask's verb in her language.
  const word = slide.action && !english ? (genericAsk(slide.action, language).split(" ")[0] ?? slide.keyword).toLocaleUpperCase(locale) : slide.keyword;
  /* Her colour, when she picked one and the word is her keyword: the block
     takes it, or, in a kit without a block, the word does, on a block of its
     own when it would not read on the slide. */
  const mine = keywordColor && !slide.action ? keywordColor : null;
  const paint = mine ? keywordPaint(mine, onPhoto ? PHOTO_BEHIND : color(kit, kit.keyword.background)) : null;
  const block = kit.keyword.block || paint?.kind === "block";
  const labelSize = label ? 26 : 0;
  const wordLayout = layoutTitle(
    kit,
    { lines: [word] },
    {
      maxWidth: block ? frame.width - 2 * kit.margins.side - 96 : frame.width - 160,
      maxHeight: frame.height * 0.3,
      maxSize: 240,
    },
  );
  const promise = layoutParagraph(kit, slide.promise, {
    size: kit.keyword.promiseSize + 4,
    maxWidth: frame.width * 0.7,
    maxLines: 3,
    lineHeight: 1.42,
  });

  const labelGap = !label ? 0 : block ? 52 : 100;
  const promiseGap = block ? 74 : 104;
  const blockPad = block ? wordLayout.size * 0.3 : 0;
  const total = labelSize + labelGap + wordLayout.height + blockPad * 2 + promiseGap + promise.height;
  let y = frame.height * (tall(frame) ? 0.42 : 0.46) - total / 2;

  if (label) {
    applyFont(ctx, kit.fonts.body, labelSize);
    ctx.letterSpacing = `${labelSize * 0.28}px`;
    const labelWidth = ctx.measureText(label).width - labelSize * 0.28;
    ctx.fillStyle = onPhoto ? alpha(color(kit, "contrast"), 0.8) : alpha(color(kit, kit.keyword.labelColor), 0.95);
    ctx.textBaseline = "alphabetic";
    ctx.fillText(label, centreX - labelWidth / 2, y + labelSize);
    y += labelSize + labelGap;
  }

  const blockFill = mine ?? color(kit, "accent");
  if (block) {
    const width = wordLayout.width + blockPad * 2.2;
    const height = wordLayout.height + blockPad * 2;
    ctx.fillStyle = blockFill;
    ctx.beginPath();
    ctx.roundRect(centreX - width / 2, y, width, height, height * 0.16);
    ctx.fill();
    y += blockPad;
  }
  const wordColor = !mine ? color(kit, kit.keyword.color) : block ? inkOn(blockFill) : mine;
  if (!block) {
    // Two hairlines hold the word in place where a block would.
    const ruleWidth = wordLayout.width + 120;
    ctx.fillStyle = alpha(wordColor, 0.4);
    ctx.fillRect(centreX - ruleWidth / 2, y - 52, ruleWidth, 2);
    ctx.fillRect(centreX - ruleWidth / 2, y + wordLayout.height + 50, ruleWidth, 2);
  }
  drawTitle(ctx, kit, wordLayout, centreX, y, { title: wordColor, accent: wordColor, emphasis: wordColor, decoration: wordColor });
  y += wordLayout.height + blockPad + promiseGap;

  drawParagraph(
    ctx,
    kit,
    promise,
    centreX,
    y,
    onPhoto ? alpha(color(kit, "contrast"), 0.92) : alpha(color(kit, kit.keyword.promiseColor), 0.9),
  );
  drawBrand(ctx, kit, frame, brand, onPhoto);
}

/** In an all-photo set the ask is one more caption on one more photo, in the
    same boxes as the rest, rather than a poster that breaks the run. */
export function keywordAsCover(slide: KeywordSlide, photo: string, language?: string): CoverSlide {
  const [verb, ...rest] = askText(slide, language).split(" ");
  const comment = isEnglish(language) ? "Comment" : LANGUAGES[normaliseLanguage(language)].comment;
  const title = slide.action ? [`*${verb}* ${rest.join(" ")}`.trim()] : [`${comment} *${slide.keyword}*`];
  return { type: "cover", photo, title: { lines: title }, sub: slide.promise };
}


/* --- photo lines: split, line and grid slides ---------------------------- */

/** Small plain type over a photo, the way a creator captions her own picture:
    the kit's reading face, made heavy enough to hold over any photo. */
function captionFont(kit: StyleKit): FontSpec {
  return { ...kit.fonts.body, weight: Math.max(kit.fonts.body.weight, 620) };
}

type Caption = { lines: string[]; size: number; lineHeight: number; ascent: number; height: number; font: FontSpec };

function layoutCaption(kit: StyleKit, text: string, size: number, maxWidth: number, maxLines: number): Caption {
  registerKitFonts(kit);
  const font = captionFont(kit);
  const ctx = measurer();
  let current = size;
  let lines: string[] = [];
  while (current > 22) {
    applyFont(ctx, font, current);
    lines = balancedWrap(ctx, text, maxWidth);
    if (lines.length <= maxLines && fitsWidth(ctx, lines, maxWidth)) break;
    current -= 2;
  }
  applyFont(ctx, font, current);
  const ascent = ctx.measureText("Hxp").actualBoundingBoxAscent;
  const lineHeight = current * 1.22;
  return { lines, size: current, lineHeight, ascent, height: (lines.length - 1) * lineHeight + ascent + current * 0.24, font };
}

/** A caption drawn straight on the photo, or in the kit's
    boxes when the look has them, so these slides match its covers. */
/** Her keyword and colour, for a caption that may carry the keyword. */
type CaptionKeyword = { word: string; color: string };

function drawCaption(ctx: SKRSContext2D, kit: StyleKit, caption: Caption, centreX: number, top: number, keyword?: CaptionKeyword): void {
  applyFont(ctx, caption.font, caption.size);
  ctx.textBaseline = "alphabetic";
  const widths = caption.lines.map((line) => ctx.measureText(line).width - trailing(caption.font, caption.size));
  /* Drawn run by run from the line's left edge, her keyword in her colour
     (on a block of it where the colour would not read), the rest as before. */
  const fill = (line: string, x: number, y: number, ink: string, behind: string | null) => {
    const runs = keyword ? keywordRuns(line, [keyword.word]) : [];
    if (!keyword || !runs.some((run) => run.keyword)) {
      ctx.fillStyle = ink;
      ctx.fillText(line, x, y);
      return;
    }
    // With no box and no scrim the photo itself is behind the word, light or dark: only a block of her colour reads on any photo.
    const paint = behind ? keywordPaint(keyword.color, behind) : ({ kind: "block", fill: keyword.color, ink: inkOn(keyword.color) } as const);
    let at = x;
    for (const run of runs) {
      const width = ctx.measureText(run.text).width;
      if (run.keyword && paint.kind === "block") {
        ctx.save();
        const padX = caption.size * 0.16;
        ctx.fillStyle = paint.fill;
        ctx.beginPath();
        ctx.roundRect(at - padX, y - caption.ascent - caption.size * 0.14, width + padX * 2, caption.size * 1.28, caption.size * 0.2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = !run.keyword ? ink : paint.kind === "block" ? paint.ink : paint.color;
      ctx.fillText(run.text, at, y);
      at += width;
    }
  };
  if (kit.photo.boxes) {
    const padX = caption.size * 0.4;
    const padY = caption.size * 0.14;
    const boxFill = color(kit, kit.photo.boxes);
    ctx.fillStyle = boxFill;
    ctx.beginPath();
    caption.lines.forEach((_, index) => {
      ctx.roundRect(centreX - widths[index] / 2 - padX, top + index * caption.lineHeight - padY, widths[index] + padX * 2, caption.lineHeight + padY, caption.size * 0.3);
    });
    ctx.fill();
    caption.lines.forEach((line, index) => fill(line, centreX - widths[index] / 2, top + caption.ascent + index * caption.lineHeight, color(kit, "ink"), boxFill));
    return;
  }
  caption.lines.forEach((line, index) => fill(line, centreX - widths[index] / 2, top + caption.ascent + index * caption.lineHeight, color(kit, "contrast"), null));
}

/** The caption size for a frame: small, as these posts are, but never so small it cannot be read on a phone. */
function captionSize(frame: Frame): number {
  return Math.round(frame.width * 0.041);
}

function paintSplitSlide(ctx: SKRSContext2D, kit: StyleKit, frame: Frame, slide: SplitSlide, images: [Image, Image], photos: [PhotoInput, PhotoInput]): void {
  const half = frame.height / 2;
  const centreX = frame.width / 2;
  const maxWidth = frame.width - 2 * kit.margins.photoSide;
  [0, 1].forEach((index) => {
    const cell = { x: 0, y: index * half, width: frame.width, height: half };
    const drawn = drawPhotoInCell(ctx, images[index], cell, photos[index]);
    const caption = layoutCaption(kit, slide.lines[index], captionSize(frame), maxWidth, 2);
    // Each line sits in the middle of its own half, stepping off the face if it would cover it.
    const band = placeBand(caption.height, drawn.face, { top: cell.y + half * 0.12, bottom: cell.y + half * 0.9, preferredCentre: cell.y + half * 0.55 }, half * 0.04);
    drawCaption(ctx, kit, caption, centreX, band.top);
  });
}

/** One photo with a line of type across it. The keyword slide of a split or
    grid set uses the same slide: the ask, then the promise. */
function paintLineSlide(ctx: SKRSContext2D, kit: StyleKit, frame: Frame, texts: string[], image: Image, photo: PhotoInput, brand?: string, keyword?: CaptionKeyword): void {
  const drawn = drawPhoto(ctx, image, frame, photo, undefined);
  const centreX = frame.width / 2;
  const maxWidth = frame.width - 2 * kit.margins.photoSide;
  const captions = texts.map((text, index) => layoutCaption(kit, text, captionSize(frame) * (index === 0 && texts.length > 1 ? 1.25 : 1), maxWidth, 3));
  const gap = captionSize(frame) * 0.7;
  const height = captions.reduce((total, caption) => total + caption.height, 0) + gap * (captions.length - 1);
  const safeBottom = tall(frame) ? frame.height * 0.82 : frame.height - kit.margins.bottom - (brand ? kit.brandSize * 2.4 : 0);
  const band = placeBand(height, drawn.face, { top: kit.margins.top, bottom: safeBottom, preferredCentre: frame.height * 0.52 }, frame.height * 0.05);
  let top = band.top;
  for (const caption of captions) {
    drawCaption(ctx, kit, caption, centreX, top, keyword);
    top += caption.height + gap;
  }
  drawBrand(ctx, kit, frame, brand, true);
}

/* Four-photo cover type as a share of the frame's width: the headline at the
   size a creator's own cover sets it, the line under it about three fifths of that. */
const GRID_HEADLINE_SIZE = 0.085;
const GRID_SUB_SIZE = 0.052;

function paintGridSlide(ctx: SKRSContext2D, kit: StyleKit, frame: Frame, slide: GridSlide, images: Image[], photos: PhotoInput[], brand?: string): void {
  const cellWidth = frame.width / 2;
  const cellHeight = frame.height / 2;
  images.forEach((image, index) => {
    drawPhotoInCell(ctx, image, { x: (index % 2) * cellWidth, y: Math.floor(index / 2) * cellHeight, width: cellWidth, height: cellHeight }, photos[index]);
  });

  /* The title sits on the cross where the four photos meet: the headline in the
     kit's accent face and the plain line under it in its title face, each at
     one set size, wrapping rather than shrinking. A word she marks in the line
     under it is set in a serif italic. */
  const centreX = frame.width / 2;
  const maxWidth = frame.width - 2 * kit.margins.photoSide;
  const headlineKit: StyleKit = { ...kit, fonts: { ...kit.fonts, title: kit.fonts.accent } };
  const headline = layoutWrapped(headlineKit, slide.headline, { size: Math.round(frame.width * GRID_HEADLINE_SIZE), maxWidth, maxLines: 3, asTyped: true });
  const subKit: StyleKit = { ...kit, fonts: { ...kit.fonts, emphasis: serifWordFont(kit) }, emphasis: "italic", emphasisKeepsCase: true, emphasisScale: 1.3 };
  const sub = slide.sub ? layoutWrapped(subKit, slide.sub, { size: Math.round(frame.width * GRID_SUB_SIZE), maxWidth, maxLines: 2 }) : null;
  const gap = sub ? headline.size * 0.2 : 0;
  const blockHeight = headline.height + (sub ? gap + sub.height : 0);
  const top = frame.height / 2 - blockHeight / 2;

  // A soft darkening across the middle band, so the title holds over four different photos.
  const glow = ctx.createLinearGradient(0, top - frame.height * 0.14, 0, top + blockHeight + frame.height * 0.14);
  glow.addColorStop(0, "rgba(10, 8, 8, 0)");
  glow.addColorStop(0.5, "rgba(10, 8, 8, 0.34)");
  glow.addColorStop(1, "rgba(10, 8, 8, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, top - frame.height * 0.14, frame.width, blockHeight + frame.height * 0.28);

  const white = color(kit, "contrast");
  const colors = { title: white, accent: white, emphasis: white, decoration: white };
  drawTitle(ctx, headlineKit, headline, centreX, top, colors);
  if (sub) drawTitle(ctx, subKit, sub, centreX, top + headline.height + gap, colors);
  drawBrand(ctx, kit, frame, brand, true);
}

/** The ask at the end of a split or grid set, in the same small type as the rest. */
export function keywordLines(slide: KeywordSlide, language?: string): string[] {
  return [askText(slide, language), slide.promise];
}

/* --- the public surface -------------------------------------------------- */

function photoFor(photos: Photos, ref: string): PhotoInput {
  const photo = photos[ref];
  if (!photo) throw new Error(`No photo supplied for reference "${ref}"`);
  return photo;
}

async function renderSlide(
  spec: CarouselSpec,
  kit: StyleKit,
  frame: Frame,
  slide: Slide,
  index: number,
  paperOrdinal: number,
  photos: Photos,
  size?: TextSize,
  keywordColor?: string,
): Promise<Buffer> {
  const canvas = createCanvas(frame.width, frame.height);
  const ctx = canvas.getContext("2d");
  registerKitFonts(kit);
  switch (slide.type) {
    case "cover": {
      const photo = photoFor(photos, slide.photo);
      paintCoverSlide(ctx, kit, frame, slide, await loadImage(photo.data), photo, spec.brand, { size });
      break;
    }
    case "paper":
      paintPaperSlide(ctx, kit, frame, slide, index, paperOrdinal, spec.brand);
      break;
    case "split": {
      const inputs = [photoFor(photos, slide.photos[0]), photoFor(photos, slide.photos[1])] as [PhotoInput, PhotoInput];
      const images = [await loadImage(inputs[0].data), await loadImage(inputs[1].data)] as [Image, Image];
      paintSplitSlide(ctx, kit, frame, slide, images, inputs);
      break;
    }
    case "line": {
      const photo = photoFor(photos, slide.photo);
      paintLineSlide(ctx, kit, frame, [slide.text], await loadImage(photo.data), photo, spec.brand);
      break;
    }
    case "grid": {
      const inputs = slide.photos.map((ref) => photoFor(photos, ref));
      const images = await Promise.all(inputs.map((input) => loadImage(input.data)));
      paintGridSlide(ctx, kit, frame, slide, images, inputs, spec.brand);
      break;
    }
    case "keyword": {
      const photo = slide.photo ? photoFor(photos, slide.photo) : null;
      // A generic ask (save, share, follow) is not her keyword: it keeps the kit's colours.
      const mine = keywordColor && !slide.action ? keywordColor : null;
      if ((spec.layout === "split" || spec.layout === "grid") && photo) {
        paintLineSlide(ctx, kit, frame, keywordLines(slide, spec.language), await loadImage(photo.data), photo, spec.brand, mine ? { word: slide.keyword, color: mine } : undefined);
        break;
      }
      if (spec.layout === "photos" && slide.photo && photo) {
        paintCoverSlide(ctx, kit, frame, keywordAsCover(slide, slide.photo, spec.language), await loadImage(photo.data), photo, spec.brand, { size, keywordColor: mine });
        break;
      }
      paintKeywordSlide(ctx, kit, frame, slide, photo ? await loadImage(photo.data) : null, photo, spec.brand, spec.language, mine);
      break;
    }
  }
  return canvas.toBuffer("image/png");
}

function contactSheet(pngs: Buffer[], frame: Frame, images: Image[]): Buffer {
  const columns = Math.min(5, Math.max(1, images.length));
  const rows = Math.ceil(images.length / columns);
  const thumbWidth = 300;
  const thumbHeight = Math.round((thumbWidth * frame.height) / frame.width);
  const gutter = 14;
  const canvas = createCanvas(columns * thumbWidth + (columns + 1) * gutter, rows * thumbHeight + (rows + 1) * gutter);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#E9E7E3";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  images.forEach((image, index) => {
    const x = gutter + (index % columns) * (thumbWidth + gutter);
    const y = gutter + Math.floor(index / columns) * (thumbHeight + gutter);
    ctx.drawImage(image, x, y, thumbWidth, thumbHeight);
  });
  void pngs;
  return canvas.toBuffer("image/jpeg", 86);
}

/** How many paper slides come before this one: the tone alternates on those. */
function paperOrdinalAt(spec: CarouselSpec, index: number): number {
  return spec.slides.slice(0, index).filter((slide) => slide.type === "paper").length;
}

/**
 * One slide of a set, on its own.
 *
 * Editing the words on slide four should not redraw the other seven, and the
 * result has to be byte-identical to what `renderSpec` would have drawn for
 * that slide — which is why the alternating paper tone is derived from the
 * spec here rather than counted as the loop goes.
 */
export async function renderSlideAt(spec: CarouselSpec, kit: StyleKit, photos: Photos, index: number, look: TextLook = {}): Promise<Buffer> {
  const drawn = withLook(spec, kit, look);
  const slide = drawn.spec.slides[index];
  if (!slide) throw new Error(`This set has no slide ${index + 1}`);
  return renderSlide(drawn.spec, drawn.kit, FORMATS[spec.format], slide, index, paperOrdinalAt(spec, index), photos, look.size, keywordColorFrom(look));
}

/** The words on the sample tile. Kit-neutral: it has to read in all four. */
const SAMPLE: PaperSlide = {
  type: "paper",
  title: { lines: ["Your best idea", "deserves a *slide*"], accent: "not a caption." },
  body: "One plain sentence sits under the title, in this kit's reading face.",
};

/**
 * A real slide of this kit, drawn small, for the picker. It is rendered rather
 * than mocked up in CSS because the point of the tile is to show what the
 * renderer will actually do with a title: the face, the way a word is set
 * apart, the accent line, the paper and its grain.
 */
export async function renderSampleTile(kit: StyleKit, width = 420): Promise<Buffer> {
  const frame = FORMATS.carousel;
  const full = createCanvas(frame.width, frame.height);
  registerKitFonts(kit);
  paintPaperSlide(full.getContext("2d"), kit, frame, SAMPLE, 0, 0);

  const height = Math.round((width * frame.height) / frame.width);
  const tile = createCanvas(width, height);
  tile.getContext("2d").drawImage(full, 0, 0, width, height);
  return tile.toBuffer("image/png");
}

/**
 * Her words on one of her photos, drawn exactly as a carousel cover in the
 * same look: the same photo treatment, type, boxes and face-aware band. The
 * frame is laid out at the kit's 1080-wide scale and drawn `scale` times
 * larger, so the photo keeps its resolution and the type keeps its proportion.
 * The lines are drawn as given: her case, no emphasis markup.
 */
export async function renderTextOnPhoto(input: {
  kit: StyleKit;
  photo: PhotoInput;
  lines: string[];
  frame: { width: number; height: number; scale: number };
  /** Small: half the size in a 62% column (pastel: 30% bigger, in a 72% column). Large: the kit's size in an 80% column. */
  size?: TextSize;
}): Promise<Buffer> {
  const { kit, photo, lines, frame } = input;
  const size = input.size ?? "large";
  const canvas = createCanvas(Math.round(frame.width * frame.scale), Math.round(frame.height * frame.scale));
  const ctx = canvas.getContext("2d");
  ctx.scale(frame.scale, frame.scale);
  registerKitFonts(kit);
  const slide: CoverSlide = { type: "cover", photo: "photo", title: { lines, asTyped: true, literal: true } };
  paintCoverSlide(ctx, kit, { width: frame.width, height: frame.height }, slide, await loadImage(photo.data), photo, undefined, {
    size,
    column: size === "small" ? smallColumn(kit.id) : TEXT_PHOTO_LARGE_COLUMN,
  });
  return canvas.toBuffer("image/png");
}

/** Spec + kit + photos in, PNG buffers and a contact sheet out. No file system. */
export async function renderSpec(original: CarouselSpec, baseKit: StyleKit, photos: Photos, look: TextLook = {}): Promise<RenderResult> {
  const { spec, kit } = withLook(original, baseKit, look);
  const frame = FORMATS[spec.format];
  const slides: RenderedSlide[] = [];
  const images: Image[] = [];
  let paperOrdinal = 0;
  for (const [index, slide] of spec.slides.entries()) {
    const png = await renderSlide(spec, kit, frame, slide, index, paperOrdinal, photos, look.size, keywordColorFrom(look));
    if (slide.type === "paper") paperOrdinal += 1;
    slides.push({ file: `${String(index + 1).padStart(2, "0")}.png`, png });
    images.push(await loadImage(png));
  }
  return { slides, sheet: contactSheet(slides.map((slide) => slide.png), frame, images) };
}

import { InvalidRequestError } from "../lib/errors";

/* What a creator chooses when she animates a photo: which video model, and what
   shape the clip comes out.

   Pure, and deliberately free of anything that talks to a provider, so the
   drawer, the server action, the job input and the Higgsfield client can all
   read the same list and the rules can be tested without a network.

   Gemini Omni is the one video model: it makes her voice and moves her lips.

   The model ids are the ones `src/billing/pricing.ts` prices, so a name here
   and a price there cannot drift apart. */

export type ClipModel = "omni";

export interface ClipModelOption {
  id: ClipModel;
  /** The model as the provider names it, for the "animating with…" message. */
  name: string;
  /** What the drawer calls it: the kind of movement, not the vendor. */
  title: string;
  /** One honest line about what it is better at, naming the model. No adjectives doing no work. */
  blurb: string;
}

export const CLIP_MODELS: readonly ClipModelOption[] = [
  {
    id: "omni",
    name: "Gemini Omni Flash",
    title: "Talking",
    blurb: "Gemini Omni Flash, 720p. Makes her voice and moves her lips to it. Up to 10 seconds, 9:16 or 16:9 only.",
  },
];

export const DEFAULT_CLIP_MODEL: ClipModel = "omni";

export type ClipAspectRatio = "9:16" | "3:4" | "1:1" | "16:9";

export interface ClipRatioOption {
  id: ClipAspectRatio;
  width: number;
  height: number;
  /** Where a clip of this shape is posted. */
  note: string;
}

export const CLIP_RATIOS: readonly ClipRatioOption[] = [
  { id: "9:16", width: 9, height: 16, note: "Reels and stories" },
  { id: "3:4", width: 3, height: 4, note: "Feed video" },
  { id: "1:1", width: 1, height: 1, note: "Square feed" },
  { id: "16:9", width: 16, height: 9, note: "Landscape" },
];

/* Omni takes an aspect ratio and knows only these two. */
const MODEL_RATIOS: Partial<Record<ClipModel, readonly ClipAspectRatio[]>> = {
  omni: ["9:16", "16:9"],
};

/** The shapes this model can make. */
export function ratiosFor(model: ClipModel): readonly ClipAspectRatio[] {
  return MODEL_RATIOS[model] ?? CLIP_RATIOS.map((ratio) => ratio.id);
}

/** Refused before anything is charged: a shape the model cannot make would be paid for and then fail. */
export function requireRatioForModel(model: ClipModel, ratio: ClipAspectRatio): void {
  if (ratiosFor(model).includes(ratio)) return;
  const name = CLIP_MODELS.find((option) => option.id === model)?.name ?? "This model";
  throw new InvalidRequestError(`${name} makes ${ratiosFor(model).join(" or ")} clips only. Pick one of those shapes.`);
}

/** Reels are what this product makes, so a reel's shape is the one that is already chosen. */
export const DEFAULT_CLIP_RATIO: ClipAspectRatio = "9:16";

/** The composer offers only the two shapes a reel is posted at; the drawer keeps all four. */
export const CLIP_ASPECTS_COMPOSER: readonly ClipAspectRatio[] = ["9:16", "16:9"];

export function isClipModel(value: unknown): value is ClipModel {
  return CLIP_MODELS.some((model) => model.id === value);
}

export function isClipAspectRatio(value: unknown): value is ClipAspectRatio {
  return CLIP_RATIOS.some((ratio) => ratio.id === value);
}

/* Both of these are reached from a server action, which is a public endpoint:
   whatever arrives is a string somebody sent us, not a value React chose. An
   unknown one is refused by name rather than quietly replaced by the default,
   because silently animating something other than what was asked for is how a
   person pays for a clip they did not order. */

export function requireClipModel(value: unknown): ClipModel {
  if (value === undefined || value === null || value === "") return DEFAULT_CLIP_MODEL;
  if (!isClipModel(value)) throw new InvalidRequestError("Pick one of the video models on offer.");
  return value;
}

/* Every model the job layer can make and pricing.ts prices. */
export const MADE_CLIP_MODELS: readonly ClipModel[] = ["omni"];

export function requireMadeClipModel(value: unknown): ClipModel {
  if (value === undefined || value === null || value === "") return DEFAULT_CLIP_MODEL;
  if (!MADE_CLIP_MODELS.includes(value as ClipModel)) throw new InvalidRequestError("Pick one of the video models on offer.");
  return value as ClipModel;
}

export function requireClipAspectRatio(value: unknown): ClipAspectRatio {
  if (value === undefined || value === null || value === "") return DEFAULT_CLIP_RATIO;
  if (!isClipAspectRatio(value)) throw new InvalidRequestError("Pick one of the four clip shapes.");
  return value;
}

/** Width over height, as a number. */
export function ratioValue(ratio: ClipAspectRatio): number {
  const option = CLIP_RATIOS.find((item) => item.id === ratio);
  if (!option) throw new InvalidRequestError("Pick one of the four clip shapes.");
  return option.width / option.height;
}

export interface Size {
  width: number;
  height: number;
}

/**
 * The largest centred rectangle of this shape that fits inside the photo.
 *
 * This is the arithmetic `cropFilter` hands to ffmpeg, written separately so it
 * can be checked without running one.
 */
export function cropSize(photo: Size, ratio: ClipAspectRatio): Size {
  const target = ratioValue(ratio);
  return {
    width: Math.min(photo.width, photo.height * target),
    height: Math.min(photo.height, photo.width / target),
  };
}

/**
 * The ffmpeg filter that takes the middle of a photo at this shape.
 *
 * Expressed in the source's own dimensions (`iw`, `ih`) rather than in pixels,
 * so nothing has to decode the photo first, and as a fraction rather than a
 * decimal so 9:16 is exactly 9:16. ffmpeg centres a crop unless told otherwise.
 */
export function cropFilter(ratio: ClipAspectRatio): string {
  const option = CLIP_RATIOS.find((item) => item.id === ratio);
  if (!option) throw new InvalidRequestError("Pick one of the four clip shapes.");
  const { width, height } = option;
  return `crop='min(iw,ih*${width}/${height})':'min(ih,iw*${height}/${width})'`;
}

/** Shapes within this much of each other are the same shape to a viewer. */
const SAME_SHAPE = 0.02;

/**
 * What will happen to this photo at this shape, in one sentence.
 *
 * The clip is framed from the still it is given, so the ratio is applied to
 * the copy we send, as a centre crop. Nothing is letterboxed and nothing is stretched,
 * which means picking a shape can throw away part of a photo — and that is
 * worth saying before the button is pressed rather than after.
 *
 * `photo` is null for a photo whose dimensions we never recorded, which is true
 * of everything generated before this existed; the rule is stated without the
 * numbers rather than guessed at.
 */
export function framingNote(photo: Size | null, ratio: ClipAspectRatio): string {
  const always = "The middle is kept; nothing is letterboxed or stretched.";
  if (!photo || photo.width <= 0 || photo.height <= 0) {
    return `Your photo is cropped to fill ${ratio}. ${always}`;
  }

  const target = ratioValue(ratio);
  const source = photo.width / photo.height;
  if (Math.abs(source - target) / target < SAME_SHAPE) {
    return `This photo is already ${ratio}, so nothing is trimmed.`;
  }

  const wider = source > target;
  const trimmed = Math.round((1 - (wider ? target / source : source / target)) * 100);
  const edges = wider ? "the left and right" : "the top and bottom";
  return `This photo is ${wider ? "wider" : "taller"} than ${ratio}: about ${trimmed}% is trimmed off ${edges}. ${always}`;
}

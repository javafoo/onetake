import { creditsWord } from "@/billing/gate";
import { creditsFor } from "@/billing/pricing";
import { CLIP_MODELS, DEFAULT_CLIP_MODEL, type ClipAspectRatio, type ClipModel } from "@/content/clip-options";
import { DEFAULT_IMAGE_ASPECT, DEFAULT_IMAGE_MODEL, IMAGE_MODELS, isImageAspect, isImageModel, type ImageAspect, type ImageModel } from "@/content/image-options";
import { DEFAULT_TEXT_SIZE, DEFAULT_TEXT_STYLE, isTextSize, isTextStyle, type TextSize, type TextStyle } from "@/content/text-styles";
import { LAYOUT_LABEL } from "@/carousel/skeletons";
import type { Layout } from "@/carousel/spec";
import type { ShotType } from "@/style/shot-types";

import { agentCredits } from "./plan";

/* The composer's decisions, as plain functions.
 *
 * The box at the bottom of /create has one toggle (Agent on or off), a model
 * panel (Image, Video or Slides, with a model and a shape), a text style and
 * library items attached with + (photos and at most one clip). With the agent off, those together decide
 * which of the manual flows a message starts, and every one of those flows is
 * an existing job. Nothing here touches a network; the chat and the tests
 * both read the same answers. */

export type ComposerTab = "image" | "video" | "slides";
export type SlidesFormat = "carousel" | "story";
export type AttachedKind = "photo" | "clip";

/**
 * The library items on the message, picked or uploaded through +: material to
 * use as it is. Up to ten photos, in the order she added them, and one clip.
 * Screenshots pasted into the box are not here: they are only read, never used.
 */
export type Attached = { photos: string[]; clip: string | null };

export const NOTHING_ATTACHED: Attached = { photos: [], clip: null };
export const MAX_ATTACHED_PHOTOS = 10;
/** The most attached photos one new photo is drawn from. */
export const MAX_PHOTO_SOURCES = 3;

export type ComposerChoice = {
  tab: ComposerTab;
  imageModel: ImageModel;
  imageAspect: ImageAspect;
  clipModel: ClipModel;
  clipAspect: ClipAspectRatio;
  format: SlidesFormat;
  /** Where the words and photos go on the slides: photos and text, all photos, half and half, or a four-photo cover. */
  layout: Layout;
  textStyle: TextStyle;
  /** Large or small words, and whether every word is lowercased. */
  textSize: TextSize;
  lowercase: boolean;
  /* Whether she set the size and the case in the Text picker herself. With
     the agent on, an unset one is not sent, so "small text" or "lowercase"
     in her message still counts. */
  textSizePicked: boolean;
  lowercasePicked: boolean;
  /* Whether she chose the video model and the slides format herself. With the
     agent on, an unpicked one is not sent, so the run chooses: Omni for a
     talking reel, and the format her words asked for. */
  clipModelPicked: boolean;
  formatPicked: boolean;
  /* The same for the slides layout: with the agent on and none picked, her
     words (or her screenshot) decide, so "half and half" in a message counts. */
  layoutPicked: boolean;
  /* Whether she chose the image shape herself. Words on her photo keep the
     photo's own shape unless she did. */
  imageAspectPicked: boolean;
  /** Brand on (the default) or off: off writes without her niche, offer, story and keyword. */
  brand: boolean;
  /* Whether she set the Brand chip herself. With the agent on and none set,
     her words decide, so "just for fun" in a message counts. */
  brandPicked: boolean;
};

export const DEFAULT_CHOICE: ComposerChoice = {
  tab: "image",
  imageModel: DEFAULT_IMAGE_MODEL,
  imageAspect: DEFAULT_IMAGE_ASPECT,
  clipModel: DEFAULT_CLIP_MODEL,
  clipAspect: "9:16",
  format: "carousel",
  layout: "mixed",
  textStyle: DEFAULT_TEXT_STYLE,
  textSize: DEFAULT_TEXT_SIZE,
  lowercase: false,
  textSizePicked: false,
  lowercasePicked: false,
  clipModelPicked: false,
  formatPicked: false,
  layoutPicked: false,
  imageAspectPicked: false,
  brand: true,
  brandPicked: false,
};

/** A layout read back from anywhere the browser kept it, or nothing. */
export function isLayout(value: unknown): value is Layout {
  return typeof value === "string" && Object.hasOwn(LAYOUT_LABEL, value);
}

/** What the chat sends with an agent message: every picker she set, and nothing she did not. */
export function askOptions(choice: ComposerChoice): {
  style: TextStyle;
  size?: TextSize;
  lowercase?: boolean;
  imageModel: ImageModel;
  imageAspect: ImageAspect;
  clipModel?: ClipModel;
  format?: SlidesFormat;
  layout?: Layout;
  aspectPicked?: boolean;
  slides?: boolean;
  brand?: boolean;
} {
  return {
    style: choice.textStyle,
    ...(choice.textSizePicked ? { size: choice.textSize } : {}),
    ...(choice.lowercasePicked ? { lowercase: choice.lowercase } : {}),
    imageModel: choice.imageModel,
    imageAspect: choice.imageAspect,
    ...(choice.clipModelPicked ? { clipModel: choice.clipModel } : {}),
    ...(choice.formatPicked ? { format: choice.format } : {}),
    ...(choice.layoutPicked ? { layout: choice.layout } : {}),
    ...(choice.imageAspectPicked ? { aspectPicked: true } : {}),
    ...(choice.brandPicked ? { brand: choice.brand } : {}),
    // The Slides tab chosen at send: one photo and words there are words on that photo.
    ...(choice.tab === "slides" ? { slides: true } : {}),
  };
}

/** Which manual flow a message starts, or the sentence that says what is missing. */
export type ManualMode =
  /** A new photo; with `sources`, drawn from those photos with the words as the instruction. */
  | { mode: "photo"; prompt: string; sources: string[] }
  /** A clip from the first photo; `unused` says how many other photos were attached and left out. */
  | { mode: "clip"; mediaId: string; motion: string; unused: number }
  /**
   * A reel on the clip. `pinned` when the words are a saved hook, which is not
   * held to the reel's word limit. `setAside` is what she typed when a pinned
   * hook was used instead of it, so the card can say so.
   */
  | { mode: "reel"; mediaId: string; hook: string; pinned: boolean; setAside?: string }
  /** A set. `photos` empty means picked for her; otherwise exactly these, in order. `cover` is a pinned hook. */
  | { mode: "carousel"; topic: string; format: SlidesFormat; photos: string[]; cover?: string }
  /**
   * Her words drawn on her one attached photo, free. `words` are exactly what
   * she typed, or the pinned hook; `setAside` is what she typed when a pinned
   * hook was used instead of it.
   */
  | { mode: "text_photo"; mediaId: string; words: string; pinned: boolean; setAside?: string }
  | { mode: "none"; message: string };

export type ResolveInput = {
  tab: ComposerTab;
  format?: SlidesFormat;
  attached: Attached;
  text: string;
  /** A hook pinned from the Hooks page or the + picker. It is the reel's words whatever the box says, and a set's cover. */
  hook?: string | null;
};

export const VIDEO_NEEDS_PHOTO = "Attach a photo to animate, or turn Agent on.";
export const HOOK_NEEDS_CLIP = "Attach a clip for a reel, or switch to Slides for a carousel.";
export const CLIP_NOT_A_SLIDE = "A clip can't be a slide. Switch to Image or Video to make a reel.";
export const TEXT_PHOTO_NEEDS_WORDS_MANUAL = "Type the words to put on the photo. They go on it exactly as written.";

/** The longest topic a set takes; a long pinned hook gives its first line. */
export const MAX_TOPIC_CHARS = 240;

/**
 * Words typed beside a pinned hook that only say "go": "make reel", "do it".
 * They are an instruction, not words for the screen or a topic, so they are
 * set aside without comment.
 */
export function isInstruction(text: string): boolean {
  const words = text.trim().replace(/[.!?]+$/, "").toLowerCase();
  if (!words) return true;
  if (words.split(/\s+/).length > 5) return false;
  return /^(ok(ay)?,?\s+)?(please\s+)?(go|do it|yes|ok(ay)?|send|now|(make|create|build|render|do|use|turn|put)\b.*)$/.test(words);
}

/** A one-line view of a hook written in lines, for a chip: the breaks shown as " / ". */
export function oneLineHook(hook: string): string {
  return hook.split(/\n+/).map((line) => line.trim()).filter(Boolean).join(" / ");
}

function topicFrom(text: string, hook: string): string {
  if (text) return text;
  const first = hook.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return first.slice(0, MAX_TOPIC_CHARS);
}

/**
 * With the agent off, what this message makes.
 *
 * A clip attached is a reel on the Image or Video tab, free: the pinned hook
 * if there is one, else the typed words, exactly. Photos attached are drawn
 * from on Image, animated (the first) on Video, and are the set's photos on
 * Slides (one photo there gets her words drawn on it). With nothing attached, words make a photo or a set; the Video tab
 * needs a photo. Anything else says what to attach or pick, before anything
 * is sent.
 */
export function resolveManualMode(input: ResolveInput): ManualMode {
  const hook = input.hook?.trim() || "";
  const typed = input.text.trim();
  // Beside a pinned hook, "make reel" is the send button in words, not content.
  const text = hook && isInstruction(typed) ? "" : typed;
  const { tab, attached } = input;
  const format = input.format ?? "carousel";

  if (attached.clip) {
    if (tab === "slides") return none(CLIP_NOT_A_SLIDE);
    if (hook) return { mode: "reel", mediaId: attached.clip, hook, pinned: true, ...(text ? { setAside: text } : {}) };
    if (!text) return none("Type the words to put on the clip. They go on screen exactly as written.");
    return { mode: "reel", mediaId: attached.clip, hook: text, pinned: false };
  }

  const photos = attached.photos;
  if (photos.length) {
    if (tab === "image") {
      if (!text) return none("Say what to make from the photo, like “same outfit at a café” or “extend to 16:9”.");
      return { mode: "photo", prompt: text, sources: photos.slice(0, MAX_PHOTO_SOURCES) };
    }
    if (tab === "video") {
      if (!text) return none("Say what she does in the clip, in a few words.");
      return { mode: "clip", mediaId: photos[0], motion: text, unused: photos.length - 1 };
    }
    /* One photo on Slides is words on that photo; two or more are a set of
       exactly those photos. */
    if (photos.length === 1) {
      if (hook) return { mode: "text_photo", mediaId: photos[0], words: hook, pinned: true, ...(text ? { setAside: text } : {}) };
      // Her words as typed, line breaks and case: only the ends are trimmed.
      if (!text) return none(TEXT_PHOTO_NEEDS_WORDS_MANUAL);
      return { mode: "text_photo", mediaId: photos[0], words: text, pinned: false };
    }
    const topic = topicFrom(text, hook);
    if (!topic) return none("Say what the set is about.");
    return { mode: "carousel", topic, format, photos, ...(hook ? { cover: hook } : {}) };
  }

  if (tab === "slides") {
    const topic = topicFrom(text, hook);
    if (!topic) return none("Say what you want made.");
    return { mode: "carousel", topic, format, photos: [], ...(hook ? { cover: hook } : {}) };
  }
  /* A pinned hook is words for a reel or a set. On a photo it would be read
     as the scene and paid for as one, so it is refused before anything runs. */
  if (hook) return none(HOOK_NEEDS_CLIP);
  if (tab === "video") return none(VIDEO_NEEDS_PHOTO);
  if (!text) return none("Say what you want made.");
  return { mode: "photo", prompt: text, sources: [] };
}

const none = (message: string): ManualMode => ({ mode: "none", message });

/**
 * What the model chip reads: the model and the shape, or the slides format.
 * With the agent on, a video model or a format she has not picked is not sent,
 * so the chip says "Auto" rather than name a default the run will not use.
 */
export function modelChipLabel(choice: ComposerChoice, agentOn = false, short = false): string {
  if (choice.tab === "image") return `${IMAGE_MODELS[choice.imageModel][short ? "short" : "label"]} · ${choice.imageAspect}`;
  if (choice.tab === "video") return agentOn && !choice.clipModelPicked ? "Video · Auto" : `${clipModelName(choice.clipModel)} · ${choice.clipAspect}`;
  const format = agentOn && !choice.formatPicked ? "Slides" : choice.format === "story" ? "Story" : "Carousel";
  // A layout is named on the chip only once it is not the everyday one, so the chip stays short.
  const layout = agentOn && !choice.layoutPicked ? null : choice.layout === "mixed" ? null : LAYOUT_LABEL[choice.layout].name;
  if (agentOn && !choice.formatPicked && !layout) return "Slides · Auto";
  return layout ? `${format} · ${layout}` : format;
}

export function clipModelName(model: ClipModel): string {
  return CLIP_MODELS.find((option) => option.id === model)?.name ?? "Video model";
}

/** The price of one photo, one five-second clip, in credits. From pricing.ts and nowhere else. */
export const CLIP_SECONDS = 5;
export const photoCredits = (model: ImageModel): number => creditsFor({ kind: "image", model });
export const clipCredits = (model: ClipModel): number => creditsFor({ kind: "clip", model, seconds: CLIP_SECONDS });

/**
 * The most a reel run can charge with these models chosen, from the run's own
 * estimate. With no video model picked the run picks one per reel (Omni
 * when she talks), so the ceiling is the dearer of the two. Attached footage
 * takes its part off: a clip makes the reel free, a photo leaves the clip.
 */
export function reelEstimate(choice: Pick<ComposerChoice, "imageModel" | "clipModel" | "clipModelPicked">, attached: Attached = NOTHING_ATTACHED): number {
  const clipModel = choice.clipModelPicked ? choice.clipModel : undefined;
  const material = attached.clip || attached.photos.length ? { photos: attached.photos, ...(attached.clip ? { clip: attached.clip } : {}) } : undefined;
  const reel = (talking: boolean) => agentCredits({ kind: "reel", brief: "", footage: "auto", cue: "auto", talking, model: choice.imageModel, clipModel, material });
  return clipModel ? reel(false) : Math.max(reel(false), reel(true));
}

/**
 * The line under the model panel: what pressing send costs.
 *
 * With the agent on it may reuse a clip or make several photos, so the line
 * gives the reel's ceiling rather than a price. With the agent off the price
 * is exact, because the mode is known before the button is pressed.
 */
export function creditsLine(choice: ComposerChoice, agentOn: boolean, attached: Attached = NOTHING_ATTACHED, hook: string | null = null): string {
  if (agentOn) {
    if (attached.clip) return "The agent decides what to make. A reel on your clip is free.";
    if (choice.tab === "slides" && attached.photos.length === 1) return "The agent decides what to make. Words on your photo are free.";
    const ceiling = creditsWord(reelEstimate(choice, attached));
    return attached.photos.length ? `The agent decides what to make. A reel from your photo is up to ${ceiling}.` : `The agent decides what to make. A reel is up to ${ceiling}.`;
  }
  /* The mode is read with stand-in words, because the price must show before
     she types; only a mode that will run is priced. */
  const resolved = resolveManualMode({ tab: choice.tab, format: choice.format, attached, text: "her words", hook });
  switch (resolved.mode) {
    case "photo":
      return `This will use ${creditsWord(photoCredits(choice.imageModel))}`;
    case "clip":
      return `This will use ${creditsWord(clipCredits(choice.clipModel))}`;
    case "reel":
    case "carousel":
    case "text_photo":
      return "Free";
    case "none":
      return resolved.message;
  }
}

/** An agent message with a pinned hook: the exact-words sentence the understanding step reads, then what she typed. */
export function withPinnedHook(text: string, hook: string | null): string {
  const pinned = hook?.trim();
  return pinned ? `${pinnedHookMessage(pinned)} ${text}`.trim() : text;
}

/** The shot a manual photo is framed as, read off the words. A friend's camera when nothing says otherwise. */
export function shotFor(prompt: string): ShotType {
  const text = prompt.toLowerCase();
  if (/\bmirror\b/.test(text)) return "mirror";
  if (/\b(0\.5|wide[- ]angle|wide selfie|arm'?s length)\b/.test(text)) return "wide_selfie";
  if (/\bselfie\b/.test(text)) return "selfie";
  return "friend";
}

/** The five text styles are also carousel kit ids (src/carousel/kits.ts), so the look travels as it is. */
export function kitForTextStyle(style: TextStyle): string {
  return style;
}

/** How a pinned hook is said to the agent: the existing exact-words path reads the quotes. */
export function pinnedHookMessage(hook: string): string {
  return `Use this exact hook: "${hook.trim()}"`;
}

/* ------------------------------------------------------------------ */
/* What the composer remembers between visits                          */
/* ------------------------------------------------------------------ */

/** The browser key the composer's last choices are kept under. */
export const CHOICE_MEMORY_KEY = "composer-choice";

/**
 * What is kept: the image model and shape, the text style, the text size and
 * case once she set them, the Brand chip once she set it, and the video model and slides format only once she picked them (an unpicked one is the
 * run's own choice, and remembering the default would pin it). Never the tab,
 * and never the Agent toggle.
 */
export type ChoiceMemory = {
  imageModel: ImageModel;
  imageAspect?: ImageAspect;
  textStyle: TextStyle;
  textSize?: TextSize;
  lowercase?: boolean;
  clipModel?: ClipModel;
  format?: SlidesFormat;
  layout?: Layout;
  brand?: boolean;
};

export function choiceMemory(choice: ComposerChoice): string {
  const memory: ChoiceMemory = {
    imageModel: choice.imageModel,
    ...(choice.imageAspectPicked ? { imageAspect: choice.imageAspect } : {}),
    textStyle: choice.textStyle,
    ...(choice.textSizePicked ? { textSize: choice.textSize } : {}),
    ...(choice.lowercasePicked ? { lowercase: choice.lowercase } : {}),
    ...(choice.clipModelPicked ? { clipModel: choice.clipModel } : {}),
    ...(choice.formatPicked ? { format: choice.format } : {}),
    ...(choice.layoutPicked ? { layout: choice.layout } : {}),
    ...(choice.brandPicked ? { brand: choice.brand } : {}),
  };
  return JSON.stringify(memory);
}

/**
 * The remembered choices laid over `base`. Every value is checked by name, so
 * a stale or hand-edited entry falls back to the default rather than breaking
 * the box; anything unreadable is the default.
 */
export function rememberedChoice(raw: string | null, base: ComposerChoice): ComposerChoice {
  if (!raw) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!parsed || typeof parsed !== "object") return base;
  const memory = parsed as Record<string, unknown>;
  const clipModel = CLIP_MODELS.find((model) => model.id === memory.clipModel)?.id;
  const format = memory.format === "carousel" || memory.format === "story" ? memory.format : undefined;

  return {
    ...base,
    ...(isImageModel(memory.imageModel) ? { imageModel: memory.imageModel } : {}),
    ...(isImageAspect(memory.imageAspect) ? { imageAspect: memory.imageAspect, imageAspectPicked: true } : {}),
    ...(isTextStyle(memory.textStyle) ? { textStyle: memory.textStyle } : {}),
    ...(isTextSize(memory.textSize) ? { textSize: memory.textSize, textSizePicked: true } : {}),
    ...(typeof memory.lowercase === "boolean" ? { lowercase: memory.lowercase, lowercasePicked: true } : {}),
    ...(clipModel ? { clipModel, clipModelPicked: true } : {}),
    ...(format ? { format, formatPicked: true } : {}),
    ...(isLayout(memory.layout) ? { layout: memory.layout, layoutPicked: true } : {}),
    ...(typeof memory.brand === "boolean" ? { brand: memory.brand, brandPicked: true } : {}),
  };
}

/** The Brand chip's words. */
export function brandChipLabel(brand: boolean): string {
  return brand ? "Brand on" : "Brand off";
}

/** Said once, the first time she turns the brand off. */
export const BRAND_OFF_NOTE = "Off: writes without your niche, offer and story. Your avatar and photo style stay.";
/** Where the browser remembers that the note has been shown. */
export const BRAND_NOTE_KEY = "brand-off-explained";

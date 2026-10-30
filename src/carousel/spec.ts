import { z } from "zod";

import { commentLine, genericAsk, isEnglish, LANGUAGE_CODES } from "../content/languages";

/* The spec is the contract between the writer (a model) and the renderer (fixed
   code). Version 1 is deliberately small: three slide types, no decoration. A
   model that can only produce these three shapes cannot produce an ugly slide. */

export const SPEC_VERSION = 1;

export const FORMATS = {
  carousel: { width: 1080, height: 1350, minFrames: 5, maxFrames: 10 },
  story: { width: 1080, height: 1920, minFrames: 3, maxFrames: 5 },
} as const;

export type Format = keyof typeof FORMATS;

/** "mixed" puts the lessons on plain paper between the photos. "photos" puts
    every slide on a photo, the keyword slide included: the everyday
    caption-on-a-selfie set, which has no paper in it at all. "split" stacks
    two photos on every slide, each with one short line, the two lines read as
    a pair. "grid" opens on four photos under a title, then one photo and one
    line per slide. */
export const LAYOUTS = ["mixed", "photos", "split", "grid"] as const;
export type Layout = (typeof LAYOUTS)[number];

/** A layout from a form or a stored job, where anything unknown is the old default. */
export function layoutFrom(value: unknown): Layout {
  return LAYOUTS.find((layout) => layout === value) ?? "mixed";
}

const noMarkup = (label: string) =>
  z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes("*"), { message: `${label} cannot use *emphasis*; only title lines can` })
    .refine((value) => !value.includes("\n"), { message: `${label} must be a single line` });

/** A few words, optionally with one or two *emphasised* words. */
const titleLine = z
  .string()
  .trim()
  .min(1)
  .refine((value) => (value.match(/\*/g) ?? []).length % 2 === 0, { message: "unclosed * in a title line" });

export const titleSchema = z.object({
  lines: z.array(titleLine).min(1).max(4),
  /** The one line set in the kit's accent face: the payoff, or a number. */
  accent: noMarkup("An accent line").optional(),
  /** The creator's own words, set in her case even in a kit that sets titles in caps. */
  asTyped: z.boolean().optional(),
  /** Drawn character for character: an asterisk is an asterisk, not a mark for emphasis. Words on her own photo use it. */
  literal: z.boolean().optional(),
});

export type Title = z.infer<typeof titleSchema>;

const coverSlide = z.object({
  type: z.literal("cover"),
  /** A photo reference the caller can resolve: "pNN" (index in the photo folder) or a path. */
  photo: z.string().trim().min(1),
  /** 0 = crop to the top of the photo, 1 = to the bottom. Omitted means: follow the face. */
  anchor: z.number().min(0).max(1).optional(),
  title: titleSchema,
  sub: noMarkup("A cover sub").optional(),
});

const paperSlide = z.object({
  type: z.literal("paper"),
  title: titleSchema,
  /** One plain sentence. The slide's whole argument. */
  body: noMarkup("A paper body"),
});

/* A set written without her brand has no comment keyword: its last slide
   asks for one of these instead, and `keyword` holds the action's word. */
export const SLIDE_ACTIONS = ["save", "share", "follow"] as const;
export type SlideAction = (typeof SLIDE_ACTIONS)[number];
const ACTION_ASK: Record<SlideAction, string> = { save: "Save this", share: "Share this", follow: "Follow for more" };

const keywordSlide = z.object({
  type: z.literal("keyword"),
  keyword: z
    .string()
    .trim()
    .min(2)
    // Letters in any Latin language: a keyword may carry an accent (ȘTIU, GRÜN). Still no punctuation.
    .regex(/^[\p{L}\p{N} ]+$/u, "a comment keyword is one plain word"),
  promise: noMarkup("A keyword promise"),
  photo: z.string().trim().min(1).optional(),
  /** Set on a set written without her brand: the slide asks for this, not for a comment. */
  action: z.enum(SLIDE_ACTIONS).optional(),
});

/** Two photos stacked, one short line on each. The lines are one thought:
    a problem and its fix, a sentence broken across the halves, a before and after. */
const splitSlide = z.object({
  type: z.literal("split"),
  photos: z.tuple([z.string().trim().min(1), z.string().trim().min(1)]),
  lines: z.tuple([noMarkup("A split line"), noMarkup("A split line")]),
});

/** One photo, one line of small type across the middle. */
const lineSlide = z.object({
  type: z.literal("line"),
  photo: z.string().trim().min(1),
  text: noMarkup("A photo line"),
});

/** Four photos in a 2x2 grid under a title set in the accent face, with an
    optional plain line under it. Only ever a first slide. */
const gridSlide = z.object({
  type: z.literal("grid"),
  photos: z.tuple([z.string().trim().min(1), z.string().trim().min(1), z.string().trim().min(1), z.string().trim().min(1)]),
  headline: noMarkup("A grid headline"),
  /** May carry one *marked* word, set in a serif italic. */
  sub: z
    .string()
    .trim()
    .min(1)
    .refine((value) => !value.includes("\n"), { message: "A grid sub must be a single line" })
    .refine((value) => (value.match(/\*/g) ?? []).length % 2 === 0, { message: "unclosed * in a grid sub" })
    .optional(),
});

export const slideSchema = z.discriminatedUnion("type", [coverSlide, paperSlide, keywordSlide, splitSlide, lineSlide, gridSlide]);
export type Slide = z.infer<typeof slideSchema>;
export type CoverSlide = z.infer<typeof coverSlide>;
export type PaperSlide = z.infer<typeof paperSlide>;
export type KeywordSlide = z.infer<typeof keywordSlide>;
export type SplitSlide = z.infer<typeof splitSlide>;
export type LineSlide = z.infer<typeof lineSlide>;
export type GridSlide = z.infer<typeof gridSlide>;

/** Which slide types each layout may use between its first and last slide, and
    which it may open on. The keyword slide is always last, in every layout. */
export const LAYOUT_SLIDES: Record<Layout, { first: Slide["type"][]; middle: Slide["type"][] }> = {
  mixed: { first: ["cover"], middle: ["cover", "paper"] },
  photos: { first: ["cover"], middle: ["cover"] },
  split: { first: ["split", "grid"], middle: ["split"] },
  grid: { first: ["grid"], middle: ["line"] },
};

/** Every photo reference a slide draws, in the order it draws them. */
export function slidePhotos(slide: Slide): string[] {
  switch (slide.type) {
    case "cover":
    case "line":
      return [slide.photo];
    case "keyword":
      return slide.photo ? [slide.photo] : [];
    case "split":
    case "grid":
      return [...slide.photos];
    case "paper":
      return [];
  }
}

/** The fewest slides a set of her own may have; a written set keeps its format's minimum. */
export const OWN_MIN_FRAMES = 2;

export const carouselSpecSchema = z
  .object({
    version: z.literal(SPEC_VERSION).default(SPEC_VERSION),
    /** Output folder name. */
    name: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9-]{1,48}$/, "name must be a lowercase slug"),
    format: z.enum(["carousel", "story"]).default("carousel"),
    /** Sets saved before this existed are mixed, which is what they are. */
    layout: z.enum(LAYOUTS).default("mixed"),
    /** The handle drawn small at the foot of every slide. Omitted means none. */
    brand: noMarkup("A brand handle").optional(),
    /** One line, posted with the set. */
    caption: noMarkup("The caption"),
    /** The language the words are in (src/content/languages.ts). Absent is English, as every older set was. */
    language: z.enum(LANGUAGE_CODES).optional(),
    /**
     * Her own slides, word for word (src/carousel/given.ts): as many as she
     * wrote, and a keyword slide only if she wrote one. No writer touched it,
     * so the writing checks do not apply. Absent on every written set.
     */
    ownSlides: z.boolean().optional(),
    slides: z.array(slideSchema).min(OWN_MIN_FRAMES).max(10),
  })
  .superRefine((spec, ctx) => {
    const frame = FORMATS[spec.format];
    const minFrames = spec.ownSlides ? OWN_MIN_FRAMES : frame.minFrames;
    if (spec.slides.length < minFrames || spec.slides.length > frame.maxFrames) {
      ctx.addIssue({
        code: "custom",
        path: ["slides"],
        message: `a ${spec.format} has ${minFrames}-${frame.maxFrames} frames, got ${spec.slides.length}`,
      });
    }
    const allowed = LAYOUT_SLIDES[spec.layout];
    const first = spec.slides[0];
    if (first && !allowed.first.includes(first.type)) {
      ctx.addIssue({ code: "custom", path: ["slides", 0], message: `the first slide is a ${allowed.first.join(" or ")} slide` });
    }
    spec.slides.slice(1).forEach((slide, offset) => {
      if (slide.type === "keyword" || allowed.middle.includes(slide.type)) return;
      ctx.addIssue({ code: "custom", path: ["slides", offset + 1], message: `a ${spec.layout} set has no ${slide.type} slides after the first` });
    });
    const keywordAt = spec.slides.map((slide, index) => (slide.type === "keyword" ? index : -1)).filter((i) => i >= 0);
    // Her own slides end where she ended them: the keyword slide is the writer's rule, not hers.
    const endsOnHers = spec.ownSlides === true && keywordAt.length === 0;
    if (!endsOnHers && keywordAt.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["slides"], message: "exactly one keyword slide is required" });
    } else if (keywordAt.length === 1 && keywordAt[0] !== spec.slides.length - 1) {
      ctx.addIssue({ code: "custom", path: ["slides", keywordAt[0]], message: "the keyword slide is the last slide" });
    }
    if (spec.layout !== "mixed") {
      spec.slides.forEach((slide, index) => {
        if (slide.type === "paper") {
          ctx.addIssue({ code: "custom", path: ["slides", index], message: "an all-photo set has no paper slides" });
        } else if (slide.type === "keyword" && !slide.photo) {
          ctx.addIssue({ code: "custom", path: ["slides", index, "photo"], message: "in an all-photo set the keyword slide has a photo too" });
        }
      });
    }
  });

export type CarouselSpec = z.infer<typeof carouselSpecSchema>;

export function parseSpec(value: unknown): CarouselSpec {
  return carouselSpecSchema.parse(value);
}

/** Zod issues as flat, human sentences, which is what a repair prompt needs. */
export function specProblems(value: unknown): string[] {
  const result = carouselSpecSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".") || "spec"}: ${issue.message}`);
}

export function slideTitle(slide: Slide): Title | null {
  return slide.type === "cover" || slide.type === "paper" ? slide.title : null;
}

/** What the last slide asks, in words: "Comment AVATAR", or "Save this" on a set written without her brand. In her language when it is not English; the keyword never changes. */
export function askText(slide: { keyword: string; action?: SlideAction }, language?: string): string {
  if (isEnglish(language)) return slide.action ? ACTION_ASK[slide.action] : `Comment ${slide.keyword}`;
  return slide.action ? genericAsk(slide.action, language) : commentLine(slide.keyword, language);
}

/** Every piece of copy on a slide, for checks that read text rather than structure. */
export function slideText(slide: Slide): string[] {
  switch (slide.type) {
    case "cover":
      return [...slide.title.lines, slide.title.accent, slide.sub].filter((line): line is string => Boolean(line));
    case "paper":
      return [...slide.title.lines, slide.title.accent, slide.body].filter((line): line is string => Boolean(line));
    case "keyword":
      return [slide.keyword, slide.promise];
    case "split":
      return [...slide.lines];
    case "line":
      return [slide.text];
    case "grid":
      return [slide.headline, slide.sub].filter((line): line is string => Boolean(line));
  }
}

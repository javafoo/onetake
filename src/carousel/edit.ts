import type { Problem } from "./check";
import { carouselSpecSchema, slideTitle, type CarouselSpec, type Slide } from "./spec";
import { parseEmphasis } from "./text";

/* Editing a set after the model has gone home.

   The creator can change the words on a slide, and nothing else: the shape of
   the set (how many slides, which are covers, that the last one is the keyword
   slide) was decided by the checks and stays decided. Every edit goes back
   through the same schema the writer's output went through, so a hand-typed
   slide cannot be something the renderer has never seen.

   All of this is pure. It takes a spec and gives back a spec. */

export type SlideEdit = {
  /** One string per title line. Wrap a word in *asterisks* to set it apart. */
  titleLines?: string[];
  /** The line in the kit's accent face. Empty string removes it. */
  accent?: string;
  /** Cover slides only. Empty string removes it. */
  sub?: string;
  /** Paper slides only. */
  body?: string;
  /** Keyword slide only. */
  keyword?: string;
  /** Keyword slide only. */
  promise?: string;
  /** Split slides only: the line on the top photo. */
  top?: string;
  /** Split slides only: the line on the bottom photo. */
  bottom?: string;
  /** Line slides only: the one line across the photo. */
  text?: string;
  /** Grid slides only: the title in the accent face. */
  headline?: string;
};

const trimmed = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const clean = value.trim().replace(/\s+/g, " ");
  return clean ? clean : undefined;
};

/** The lines a textarea gave us, minus the blank ones a stray return leaves. */
export function titleLinesFrom(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .filter(Boolean);
}

/** The title as one textarea's worth of text, which is how it is edited. */
export function titleLinesText(slide: Slide): string {
  return slideTitle(slide)?.lines.join("\n") ?? "";
}

/** Every word currently set apart on a slide, for showing back what is emphasised. */
export function slideEmphasis(slide: Slide): string[] {
  const title = slideTitle(slide);
  if (!title) return [];
  return title.lines.flatMap((line) => parseEmphasis(line).filter((run) => run.emphasis).map((run) => run.text.trim()));
}

/* A field left out of the edit keeps what was there. A field sent empty is a
   different thing: she cleared a box that has to have something in it, and the
   sentence she gets back has to say which one. */
function required(value: string | undefined, fallback: string, what: string): string {
  if (value === undefined) return fallback;
  const clean = trimmed(value);
  if (!clean) throw new Error(what);
  return clean;
}

function applied(slide: Slide, edit: SlideEdit): unknown {
  if (slide.type === "split") {
    return {
      ...slide,
      lines: [
        required(edit.top, slide.lines[0], "The top photo needs its line."),
        required(edit.bottom, slide.lines[1], "The bottom photo needs its line."),
      ],
    };
  }
  if (slide.type === "line") {
    return { ...slide, text: required(edit.text, slide.text, "This photo needs its line.") };
  }
  if (slide.type === "grid") {
    return {
      ...slide,
      headline: required(edit.headline, slide.headline, "The cover needs its title."),
      sub: edit.sub === undefined ? slide.sub : trimmed(edit.sub),
    };
  }
  if (slide.type === "keyword") {
    return {
      ...slide,
      keyword: required(edit.keyword, slide.keyword, "The keyword slide needs its word."),
      promise: required(edit.promise, slide.promise, "Say what they get for commenting it."),
    };
  }

  const title = {
    lines: edit.titleLines ? edit.titleLines.map((line) => line.trim()).filter(Boolean) : slide.title.lines,
    accent: edit.accent === undefined ? slide.title.accent : trimmed(edit.accent),
  };

  if (slide.type === "cover") {
    return { ...slide, title, sub: edit.sub === undefined ? slide.sub : trimmed(edit.sub) };
  }
  return { ...slide, title, body: required(edit.body, slide.body, "This slide needs its one plain sentence.") };
}

/**
 * One slide's words, replaced. Throws (with the schema's own sentence) if the
 * result is not a slide the renderer can draw — an empty title, unbalanced
 * asterisks, a paper slide with no sentence left.
 */
export function editSlide(spec: CarouselSpec, index: number, edit: SlideEdit): CarouselSpec {
  const slide = spec.slides[index];
  if (!slide) throw new Error("That slide is not in this set.");
  const slides = spec.slides.map((existing, position) => (position === index ? applied(existing, edit) : existing));
  return carouselSpecSchema.parse({ ...spec, slides });
}

/** Point one photo on a slide at a different reference. `slot` picks which of
    a split slide's two or a grid's four; a one-photo slide only has slot 0.
    Slides without a photo are refused. */
export function setSlidePhoto(spec: CarouselSpec, index: number, ref: string, slot = 0): CarouselSpec {
  const slide = spec.slides[index];
  if (!slide) throw new Error("That slide is not in this set.");
  if (slide.type === "paper") throw new Error("This slide has no photo on it.");
  const count = slide.type === "split" || slide.type === "grid" ? slide.photos.length : 1;
  if (!Number.isInteger(slot) || slot < 0 || slot >= count) throw new Error("That photo is not on this slide.");
  const replaced =
    slide.type === "split" || slide.type === "grid"
      ? { ...slide, photos: slide.photos.map((existing, position) => (position === slot ? ref : existing)) }
      : { ...slide, photo: ref };
  const slides = spec.slides.map((existing, position) => (position === index ? replaced : existing));
  return carouselSpecSchema.parse({ ...spec, slides });
}

/** The caption, edited on its own: it belongs to the set, not to a slide. */
export function editCaption(spec: CarouselSpec, caption: string): CarouselSpec {
  return carouselSpecSchema.parse({ ...spec, caption: caption.trim().replace(/\s+/g, " ") });
}

/* --- saying what failed, in words a person can act on -------------------- */

const PLAIN: Record<string, string> = {
  "unsupported-number": "This number is not in your proof points. Use one of your own numbers, or write the slide without one.",
  "cover-title-length": "The cover title is too long. Five words, so it can be read at a glance.",
  "title-line-length": "A title line is too long. Keep each line to four words or fewer.",
  "emphasis-count": "Too many words are set apart. One or two in a title, no more.",
  "body-length": "This sentence is too long for the slide.",
  "body-one-sentence": "This is more than one sentence. A slide says one thing.",
  "caption-one-line": "The caption is too long. One line, under 180 characters.",
  "keyword-last": "The last slide has to be the keyword slide.",
  "keyword-word": "This is not the comment keyword on your Brand page.",
  "frame-count": "This set has the wrong number of slides for its format.",
  "photo-line-length": "This line is too long to read over a photo. Keep it short.",
  "grid-title-length": "The cover title is too long. A few words, so it can be read at a glance.",
};

/** A failed check as two sentences: what is wrong, then exactly where. */
export function plainProblem(problem: Problem): { where: string; sentence: string; detail: string } {
  return {
    where: problem.slide ? `Slide ${problem.slide}` : "This set",
    sentence: PLAIN[problem.rule] ?? "This slide does not pass one of the writing rules.",
    detail: problem.detail,
  };
}

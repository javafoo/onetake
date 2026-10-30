import type { Skeleton } from "./write";

/* The shapes, in the words a creator chooses from.

   `SKELETONS` in write.ts is written for the model: it describes what goes on
   each slide. These are written for the person picking, one line each. They
   live in their own leaf file, with a type-only import, so a client component
   can show them without pulling the writer — and the Gemini client behind it —
   into the browser bundle. */

export const SKELETON_LABEL: Record<Skeleton, { name: string; line: string }> = {
  list: {
    name: "List",
    line: "Numbered lessons. Each slide is one thing, and the sentence that makes it land.",
  },
  case_study: {
    name: "Case study",
    line: "One story with a result: where it started, what changed, what it produced.",
  },
  statement: {
    name: "Statement",
    line: "A position, argued: who it is for, what most people do, what you do instead.",
  },
  tutorial: {
    name: "Tutorial",
    line: "A walk-through: the outcome first, then the steps in order, one per slide.",
  },
};

/** Where the words sit, in the same voice. */
export const LAYOUT_LABEL = {
  mixed: {
    name: "Photos and text",
    line: "Photo slides at the start and in the middle, and the points on plain slides between them.",
  },
  photos: {
    name: "All photos",
    line: "Every slide is a photo of you with the words on it. Photos repeat if the set has more slides than you have photos.",
  },
  split: {
    name: "Half and half",
    line: "Two photos stacked on every slide, with one short line on each. The two lines go together, like a problem and its fix.",
  },
  grid: {
    name: "Four-photo cover",
    line: "The cover is four photos under a title. Every slide after it is one photo with one line on it.",
  },
} as const;

/** The formats, in the same voice. Sizes are the ones Instagram crops to. */
export const FORMAT_LABEL = {
  carousel: {
    name: "Carousel",
    ratio: "4:5",
    line: "Five to ten slides people swipe through on the feed.",
  },
  story: {
    name: "Story sequence",
    line: "Three to five full-screen frames for stories.",
    ratio: "9:16",
  },
} as const;

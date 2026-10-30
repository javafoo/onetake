import type { Brief } from "../brief/build";
import { generateText } from "../ai/text";
import { brandOff, genericAction, rememberedLines } from "../content/brand-scope";
import type { BrandProfile } from "../content/hooks";
import { languageField, withLanguage } from "../content/languages";
import { checkSpec, describeProblems, isPull, itemCapacity, promisedItems, type CheckSources, type Problem } from "./check";
import type { StyleKit } from "./kits";
import { carouselSpecSchema, FORMATS, type CarouselSpec, type Format, type Layout, type Slide } from "./spec";
import { words } from "./text";

/* One model call writes the whole set as a spec; code decides how it looks and
   whether it may ship. The writer never sees a pixel, and the renderer never
   sees the brand — that separation is the whole design. */

export const SKELETONS = {
  list: "A numbered lesson set. The cover names how many and what they are worth. Each paper slide is one lesson: a short title and the sentence that makes it land. One photo slide in the middle to break the rhythm.",
  case_study:
    "One story with a result. Cover states the claim. Then: where it started, the thing that changed, the two or three mechanics behind it, what it produced. A photo slide for the turn and for the belief line.",
  statement:
    "A position, argued. Cover is the statement itself. Then: who it is for, what most people do instead, what you do, what that means for the reader. A photo slide for the line you want quoted.",
  tutorial:
    "A walk-through. Photo cover shows the outcome. Then the steps in order, one per paper slide, each a short title and one instruction sentence. A photo slide before the close.",
} as const;

export type Skeleton = keyof typeof SKELETONS;
export const SKELETON_IDS = Object.keys(SKELETONS) as Skeleton[];

export type WriteOptions = {
  topic: string;
  profile: BrandProfile;
  brief?: Brief | null;
  kit: StyleKit;
  skeleton: Skeleton;
  format: Format;
  /** "photos" puts every slide on a photo. Absent means mixed. */
  layout?: Layout;
  /** Output slug, also the folder name. */
  name: string;
  brand?: string;
  /** Photo references the renderer can resolve, in the order they should be used. */
  photoRefs: string[];
  /** Use each photo once; a cover past the last photo is drawn on paper. Ignored in an all-photo set. */
  photosOnce?: boolean;
  slideCount?: number;
  /** The cover's words, given by the creator and used exactly; see `withCoverTitle`. */
  coverTitle?: string;
  /** A set she admires, slide by slide: a model for its shape, never its words or facts. */
  reference?: string;
  /** What the agent remembers about her (`memoryLines`): allowed ground for the writer and `checkSpec`. */
  memory?: string[];
  /** The house knowledge and her approved posts, as `referenceBlock` renders them. Technique, never her facts. */
  knowledge?: string;
  /** Called with each draft as it comes back, for logging a failing run. */
  onDraft?: (draft: unknown, attempt: number) => void;
};

export type WriteResult = {
  /** Null when even the last repair did not produce a valid spec. */
  spec: CarouselSpec | null;
  problems: Problem[];
  attempts: number;
};

type DraftSlide = {
  type?: string;
  titleLines?: string[];
  accent?: string;
  sub?: string;
  body?: string;
  keyword?: string;
  promise?: string;
};
export type Draft = { caption?: string; slides?: DraftSlide[] };

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    caption: { type: "string" },
    slides: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["cover", "paper", "keyword", "split", "line", "grid"] },
          titleLines: { type: "array", items: { type: "string" } },
          accent: { type: "string" },
          sub: { type: "string" },
          body: { type: "string" },
          keyword: { type: "string" },
          promise: { type: "string" },
        },
        // Every field is required and an empty string means "not on this slide":
        // asking for optional fields leaves the model free to drop the sentence.
        required: ["type", "titleLines", "accent", "sub", "body", "keyword", "promise"],
      },
    },
  },
  required: ["caption", "slides"],
};

const SYSTEM = `You write Instagram carousels for one creator's account. You write the words and the shape of each slide; fixed code draws them, so you never describe a layout, a colour or a font.

A set normally has three kinds of slide (the brief names a different set of kinds for some layouts, and then the brief wins):
- cover: a full-bleed photo of the creator, darkened, with a centred title and an optional one-line sub. The first slide is always a cover; two or three covers in a set keep it moving.
- paper: a plain background, a title, and one plain sentence underneath. The title is the claim; the sentence is the proof or the payoff.
- keyword: the last slide. The comment keyword, large, and a one-line promise of what the reader gets for commenting it.

How titles work:
- A title is 1 to 4 short lines. Most lines are two or three words; four is the hard maximum. They are set in one display face and read as a stack, not a sentence. A cover title is at most 5 words in total.
- You may wrap one or two words in *asterisks* across the whole title. Those words are set apart by the design. Emphasise the word that turns the line, never a filler word. Emphasis is rare: use it on about half the slides, never on two slides in a row, and never on the same word twice in one set.
- Never number a slide in its title: no "1.", no "Step 2", no "Part 3". The design carries the order.
- A title may end with one "accent" line: the emotional payoff, a number, or the quotable half of the thought. It is set in a different face, so it does the work a bold word cannot. Use it when there is a real payoff; leave it out when there is not.
- The sub on a cover and the sentence on a paper slide are plain sentences in normal case. One sentence, at most sixteen words, plus the short pull below when the sentence is not one itself. No semicolons, no lists.

Every slide earns the next swipe:
- The cover makes her stop and swipe. Every slide after it, except the last, ends on a pull that teases what the NEXT slide is actually about, by name. It can be a question, an unfinished thought, or a turn. It is never a tagline that could sit on any slide.
- Bad: "The next move →". Good, when the next slide is about batching scripts: "The part that saves me ten hours is how I write them →".
- Bad: "The fix is next." when nothing was broken. Good: "So why did nobody watch the first ten?"
- Bad: "Now comes the routine →". Good: "Most people skip the one setting that makes her look real..."
- The pull is the slide's last line: the end of the "body" on a paper slide, the "sub" on a cover. A flat statement of fact is not a pull.
- Never use the same pull twice in a set, and vary its shape: at most two pulls end in "→", at most two start with "Here's", and at most two are a question after a but/how/what clause. Mix in a short direct question, an unfinished thought ending in "...", a colon lead-in and a plain turn.
- The last slide pays off what the cover opened and asks for one action. Its "promise" says what she gets when she comments the keyword, in the creator's voice, with no hype.
- A story sequence follows the same rule, frame to frame.

Rules that decide whether the set ships:
- Personal history comes ONLY from the Story. If the Story does not say it, it did not happen. Write about the reader instead of inventing a past for the creator.
- Numbers come ONLY from the proof points, the story or the brief, in the same meaning. Never invent a number, a price, a follower count, a timeline or a testimonial. If no number fits, write the slide without one.
- No hype words, no emoji, no exclamation marks, no hashtags, no quotation marks on slides.
- No money talk anywhere: no revenue, income, earnings, profit, making money, or anything that "sells while you work". The account teaches how to post, not how much it pays.
- Write small counts as words ("two to three", "zero"). Digits are reserved for the real numbers in the proof points. A number in words is still a number: no "two minutes", "one hour", "a thousand", "half" or "dozens" unless the proof points or story say it.
- Every slide says one thing. Do not restate a slide you already wrote.
- The caption is one line, under 180 characters, and asks the reader to comment the exact keyword.

Every slide object carries every field. A field that does not apply to that slide is an empty string (or an empty list). The fields:
- "type": "cover", "paper" or "keyword", or the kinds the brief names for its layout.
- "titleLines": the title, one string per line. Required on cover and paper slides. Put *asterisks* around an emphasised word here.
- "accent": the optional accent line, on cover and paper slides.
- "sub": the optional one-line sub, on cover slides only.
- "body": the one plain sentence. REQUIRED on every paper slide.
- "keyword" and "promise": the last slide only. Leave titleLines empty there.
The brief says which fields a split, line or grid slide uses when the layout has them.`;

/**
 * The set's rules with the brand off: the last slide asks to save, share or
 * follow instead of commenting a keyword, there is no story or proof to draw
 * on, and the examples are about everyday life rather than posting. Each
 * swap must find its line: a rule reworded on the brand side cannot quietly
 * leave its old self in the no-brand prompt.
 */
function swap(text: string, from: string, to: string): string {
  if (!text.includes(from)) throw new Error(`The carousel rules changed; the no-brand version cannot find: ${from.slice(0, 60)}`);
  return text.replace(from, to);
}

const NO_BRAND_SWAPS: [string, string][] = [
  ["You write Instagram carousels for one creator's account.", "You write Instagram carousels for one creator's account. This set is not about her business or anything she sells: write it on the topic given, for anyone who cares about that topic."],
  [
    "- keyword: the last slide. The comment keyword, large, and a one-line promise of what the reader gets for commenting it.",
    "- keyword: the last slide. One action word, large: SAVE, SHARE or FOLLOW, and a one-line promise of why. There is no comment keyword in this set.",
  ],
  ['Good, when the next slide is about batching scripts: "The part that saves me ten hours is how I write them →".', 'Good, when the next slide is about sleep: "The habit that makes the rest easy starts the night before →".'],
  ['Good: "So why did nobody watch the first ten?"', 'Good: "So why does it fall apart so fast?"'],
  ['Good: "Most people skip the one setting that makes her look real..."', 'Good: "Most people skip the one habit that makes the others stick..."'],
  [
    'Its "promise" says what she gets when she comments the keyword, in the creator\'s voice, with no hype.',
    'Its "keyword" is SAVE, SHARE or FOLLOW and its "promise" says in one plain line why to do it (to keep the list, to send it to a friend who needs it, for more like this), with no hype.',
  ],
  [
    "- Personal history comes ONLY from the Story. If the Story does not say it, it did not happen. Write about the reader instead of inventing a past for the creator.",
    "- She has no personal history in this set. Never say what happened to her, how long anything took, or what she achieved. Write about the reader and the topic instead.",
  ],
  [
    "- Numbers come ONLY from the proof points, the story or the brief, in the same meaning. Never invent a number, a price, a follower count, a timeline or a testimonial. If no number fits, write the slide without one.",
    "- Numbers come ONLY from the topic as given. Never invent a number, a price, a follower count, a timeline, a result or a testimonial. No income or results claims of any kind. If no number fits, write the slide without one.",
  ],
  [" The account teaches how to post, not how much it pays.", ""],
  ["Digits are reserved for the real numbers in the proof points.", "Digits are reserved for the numbers in the topic."],
  ["unless the proof points or story say it.", "unless the topic says it."],
  ["- The caption is one line, under 180 characters, and asks the reader to comment the exact keyword.", "- The caption is one line, under 180 characters, and asks the reader to save, share or follow. No comment keyword."],
];

const SYSTEM_NO_BRAND = NO_BRAND_SWAPS.reduce((text, [from, to]) => swap(text, from, to), SYSTEM);

/** What the writer is told about her, or that this set has none of it. */
function profileLines(profile: BrandProfile, brief: Brief | null | undefined): string[] {
  if (brandOff(profile)) {
    return [
      `Persona: ${profile.personaName ?? "(unnamed)"}`,
      "This set is written without her brand: no niche, audience, offer, story, proof points or comment keyword. Write only on the topic, and write no personal history.",
    ];
  }
  return [
    `Persona: ${profile.personaName ?? "(unnamed)"}`,
    `Niche: ${profile.niche}`,
    `Audience: ${profile.audience}`,
    `Offer: ${profile.offer}`,
    `Voice: ${profile.voice}`,
    `Comment keyword (the last slide and the caption use this exact word): ${profile.keyword}`,
    `Story (the only personal history that exists):\n${profile.story?.trim() || "(none: write no personal history at all)"}`,
    `Proof points allowed:\n${profile.proofPoints.map((point) => `- ${point}`).join("\n") || "- (none)"}`,
    briefLines(brief),
  ];
}

function briefLines(brief: Brief | null | undefined): string {
  if (!brief) return "";
  const pick = (label: string, items: { text: string }[]) =>
    items.length ? `${label}:\n${items.slice(0, 4).map((item) => `- ${item.text}`).join("\n")}` : "";
  return [
    `One-liner: ${brief.oneLiner.text}`,
    pick("Point of view", brief.pointOfView),
    pick("Positioning lines", brief.positioningLines),
    pick("Problem", brief.problem),
    pick("Proof on file", brief.proof),
    `Story arc: ${brief.story.before.text} / ${brief.story.turn.text} / ${brief.story.after.text}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/* An all-photo set is the same writing in a different place: what the shape
   calls a paper slide becomes a cover, its claim the title and its sentence
   the sub. The captions are read over a photo, so they are shorter and said
   the way she would say them. */
const ALL_PHOTOS = `This set is ALL PHOTOS: every slide sits on a photo of the creator. Use only "cover" slides and the one "keyword" slide at the end; write no "paper" slides. Where the shape describes a paper slide, write a cover slide instead: the title is the claim, the sub is the sentence that makes it land and ends on the pull to the next slide, and the accent is the payoff when there is one. Write each slide as a caption she would put on her own photo: short, spoken, first person where the story allows it. The title is at most five words.`;

function coverInstruction(coverTitle: string | undefined): string {
  if (!coverTitle?.trim()) return "";
  const flat = (text: string) => text.replace(/\s+/g, " ").trim();
  const { cover, rest } = splitCover(coverTitle);
  if (!rest) {
    return `The creator has written the cover herself and it will be used word for word: "${flat(cover)}". Write slide 1's titleLines as that text, split into short lines, and write every other slide to follow on from it.`;
  }
  return [
    `The creator has written the cover herself and it will be used word for word: "${flat(cover)}". Write slide 1's titleLines as that text, split into short lines.`,
    `Her text runs on, and code puts the rest of it at the top of slide 2, word for word: "${flat(rest)}".`,
    `So slide 2 is hers until its last line. For slide 2 write a two-word placeholder title and, as its "body" (or "sub" on a cover), only the pull that follows her words to slide 3. Do not repeat her words anywhere else. Every later slide follows on from them.`,
  ].join(" ");
}

/* Half and half: two photos stacked, one short line on each. The two lines are
   written as one thought, the way these posts read: the pair is the slide. */
const SPLIT = `This set is HALF AND HALF: every slide before the last is a "split" slide, two photos stacked with one short line on each. Write no "cover" and no "paper" slides.
A split slide's "titleLines" holds exactly two strings: the line on the top photo, then the line on the bottom photo. The two lines are one thought and read as a pair. Choose the pairing that fits the slide, and vary it across the set:
- a problem and its fix ("can't gym?" / "walk for 10 min")
- one sentence carried across the two halves ("the post you almost deleted" / "is the one that grows you")
- a before and an after, a question and its answer, a myth and the truth.
Each line is two to five words, never more than seven: it is read in a glance over a photo. Write it in lowercase unless a name needs a capital, with no full stop at the end (a question mark is fine). No asterisks. Leave "accent", "sub" and "body" empty on split slides.
The rules about ending each slide on a pull do not apply to this set: each pair stands on its own, with no arrows and no "Here's how".`;

/* A grid set: four photos under a title, then one photo and one line a slide. */
const GRID = `This set is a GRID set. Slide 1 is a "grid" slide: four photos under a title. Every slide after it, before the last, is a "line" slide: one photo with one line of small type across it. Write no "cover" and no "paper" slides.
- The grid slide: "titleLines" holds the title as one string of at most four words, the name of the list or the first half of the sentence ("To Do's", "Soft life rules", "hobbies that will"); "sub" is an optional line under it of at most six words that finishes it ("before 2026 ends", "*rewire* your brain:"). In "sub", put asterisks around the one word that turns the title, usually its verb; it is set in a serif italic. No asterisks in "titleLines".
- A line slide: "body" is the one line, usually six to ten words and never more than fourteen, one item of the list said plainly as an action or a truth ("restart a hobby you forgot you had"). Lowercase, no full stop at the end. Leave "titleLines", "accent" and "sub" empty on line slides.
The rules about ending each slide on a pull do not apply to this set: each line is one item of the list, with no arrows and no "Here's how".`;

function briefPrompt(options: WriteOptions, count: number): string {
  const { profile } = options;
  const photos = options.layout === "photos";
  const split = options.layout === "split";
  const grid = options.layout === "grid";
  return [
    `Write one ${options.format === "story" ? "story sequence" : "carousel"} of exactly ${count} slides about: ${options.topic}`,
    coverInstruction(options.coverTitle),
    countInstruction(options),
    options.reference
      ? `A set the creator admires, as a model for SHAPE only: match what each slide does, the order, the length of each line and the rhythm, with her own subject, her own words and only her own facts. Its names, numbers and claims are someone else's and must not appear:\n${options.reference.trim()}`
      : "",
    `Shape: ${SKELETONS[options.skeleton]}`,
    photos ? ALL_PHOTOS : split ? SPLIT : grid ? GRID : "",
    `The look it will be drawn in: ${options.kit.character}`,
    ...profileLines(profile, options.brief),
    rememberedLines(profile, options.memory).join("\n"),
    options.knowledge?.trim() ?? "",
    split
      ? `Every slide is a split slide except the last, which is the keyword slide.`
      : grid
        ? `Slide 1 is the grid slide. The last slide is the keyword slide. Every slide between them is a line slide.`
        : photos
      ? `Slide 1 is a cover. The last slide is the keyword slide. Every slide between them is a cover.`
      : `Slide 1 is a cover. The last slide is the keyword slide. Use ${options.format === "story" ? "one" : "two or three"} cover slides in total.`,
    brandOff(profile)
      ? 'The last slide\'s "keyword" is SAVE, SHARE or FOLLOW, and its "promise" is one short line of why.'
      : "",
    split || grid
      ? `The last slide needs "keyword" and "promise"; the promise is one short line of ${brandOff(profile) ? "why" : "what the reader gets for commenting"}.`
      : photos
      ? 'Fill every field: each cover slide needs "titleLines" and a one-line "sub"; the last slide needs "keyword" and "promise". ' +
        'Add an "accent" line on the two or three slides that carry the real payoff. A slide with a title and no sentence is not a finished slide.'
      : 'Fill every field: each cover slide needs "titleLines" and a one-line "sub"; each paper slide needs "titleLines" AND "body", the one plain sentence that makes the title land; ' +
        'the last slide needs "keyword" and "promise". Add an "accent" line on the two or three slides that carry the real payoff. A slide with a title and no sentence is not a finished slide.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** The draft as the model returns it becomes a spec here: photos are assigned by
    us (the model cannot see them) and empty optional fields are dropped. In an
    all-photo set a paper slide the model wrote anyway is moved onto a photo,
    its sentence becoming the sub, rather than spending a repair on it. */
export function toSpec(draft: Draft, options: Pick<WriteOptions, "photoRefs" | "profile" | "name" | "format" | "layout" | "brand" | "photosOnce">): unknown {
  const layout = options.layout ?? "mixed";
  const photos = layout !== "mixed";
  const once = Boolean(options.photosOnce) && !photos;
  let photoIndex = 0;
  const nextPhoto = () => {
    const refs = options.photoRefs;
    if (!refs.length) throw new Error("No photos were supplied for the cover slides");
    return refs[photoIndex++ % refs.length];
  };
  const photosLeft = () => !once || photoIndex < options.photoRefs.length;
  const slides = (draft.slides ?? []).map((slide, position) => {
    const title = {
      lines: (slide.titleLines ?? []).map((line) => line.trim()).filter(Boolean),
      accent: clean(slide.accent),
    };
    if (slide.type === "keyword") {
      // With the brand off the ask is generic: whatever word the writer chose, it is drawn as one of the three.
      const action = brandOff(options.profile) ? (genericAction(slide.keyword) ?? "save") : null;
      return {
        type: "keyword",
        keyword: action ? action.toUpperCase() : (clean(slide.keyword) ?? options.profile.keyword),
        promise: clean(slide.promise) ?? clean(slide.body) ?? clean(slide.sub) ?? "",
        ...(photos ? { photo: nextPhoto() } : {}),
        ...(action ? { action } : {}),
      };
    }
    /* In a split or grid set the model's words are moved into the one shape
       each slot allows, whatever type it named: a repair is spent on the words,
       never on a slide type the layout decides anyway. */
    if (layout === "split" || layout === "grid") {
      const spare = [clean(slide.sub), clean(slide.body)].filter((line): line is string => Boolean(line));
      const lines = title.lines.length >= 2 ? title.lines : [...title.lines, ...spare];
      if (layout === "grid" && position === 0) {
        return {
          type: "grid",
          photos: [nextPhoto(), nextPhoto(), nextPhoto(), nextPhoto()],
          headline: title.lines.join(" ") || (clean(slide.accent) ?? clean(slide.body) ?? ""),
          sub: clean(slide.sub),
        };
      }
      if (layout === "grid") return { type: "line", photo: nextPhoto(), text: clean(slide.body) ?? (title.lines.join(" ") || (clean(slide.sub) ?? "")) };
      const [top = "", ...rest] = lines;
      return { type: "split", photos: [nextPhoto(), nextPhoto()], lines: [top, rest.join(" ")] };
    }
    if ((slide.type === "cover" && photosLeft()) || photos) {
      return { type: "cover", photo: nextPhoto(), title, sub: clean(slide.sub) ?? clean(slide.body) };
    }
    return { type: "paper", title, body: clean(slide.body) ?? clean(slide.sub) ?? "" };
  });
  return {
    version: 1,
    name: options.name,
    format: options.format,
    layout,
    brand: clean(options.brand),
    caption: (draft.caption ?? "").trim().replace(/\s+/g, " "),
    ...languageField(options.profile.language),
    slides,
  };
}

/** Zod speaks in paths; the writer only knows the fields it filled in, so the
    common structural failures are translated back into its own vocabulary. */
function explain(path: (string | number | symbol)[], message: string): string {
  const field = String(path[path.length - 1]);
  if (field === "body") return 'this paper slide has no "body": write the one plain sentence that goes under the title';
  if (field === "promise") return 'the keyword slide has no "promise": write the one line the reader gets for commenting';
  if (field === "lines") return '"titleLines" must hold 1 to 4 short lines';
  if (path.includes("lines") && path[path.length - 2] === "lines") return 'a split slide needs two lines in "titleLines": the top photo\'s, then the bottom photo\'s';
  if (field === "text") return 'this line slide has no "body": write the one line that goes across the photo';
  if (field === "headline") return 'the grid slide has no title: write it in "titleLines"';
  return `${path.join(".") || "spec"}: ${message}`;
}

function zodProblems(value: unknown): Problem[] {
  const result = carouselSpecSchema.safeParse(value);
  if (result.success) return [];
  return result.error.issues.map((issue) => {
    const slide = issue.path[0] === "slides" && typeof issue.path[1] === "number" ? issue.path[1] + 1 : null;
    return { slide, rule: "spec", detail: explain(issue.path, issue.message) };
  });
}

/** Up to four lines of up to four words: a title's own limits, applied to her words without changing one. */
export function coverLinesFrom(text: string): string[] {
  const given = text.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
  const lines: string[] = [];
  if (given.length > 1) {
    for (const line of given) {
      const words = line.split(" ");
      for (let at = 0; at < words.length; at += 4) lines.push(words.slice(at, at + 4).join(" "));
    }
  } else {
    /* The fewest lines that keep to four words each, filled evenly; past
       sixteen words the lines get longer rather than her words getting lost. */
    const words = text.trim().replace(/\s+/g, " ").split(" ");
    const count = Math.min(4, Math.ceil(words.length / 4));
    const perLine = Math.ceil(words.length / count);
    for (let at = 0; at < words.length; at += perLine) lines.push(words.slice(at, at + perLine).join(" "));
  }
  return lines.slice(0, 4);
}

export type CoverParts = { title: string; sub?: string; accent?: string };

/** The longest a first sentence may be and still be the headline; past that the whole text is the headline. */
const HEADLINE_MAX_WORDS = 12;
/** A short last line is the payoff, set in the accent face. */
const PAYOFF_MAX_WORDS = 7;

/**
 * Her cover text, read the way a cover is read: the first sentence is the
 * headline, what follows is the sentence under it, and a short last line is
 * the payoff. Blank lines split it the same way. One sentence is a headline
 * on its own; two is headline and sentence; three or more adds the payoff.
 */
export function coverPartsFrom(text: string): CoverParts {
  const clean = text.trim();
  const byBlank = clean.split(/\n\s*\n/).map((part) => part.trim().replace(/\s+/g, " ")).filter(Boolean);
  const bySentence = clean.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  const parts = byBlank.length > 1 ? byBlank : bySentence;
  const words = (part: string) => part.split(" ").filter(Boolean).length;
  if (parts.length < 2 || words(parts[0]) > HEADLINE_MAX_WORDS) return { title: clean.replace(/\s+/g, " ") };
  const title = parts[0].replace(/[.!?]+$/, "");
  const rest = parts.slice(1);
  const last = rest[rest.length - 1];
  if (rest.length >= 2 && words(last) <= PAYOFF_MAX_WORDS) {
    return { title, sub: rest.slice(0, -1).join(" "), accent: last.replace(/[.!?]+$/, "") };
  }
  return { title, sub: rest.join(" ") };
}

/* A pinned cover past this will not read at cover size. The renderer's own
   measure needs a canvas and the kit's fonts, which the writer does not load,
   so the limit is counted: words, and lines as she broke them. */
export const COVER_FIT_MAX_WORDS = 18;
export const COVER_FIT_MAX_LINES = 3;

export type CoverSplit = { cover: string; rest?: string };

const nonBlankLines = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

export function coverFits(text: string): boolean {
  return words(text).length <= COVER_FIT_MAX_WORDS && nonBlankLines(text).length <= COVER_FIT_MAX_LINES;
}

/**
 * Where a long pinned cover breaks. The cover keeps as many of her groups
 * (blank-line blocks; else lines; else sentences) as fit, never fewer than
 * one, and prefers to stop on a group that pulls. The rest opens slide 2.
 * Only the break moves: joined back, the two halves are her text.
 */
export function splitCover(text: string): CoverSplit {
  const clean = text.trim().replace(/\r\n/g, "\n");
  if (!clean || coverFits(clean)) return { cover: clean };
  const groups = clean.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const lines = nonBlankLines(clean);
  const [units, joiner] =
    groups.length > 1
      ? [groups, "\n\n"]
      : lines.length > 1
        ? [lines, "\n"]
        : [clean.replace(/\s+/g, " ").match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean], " "];
  if (units.length < 2) return { cover: clean };
  let fitting = 1;
  let pulling = 0;
  for (let count = 1; count < units.length; count += 1) {
    if (!coverFits(units.slice(0, count).join(joiner))) break;
    fitting = count;
    if (isPull(units[count - 1])) pulling = count;
  }
  const at = pulling || fitting;
  return { cover: units.slice(0, at).join(joiner), rest: units.slice(at).join(joiner) };
}

const TITLE_LINE_WORDS = 6;

/** Her run-on words as the top of slide 2: her short leading lines become the
    title as she broke them, and the rest is the sentence under it. */
export function openingParts(rest: string): { lines: string[]; body: string } {
  const groups = rest.trim().split(/\n\s*\n/).map((group) => nonBlankLines(group)).filter((group) => group.length);
  const first = groups[0] ?? [];
  const lines: string[] = [];
  for (const line of first) {
    if (lines.length === 4 || words(line).length > TITLE_LINE_WORDS) break;
    lines.push(line.replace(/\s+/g, " "));
  }
  let remaining = [...first.slice(lines.length), ...groups.slice(1).flat()].join(" ").replace(/\s+/g, " ").trim();
  if (!lines.length) {
    // No short line to lead with: her first sentence is the title, however it wraps.
    const sentence = remaining.match(/^[^.!?]+[.!?]*/)?.[0] ?? remaining;
    lines.push(...coverLinesFrom(sentence.replace(/[.!?]+$/, "")).filter(Boolean));
    remaining = remaining.slice(sentence.length).trim();
  }
  return { lines, body: remaining };
}

/** Her words, then the writer's pull, as one closing line. */
function joinPull(hers: string, pull: string | undefined): string {
  const tail = pull?.trim();
  if (!hers) return tail ?? "";
  if (!tail) return hers;
  return /[.!?:…→]$/.test(hers) ? `${hers} ${tail}` : `${hers}. ${tail}`;
}

function withOpening(slide: Slide, rest: string): Slide {
  if (slide.type !== "cover" && slide.type !== "paper") return slide;
  const { lines, body } = openingParts(rest);
  if (!lines.length) return slide;
  // Her words keep her case, list marks and all, even in a kit that sets titles in caps.
  const title = { lines, asTyped: true };
  if (slide.type === "paper") return { ...slide, title, body: joinPull(body, slide.body) };
  const closing = joinPull(body, slide.sub ?? slide.title.accent);
  return { ...slide, title, ...(closing ? { sub: closing } : {}) };
}

/** The cover says what she wrote. The writer was told, but a rewrite is a
    rewrite: her words are put back after the checks, which are for ours. A
    cover too long to read is broken where `splitCover` says, and the rest
    opens slide 2, ahead of the pull the writer wrote there. */
export function withCoverTitle(spec: CarouselSpec, coverTitle: string | undefined): CarouselSpec {
  const text = coverTitle?.trim();
  if (!text) return spec;
  const first = spec.slides[0];
  /* A grid or split opening takes her words as its title and the line under
     it; the run-on handling below is for a photo cover. */
  if (first?.type === "grid" || first?.type === "split") {
    const parts = coverPartsFrom(splitCover(text).cover);
    if (first.type === "grid") {
      // Her line break is where the big line ends and the small one starts.
      const [head, ...under] = nonBlankLines(text);
      if (under.length) return { ...spec, slides: [{ ...first, headline: head.replace(/\*/g, ""), sub: under.join(" ") }, ...spec.slides.slice(1)] };
      const sub = parts.sub ?? parts.accent;
      return { ...spec, slides: [{ ...first, headline: parts.title, ...(sub ? { sub } : {}) }, ...spec.slides.slice(1)] };
    }
    if (parts.sub) return { ...spec, slides: [{ ...first, lines: [parts.title, parts.sub] }, ...spec.slides.slice(1)] };
    return spec;
  }
  if (!first || first.type !== "cover") return spec;
  const { cover, rest } = splitCover(text);
  const second = spec.slides[1];
  const opening = second ? [rest && spec.slides.length > 2 ? withOpening(second, rest) : second] : [];
  if (rest && cover.split(/\n\s*\n/).length > 1) {
    /* A split cover keeps its groups whole and at title size, her line
       breaks and all: the break was moved so they would fit, not so they
       could be demoted to a sub. The writer's sub goes; the cover is hers. */
    const { sub: _writerSub, ...coverSlide } = first;
    void _writerSub;
    return { ...spec, slides: [{ ...coverSlide, title: { lines: nonBlankLines(cover).map((line) => line.replace(/\s+/g, " ")) } }, ...opening, ...spec.slides.slice(2)] };
  }
  const parts = coverPartsFrom(cover);
  const lines = coverLinesFrom(parts.title);
  if (lines.length === 0) return spec;
  return {
    ...spec,
    slides: [
      {
        ...first,
        title: { lines, ...(parts.accent ? { accent: parts.accent } : {}) },
        ...(parts.sub ? { sub: parts.sub } : {}),
      },
      ...opening,
      ...spec.slides.slice(2),
    ],
  };
}

/** How many slides, and what the count owes: a number promised on her cover
    ("7 steps") is a slide per item, as far as the format allows. */
export function slidePlan(options: Pick<WriteOptions, "format" | "slideCount" | "coverTitle">): {
  count: number;
  opening: boolean;
  promised: { count: number; noun: string } | null;
  capacity: number;
} {
  const frame = FORMATS[options.format];
  const pinned = options.coverTitle?.trim();
  const opening = pinned ? Boolean(splitCover(pinned).rest) : false;
  const promised = pinned ? promisedItems(pinned) : null;
  const capacity = itemCapacity(frame.maxFrames, opening);
  const wanted = promised ? promised.count + 2 + (opening ? 1 : 0) : (options.slideCount ?? (options.format === "story" ? 4 : 8));
  return { count: Math.min(frame.maxFrames, Math.max(frame.minFrames, wanted)), opening, promised, capacity };
}

function countInstruction(options: WriteOptions): string {
  const plan = slidePlan(options);
  if (!plan.promised) return "";
  const { count, noun } = plan.promised;
  const where = plan.opening ? "between slide 2 and the keyword slide" : "between the cover and the keyword slide";
  if (count <= plan.capacity) {
    return `Her cover promises ${count} ${noun}. Deliver exactly that: ${count} slides ${where}, one ${noun.replace(/s$/, "")} per slide, in order, and no other slides.`;
  }
  return `Her cover promises ${count} ${noun}, but a ${options.format} has room for ${plan.capacity} slides ${where}. Cover all ${count} across them, two on a slide where needed, and never let a slide promise more than the set delivers.`;
}

/** The carousel writer's instructions, as plain strings so they can be tested. */
export function carouselPrompt(options: WriteOptions, count = slidePlan(options).count): { system: string; prompt: string } {
  const system = brandOff(options.profile) ? SYSTEM_NO_BRAND : SYSTEM;
  /* "keyword" on a set without her brand is SAVE, SHARE or FOLLOW, a code the
     app reads; the slide draws it in her language. So it is not in the list. */
  const what = "every slide's titleLines, accent, sub, body and promise, and the caption";
  return { system: withLanguage(system, options.profile.language, what), prompt: briefPrompt(options, count) };
}

const MAX_REPAIRS = 2;

export async function writeCarousel(options: WriteOptions): Promise<WriteResult> {
  const pinned = options.coverTitle?.trim();
  const plan = slidePlan(options);
  const count = plan.count;
  const sources: CheckSources = {
    profile: options.profile,
    brief: options.brief,
    topic: options.topic,
    fixedCover: Boolean(pinned),
    coverText: pinned,
    coverSplit: pinned ? plan.opening : undefined,
    memory: options.memory,
  };

  const { system, prompt } = carouselPrompt(options, count);
  let draft = await generateText<Draft>({ system, schema: DRAFT_SCHEMA, prompt });
  let attempts = 1;
  options.onDraft?.(draft, attempts);

  for (;;) {
    const candidate = toSpec(draft, options);
    const parsed = carouselSpecSchema.safeParse(candidate);
    const problems = parsed.success ? checkSpec(parsed.data, sources) : zodProblems(candidate);
    if (!problems.length) return { spec: parsed.success ? parsed.data : null, problems: [], attempts };
    if (attempts > MAX_REPAIRS) return { spec: parsed.success ? parsed.data : null, problems, attempts };

    draft = await generateText<Draft>({
      system,
      schema: DRAFT_SCHEMA,
      prompt: [
        prompt,
        `You wrote this draft:\n${JSON.stringify(draft, null, 2)}`,
        `It failed these checks:\n${describeProblems(problems)}`,
        "Return the whole set again with those problems fixed. Change only what the checks name; keep everything else word for word.",
      ].join("\n\n"),
    });
    attempts += 1;
    options.onDraft?.(draft, attempts);
  }
}

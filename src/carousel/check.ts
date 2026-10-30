import type { Brief } from "../brief/build";
import { brandOff, REFERENCE_IS_TECHNIQUE } from "../content/brand-scope";
import type { BrandProfile } from "../content/hooks";
import { contentLanguage, isEnglish, localeFor, widenLimit } from "../content/languages";
import { FORMATS, slideText, slideTitle, type CarouselSpec } from "./spec";
import { countWords, emphasisWords, plainText, words } from "./text";

/* These checks run in code, not in a model, so they cannot be talked out of a
   verdict. A failure is a sentence the writer can act on, not a score. */

export type Problem = { slide: number | null; rule: string; detail: string };

export type CheckSources = {
  profile: BrandProfile;
  brief?: Brief | null;
  /** The topic the creator asked for; numbers they typed themselves are theirs to use. */
  topic?: string;
  /** The cover's words are the creator's own: their length is not ours to judge. */
  fixedCover?: boolean;
  /** Her pinned cover text, when known: its numbers are hers to use. */
  coverText?: string;
  /** Whether her cover ran on into slide 2. Unknown (a saved set) is read as yes,
      so her words there are never judged for length. */
  coverSplit?: boolean;
  /** What the agent remembers about her: as much her ground as the story. Ignored with the brand off. */
  memory?: readonly string[];
};

export const COVER_TITLE_MAX_WORDS = 5;
export const TITLE_LINE_MAX_WORDS = 4;
export const MAX_EMPHASIS_WORDS = 2;
export const CAPTION_MAX_CHARS = 180;
export const BODY_MAX_WORDS = 26;
export const MAX_PULLS_PER_SHAPE = 2;
/** A line on half a photo is read in a glance, next to its pair. */
export const SPLIT_LINE_MAX_WORDS = 7;
/** A line across a whole photo can run a little longer, never to a paragraph. */
export const PHOTO_LINE_MAX_WORDS = 14;
export const GRID_HEADLINE_MAX_WORDS = 4;
export const GRID_SUB_MAX_WORDS = 6;

const NUMBER = /\$?\d[\d.,]*\s*(?:k|m)?%?/gi;
/** "12.000" and "12,000" as thousands: outside English a full stop groups thousands as often as a comma does. */
const GROUPED = /^\d{1,3}(?:[.,]\d{3})+$/;

/** "285K" and "285,942" both become a plain number so they can be compared. */
function numberValues(text: string, language?: string): number[] {
  const values: number[] = [];
  for (const token of text.match(NUMBER) ?? []) {
    const bare = token.trim().replace(/^\$/, "").replace(/\s*(?:k|m)?%?$/i, "");
    const grouped = !isEnglish(language) && GROUPED.test(bare);
    const cleaned = (grouped ? token.replace(/[.,]/g, "") : token).toLowerCase().replace(/[$,\s%]/g, "");
    const multiplier = cleaned.endsWith("k") ? 1_000 : cleaned.endsWith("m") ? 1_000_000 : 1;
    const value = Number.parseFloat(cleaned.replace(/[km]$/, ""));
    if (Number.isFinite(value)) values.push(value * multiplier);
  }
  return values;
}

/* Spelled numbers are claims too: "two minutes" is as specific as "2 minutes".
   "one" and "a" are everywhere, so they only count before a unit or a scale. */
const SMALL: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const SCALE: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 };
const UNIT = /^(seconds?|minutes?|hours?|days?|weeks?|months?|years?|followers?|views?|likes?|dollars?|sales?|clients?|customers?|dozen)$/;
/** Quantities with no one number behind them; traceable only if the sources use the same word. */
const VAGUE = /\b(half|dozens?|hundreds|thousands|millions|double|triple|twice)\b/gi;

function spelledValues(text: string): number[] {
  const tokens = text.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  const values: number[] = [];
  for (let at = 0; at < tokens.length; at += 1) {
    const word = tokens[at];
    const small = SMALL[word];
    if (small === undefined && !(word === "a" && SCALE[tokens[at + 1]])) continue;
    let value = small ?? 1;
    let next = at + 1;
    // "twenty five"
    if (small !== undefined && small >= 20 && small % 10 === 0 && (SMALL[tokens[next]] ?? 10) < 10) value += SMALL[tokens[next++]];
    let scaled = false;
    while (SCALE[tokens[next]]) {
      value *= SCALE[tokens[next++]];
      scaled = true;
    }
    if (tokens[next] === "dozen") value *= 12;
    if (value === 1 && !scaled && !UNIT.test(tokens[next] ?? "")) continue;
    values.push(value);
    at = next - 1;
  }
  return values;
}

function vagueWords(text: string): string[] {
  return (plainText(text).match(VAGUE) ?? []).map((word) => word.toLowerCase());
}

function briefText(brief: Brief | null | undefined): string {
  if (!brief) return "";
  const sourced = [
    brief.oneLiner,
    ...brief.audience,
    ...brief.problem,
    ...brief.offer,
    ...brief.pointOfView,
    ...brief.proof,
    ...brief.positioningLines,
    brief.story.before,
    brief.story.turn,
    brief.story.after,
  ];
  return sourced.map((item) => item.text).join(" ");
}

function sourceText(sources: CheckSources): string {
  return [
    sources.profile.story ?? "",
    ...sources.profile.proofPoints,
    sources.profile.offer,
    sources.topic ?? "",
    sources.coverText ?? "",
    briefText(sources.brief),
    // A REFERENCE block is never a source: its numbers are technique, not her proof.
    ...(brandOff(sources.profile) ? [] : (sources.memory ?? [])),
  ].join(" ");
}

/**
 * Everything the writer is allowed to take a number from, in digits or in
 * words. Numbers in digits are read in every language. Numbers spelled out
 * are read in English only: in another language a spelled number ("două
 * minute") is not caught here, and the writer's instruction is what holds it.
 */
export function allowedNumbers(sources: CheckSources): number[] {
  const text = sourceText(sources);
  return [...numberValues(text, sources.profile.language), ...spelledValues(text)];
}

function traceable(value: number, allowed: number[]): boolean {
  // 285K is the same claim as 285,942: a rounded number stays traceable.
  return allowed.some((known) => Math.abs(known - value) <= Math.max(0.5, Math.abs(known) * 0.015));
}

/* The house rule: every slide gets the reader to the next one. The writer is
   told; this only catches a slide that plainly stops, so it stays loose. A
   pull is judged on the last sentence of a slide's closing line. */

const PULL_END = /(\?|:|→|->|…|\.\.\.|—|↓)\s*$/;
const PULL_WORDS =
  /\b(but|until|except|instead|unless|yet|next|here'?s|here is|here are|what happened|what changed|what worked|turns out|that'?s when|that is when|which is why|the catch|the fix|the part|the real|the reason|the one|one thing|the first|the last|watch|swipe|keep reading|keep going|below|wait|how|why|step one)\b/i;
/* Pulls wear out by shape as much as by wording: three "…, but how …?" in a
   row read as a formula. These are the shapes the writer leans on. */
const SHAPES = {
  "a question after a but/how/what clause": (pull: string) => /\?\s*$/.test(pull) && /\b(but|how|what)\b/i.test(pull),
  "a line ending in an arrow": (pull: string) => /(→|->)\s*$/.test(pull),
  "a line starting with Here's": (pull: string) => /^here('?s| is| are)\b/i.test(pull.trim()),
} as const;
/** What the writer can reach for instead, named in the repair note. */
const OTHER_SHAPES = [
  "a short direct question with no but/how/what",
  "an unfinished thought ending in ...",
  "a colon lead-in",
  'a plain turn ("But that was not the part that worked.")',
];

/**
 * A line cut into sentences. Outside English a full stop between digits
 * groups thousands ("12.000 de urmăritori"), so it does not end a sentence
 * there; English is cut exactly as it always was.
 */
function sentencesOf(text: string, language?: string): string[] {
  return text.match(isEnglish(language) ? /[^.!?]+[.!?]*/g : /(?:[^.!?]|\.(?=\d))+[.!?]*/g) ?? [];
}

function lastSentence(text: string): string {
  const parts = plainText(text).trim().match(/[^.!?]+[.!?]*/g) ?? [];
  return (parts[parts.length - 1] ?? "").trim();
}

/** A line that makes her swipe: a question, a colon or arrow, an ellipsis, or a turn. */
export function isPull(text: string): boolean {
  const plain = plainText(text).trim();
  if (!plain) return false;
  if (PULL_END.test(plain)) return true;
  return PULL_WORDS.test(lastSentence(plain));
}

/** A last line that asks for something or says what she gets. */
const ACTION = /\b(comment|save|follow|send|share|dm|message|tap|reply|type|get|grab|i'?ll|i will|you'?ll|yours)\b/i;
export function isAction(text: string): boolean {
  return ACTION.test(plainText(text));
}

/* A pull that could sit on any slide teases nothing. These are allowed only
   when the rest of the line names something the next slide is about. */
const STOCK_PULL =
  /\b(the next move|next move|the fix is next|now comes|here'?s where you begin|here is where you begin|keep going|but wait|the next step|one more thing|keep reading|what'?s next|swipe)\b/i;
const FILLER = new Set(
  "a an the is are it its this that to and or so now here here's where you your we i my of for on in with comes come next move fix step steps begin one more thing keep going reading but wait what's swipe".split(" "),
);
const stem = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5);

function contentWords(text: string): string[] {
  return words(plainText(text).toLowerCase().replace(/[^a-z0-9' ]+/g, " ")).filter((word) => !FILLER.has(word) && word.length > 2);
}

/** A stock pull that names nothing on the slide after it. */
export function isStockPull(pull: string, nextSlideText: string): boolean {
  const sentence = lastSentence(pull);
  if (!STOCK_PULL.test(sentence)) return false;
  const next = new Set(contentWords(nextSlideText).map(stem));
  return !contentWords(sentence.replace(STOCK_PULL, " ")).some((word) => next.has(stem(word)));
}

/** Money talk is an earnings claim however it is phrased; her account sells a guide, not an income. */
const MONEY =
  /\b(revenue|income|incomes|earn|earns|earned|earning|earnings|make money|making money|made money|monetiz\w*|profit\w*|paycheck|salary|side hustle|passive|cash|sells? while you (?:work|sleep)|money while)\b|\$\s?\d/i;
/** An amount of money in any language: a currency sign or code next to a number, either side. */
const CURRENCY = /[$€£¥]\s?\d[\d.,]*|\d[\d.,]*\s?(?:[$€£¥]|(?:lei|ron|eur|euro|euros|usd|dollars?|dólares|dolari|zł|pln|chf)(?![\p{L}\p{N}]))/iu;

/**
 * The words that make a line money talk.
 *
 * English is checked word by word, as it always was. Other languages get the
 * English list too (loanwords such as "side hustle" and "profit" travel) and
 * any amount with a currency sign or code, but there is no word list in their
 * own language yet: "venit pasiv" passes. Outside English the writer's
 * instruction and the number check hold the line; that gap is known.
 */
export function moneyLanguage(text: string, language?: string): string | null {
  const plain = plainText(text);
  const english = plain.match(MONEY)?.[0] ?? null;
  if (isEnglish(language)) return english;
  return english ?? plain.match(CURRENCY)?.[0] ?? null;
}

const COUNT_WORDS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const PROMISE =
  /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:[a-z]+\s+)?(steps|mistakes|things|ways|tips|lessons|reasons|rules|signs|habits|tools|apps|ideas|hacks|moves|questions|truths|myths|secrets)\b/i;

/** "7 steps", "five mistakes": a count the set then owes the reader. */
export function promisedItems(text: string): { count: number; noun: string } | null {
  const found = plainText(text).match(PROMISE);
  if (!found) return null;
  const count = COUNT_WORDS[found[1].toLowerCase()] ?? Number.parseInt(found[1], 10);
  return count >= 2 ? { count, noun: found[2].toLowerCase() } : null;
}

/** Slides that are neither the cover, her run-on opening nor the keyword slide. */
export function itemCapacity(maxFrames: number, opening: boolean): number {
  return maxFrames - 2 - (opening ? 1 : 0);
}

/** The line a slide ends on, where its pull belongs. On a cover some looks set
    the accent after the sub, so either may carry it. */
function closingLines(slide: CarouselSpec["slides"][number]): string[] {
  switch (slide.type) {
    case "paper":
      return [slide.body];
    case "cover": {
      const lines = [slide.sub, slide.title.accent].filter((line): line is string => Boolean(line));
      return lines.length ? lines : slide.title.lines.slice(-1);
    }
    case "keyword":
      return [slide.promise];
    case "split":
      return [slide.lines[1]];
    case "line":
      return [slide.text];
    case "grid":
      return [slide.sub ?? slide.headline];
  }
}

/**
 * A body is one sentence, but a short pull after it is the rule, not a second
 * point. A pull is recognised by its English words, so outside English any
 * short last sentence is given the benefit of the doubt.
 */
function sentenceCount(body: string, language?: string): number {
  const sentences = sentencesOf(body, language).map((part) => part.trim()).filter(Boolean);
  const last = sentences[sentences.length - 1];
  if (sentences.length > 1 && last && (isPull(last) || !isEnglish(language)) && words(last).length <= 8) return sentences.length - 1;
  return sentences.length;
}

export function checkSpec(spec: CarouselSpec, sources: CheckSources): Problem[] {
  // Her own slides are hers: the rules below are for the writer's words.
  if (spec.ownSlides) return [];
  const problems: Problem[] = [];
  const add = (slide: number | null, rule: string, detail: string) => problems.push({ slide, rule, detail });
  const allowed = allowedNumbers(sources);
  const sourceVague = new Set(vagueWords(sourceText(sources)));
  const language = contentLanguage(sources.profile);
  /* The limits were tuned on English. A language that spends more words on
     the same thought gets a little more room; English keeps its own. */
  const limit = (value: number) => widenLimit(value, language);

  const frame = FORMATS[spec.format];
  if (spec.slides.length < frame.minFrames || spec.slides.length > frame.maxFrames) {
    add(null, "frame-count", `a ${spec.format} needs ${frame.minFrames}-${frame.maxFrames} frames, this has ${spec.slides.length}`);
  }

  if (spec.caption.includes("\n")) add(null, "caption-one-line", "the caption must be a single line");
  if (spec.caption.length > limit(CAPTION_MAX_CHARS)) {
    add(null, "caption-one-line", `the caption is ${spec.caption.length} characters, keep it under ${limit(CAPTION_MAX_CHARS)}`);
  }

  spec.slides.forEach((slide, index) => {
    const number = index + 1;
    // A long pinned cover runs on into slide 2 in her words; their length is hers.
    const herOpening = index === 1 && Boolean(sources.fixedCover) && sources.coverSplit !== false;
    const title = slideTitle(slide);
    if (title) {
      const titleWords = title.lines.reduce((total, line) => total + countWords(line), 0);
      const hers = index === 0 && slide.type === "cover" && Boolean(sources.fixedCover);
      if (slide.type === "cover" && titleWords > limit(COVER_TITLE_MAX_WORDS) && !hers) {
        add(number, "cover-title-length", `the cover title is ${titleWords} words, the limit is ${limit(COVER_TITLE_MAX_WORDS)}`);
      }
      title.lines.forEach((line, lineIndex) => {
        const count = countWords(line);
        if (hers || herOpening) return;
        if (count < 1 || count > limit(TITLE_LINE_MAX_WORDS)) {
          add(number, "title-line-length", `title line ${lineIndex + 1} ("${plainText(line)}") has ${count} words, allowed 1-${limit(TITLE_LINE_MAX_WORDS)}`);
        }
      });
      const emphasised = title.lines.flatMap(emphasisWords);
      if (emphasised.length > MAX_EMPHASIS_WORDS) {
        add(number, "emphasis-count", `${emphasised.length} emphasised words (${emphasised.join(", ")}), at most ${MAX_EMPHASIS_WORDS}`);
      }
    }

    if (slide.type === "paper" && !herOpening) {
      const count = words(slide.body).length;
      if (count > limit(BODY_MAX_WORDS)) add(number, "body-length", `the sentence is ${count} words, keep it under ${limit(BODY_MAX_WORDS)}`);
      if (sentenceCount(slide.body, language) > 1) {
        add(number, "body-one-sentence", `"${slide.body}" is more than one sentence`);
      }
    }

    if (slide.type === "split") {
      slide.lines.forEach((line, half) => {
        const count = words(line).length;
        if (count > limit(SPLIT_LINE_MAX_WORDS)) {
          add(number, "photo-line-length", `the ${half === 0 ? "top" : "bottom"} line ("${line}") is ${count} words, keep it to ${limit(SPLIT_LINE_MAX_WORDS)}`);
        }
      });
    }
    if (slide.type === "line") {
      const count = words(slide.text).length;
      if (count > limit(PHOTO_LINE_MAX_WORDS)) add(number, "photo-line-length", `the line is ${count} words, keep it to ${limit(PHOTO_LINE_MAX_WORDS)}`);
      if ((slide.text.match(/[.!?](\s|$)/g) ?? []).length > 1) add(number, "body-one-sentence", `"${slide.text}" is more than one sentence`);
    }
    if (slide.type === "grid") {
      const hers = index === 0 && Boolean(sources.fixedCover);
      const headline = words(slide.headline).length;
      if (headline > limit(GRID_HEADLINE_MAX_WORDS) && !hers) {
        add(number, "grid-title-length", `the cover title is ${headline} words, the limit is ${limit(GRID_HEADLINE_MAX_WORDS)}`);
      }
      const sub = slide.sub ? words(slide.sub).length : 0;
      if (sub > limit(GRID_SUB_MAX_WORDS) && !hers) add(number, "grid-title-length", `the line under the cover title is ${sub} words, the limit is ${limit(GRID_SUB_MAX_WORDS)}`);
    }

    for (const line of slideText(slide)) {
      const money = moneyLanguage(line, language);
      if (money && !isHers(line, index, sources)) {
        add(number, "money-language", `"${plainText(line)}" talks about money ("${money}"); no income, revenue or earnings language anywhere in the set`);
      }
      for (const sentence of sentencesOf(plainText(line), language)) {
        if (isHerSentence(sentence, index, sources)) continue;
        for (const value of [...numberValues(sentence, language), ...spelledValues(sentence)]) {
          if (!traceable(value, allowed)) {
            add(number, "unsupported-number", `"${plainText(line)}" uses a number (${value.toLocaleString("en-US")}) that is not in the proof points or the story; cut it or use one that is`);
          }
        }
        for (const word of vagueWords(sentence)) {
          if (!sourceVague.has(word)) {
            add(number, "unsupported-number", `"${plainText(line)}" claims a quantity ("${word}") the proof points and story never state; cut it`);
          }
        }
      }
    }
  });

  const last = spec.slides[spec.slides.length - 1];
  if (!last || last.type !== "keyword") {
    add(spec.slides.length, "keyword-last", "the last slide must be the keyword slide");
  } else if (brandOff(sources.profile)) {
    // Written without her brand: there is no keyword to comment, only a generic ask.
    if (!last.action) add(spec.slides.length, "keyword-word", `this set is written without her brand: the last slide asks the reader to save, share or follow, not to comment "${last.keyword}"`);
  } else if (!last.action && last.keyword.trim().toLowerCase() !== sources.profile.keyword.trim().toLowerCase()) {
    add(spec.slides.length, "keyword-word", `the keyword slide says "${last.keyword}", the profile keyword is "${sources.profile.keyword}"`);
  }

  const money = moneyLanguage(spec.caption, language);
  if (money) add(null, "money-language", `the caption talks about money ("${money}"); take it out`);

  checkPulls(spec, sources, add);
  checkPromisedCount(spec, sources, add);

  return problems;
}

const normal = (text: string) => plainText(text).toLowerCase().replace(/\s+/g, " ").trim();

/** One sentence of her pinned words, on the cover or at the top of slide 2. */
function isHerSentence(sentence: string, index: number, sources: CheckSources): boolean {
  if (!sources.fixedCover || index > 1) return false;
  if (index === 0) return true;
  const own = normal(sentence).replace(/[.!?]+$/, "");
  return Boolean(own) && normal(sources.coverText ?? "").includes(own);
}

/** Her pinned words, on the cover or at the top of slide 2, are not ours to judge. */
function isHers(line: string, index: number, sources: CheckSources): boolean {
  if (!sources.fixedCover || index > 1) return false;
  if (index === 0) return true;
  const cover = normal(sources.coverText ?? "");
  // Slide 2 is her words then the writer's pull: only what she did not write is judged.
  const found = sentencesOf(plainText(line), sources.profile.language);
  const sentences = found.length ? found : [line];
  return sentences.every((sentence) => !moneyLanguage(sentence, sources.profile.language) || cover.includes(normal(sentence).replace(/[.!?]+$/, "")));
}

function checkPromisedCount(spec: CarouselSpec, sources: CheckSources, add: (slide: number | null, rule: string, detail: string) => void): void {
  const first = spec.slides[0];
  const coverText = sources.fixedCover && sources.coverText ? sources.coverText : first ? slideText(first).join(" ") : "";
  const promised = promisedItems(coverText);
  if (!promised) return;
  const opening = Boolean(sources.fixedCover) && Boolean(sources.coverSplit);
  const items = spec.slides.length - 2 - (opening ? 1 : 0);
  if (promised.count <= items) return;
  const capacity = itemCapacity(FORMATS[spec.format].maxFrames, opening);
  if (promised.count <= capacity) {
    add(null, "promised-count", `the cover promises ${promised.count} ${promised.noun} and the set gives them ${items} slides; give each its own slide, ${promised.count} in all`);
  } else if (!sources.fixedCover) {
    add(1, "promised-count", `the cover promises ${promised.count} ${promised.noun} but a ${spec.format} holds at most ${capacity}; promise no more than ${capacity}`);
  }
}

function checkPulls(spec: CarouselSpec, sources: CheckSources, add: (slide: number | null, rule: string, detail: string) => void): void {
  /* A half-and-half or grid set reads as pairs and list items over photos;
     the swipe comes from the pictures, and an arrow on every line would read
     as a sales deck. The pull rule is for sets that argue. */
  if (spec.layout === "split" || spec.layout === "grid") return;
  /* A pull, a stock pull and an ask are recognised by English words. In
     another language a plain turn would read as flat and a good set would be
     sent back for repairs it cannot make, so those three rules are English
     only; the writer is told the rule, and repeats are still caught. */
  const english = isEnglish(sources.profile.language);
  const seen = new Map<string, number>();
  const shapes = new Map<string, number[]>();
  spec.slides.forEach((slide, index) => {
    if (index === spec.slides.length - 1) return;
    // Her pinned cover is hers; it is not ours to call flat.
    if (index === 0 && sources.fixedCover) return;
    const closing = closingLines(slide);
    if (english && !closing.some(isPull)) {
      add(
        index + 1,
        "no-pull",
        `the slide ends on a flat statement ("${plainText(closing[closing.length - 1] ?? "")}"); end it on a pull to the next slide: a question, a turn, or a line like "Here's how →"`,
      );
      return;
    }
    const pull = closing.find(isPull) ?? (english ? "" : (closing[closing.length - 1] ?? ""));
    for (const [shape, matches] of Object.entries(SHAPES)) {
      if (matches(lastSentence(pull))) shapes.set(shape, [...(shapes.get(shape) ?? []), index + 1]);
    }
    const after = spec.slides[index + 1];
    if (english && after && isStockPull(pull, slideText(after).join(" "))) {
      add(index + 1, "stock-pull", `"${lastSentence(pull)}" could sit on any slide; tease what slide ${index + 2} is actually about, or end on a question`);
    }
    const key = english
      ? lastSentence(pull).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()
      : lastSentence(pull).toLocaleLowerCase(localeFor(sources.profile.language)).replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
    const earlier = seen.get(key);
    if (key && earlier !== undefined) {
      add(index + 1, "pull-repeated", `this pull ("${lastSentence(pull)}") repeats slide ${earlier}; vary it`);
    } else if (key) seen.set(key, index + 1);
  });
  const overused = [...shapes].filter(([, slides]) => slides.length > MAX_PULLS_PER_SHAPE);
  if (overused.length) {
    const unused = [...Object.keys(SHAPES).filter((shape) => !shapes.has(shape)), ...OTHER_SHAPES];
    for (const [shape, slides] of overused) {
      add(
        null,
        "pull-shape",
        `${slides.length} pulls are ${shape} (slides ${slides.join(", ")}); keep at most ${MAX_PULLS_PER_SHAPE} and rewrite the rest as: ${unused.join("; ")}`,
      );
    }
  }

  const last = spec.slides[spec.slides.length - 1];
  // A generic ask is the slide's big word itself (SAVE); its promise only says why.
  if (english && last?.type === "keyword" && !last.action && !isAction(last.promise)) {
    add(
      spec.slides.length,
      "final-action",
      `the last slide's promise ("${last.promise}") does not ask for anything; say what she gets for commenting ${last.keyword}, or ask her to save or follow`,
    );
  }
}

/** The problem list as the writer sees it in a repair request. */
export function describeProblems(problems: Problem[]): string {
  const lines = problems.map((problem) => `- ${problem.slide ? `slide ${problem.slide}` : "the set"} [${problem.rule}]: ${problem.detail}`);
  // The writer may have taken the number from the REFERENCE block; this is where it learns that does not count.
  if (problems.some((problem) => problem.rule === "unsupported-number")) lines.push(REFERENCE_IS_TECHNIQUE);
  return lines.join("\n");
}

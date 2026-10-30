import { languageField } from "../content/languages";
import { carouselSpecSchema, type CarouselSpec, type Format, type Layout, type Slide, type Title } from "./spec";

/* A set of her own slides, drawn as she wrote them. Pure.
 *
 * When her message gives the slides ("Slide 1: … Slide 2: …", or one quoted
 * line per slide; src/agent/given-words.ts), there is nothing to write: the
 * writer would only rewrite her, and its rules (a keyword slide last, a pull
 * on every slide, no quotation marks) are for its words, not hers. So the set
 * is built here, in code: one slide per text, in her order, every word kept,
 * and nothing after her last slide. Where each text sits (a photo cover, a
 * paper slide, a split) follows the layout, as a written set's does. */

export type GivenOptions = {
  /** Output slug, also the folder name. */
  name: string;
  format: Format;
  layout?: Layout;
  /** Photo references the renderer can resolve, used in order and then again from the first. */
  photoRefs: string[];
  /** Her content language; absent is English. */
  language?: string;
  /** The keyword her set asks for, if she named one: the caption ends on her ask. */
  keyword?: string;
};

/** A headline longer than this many words is not a headline: the whole text is the title. */
const HEADLINE_MAX_WORDS = 12;
/** A title line's comfortable length in words; her lines are kept whole if she broke them herself. */
const LINE_WORDS = 4;
const MAX_LINES = 4;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const wordsOf = (text: string) => oneLine(text).split(" ").filter(Boolean);
/** Title lines take *emphasis*; an odd asterisk would be read as a broken mark, so it is dropped. */
const titleSafe = (text: string) => ((text.match(/\*/g) ?? []).length % 2 === 0 ? text : text.replace(/\*/g, ""));
/** Bodies, subs and photo lines take no markup at all. */
const plain = (text: string) => oneLine(text.replace(/\*/g, ""));

/** Her text as at most four title lines, every word kept: her own breaks when she made four or fewer, else even lines. */
export function givenTitleLines(text: string): string[] {
  const given = text.split(/\r?\n/).map(oneLine).filter(Boolean);
  if (given.length > 1 && given.length <= MAX_LINES) return given;
  const words = wordsOf(text);
  if (!words.length) return [];
  const count = Math.min(MAX_LINES, Math.ceil(words.length / LINE_WORDS));
  const perLine = Math.ceil(words.length / count);
  const lines: string[] = [];
  for (let at = 0; at < words.length; at += perLine) lines.push(words.slice(at, at + perLine).join(" "));
  return lines;
}

/** Her text split the way a slide is read: a short first sentence as the title and the rest under it. Nothing is cut or reworded. */
export function givenParts(text: string): { title: string; rest?: string } {
  const clean = text.trim();
  if (clean.includes("\n")) return { title: clean };
  const sentences = oneLine(clean).match(/[^.!?]+(?:[.!?]+["”')]*|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  if (sentences.length < 2 || wordsOf(sentences[0]).length > HEADLINE_MAX_WORDS) return { title: clean };
  return { title: sentences[0], rest: sentences.slice(1).join(" ") };
}

/** Her text as a split slide's two lines: at her line break, else between sentences, else halfway. */
export function givenPair(text: string): [string, string] | null {
  const lines = text.split(/\r?\n/).map(plain).filter(Boolean);
  if (lines.length >= 2) return [lines[0], lines.slice(1).join(" ")];
  const { title, rest } = givenParts(text);
  if (rest) return [plain(title), plain(rest)];
  const words = wordsOf(plain(text));
  if (words.length < 2) return null;
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
}

/** The caption posted with the set: her first slide, and her ask when her last slide makes one. */
export function givenCaption(texts: string[], keyword?: string): string {
  const first = plain(texts[0] ?? "");
  const last = plain(texts[texts.length - 1] ?? "");
  const asks = keyword ? new RegExp(`(?<![\\p{L}\\p{N}])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(last) : false;
  if (!asks || texts.length < 2) return first;
  return /[.!?:…]$/.test(first) ? `${first} ${last}` : `${first}. ${last}`;
}

/**
 * Her slides as a spec, one slide per text, in her order and in her words
 * (her case kept, even in a kit that sets titles in caps). Throws, as the
 * schema does, when the texts cannot make a set of this format.
 */
export function givenSpec(texts: string[], options: GivenOptions): CarouselSpec {
  const refs = options.photoRefs;
  if (!refs.length) throw new Error("No photos were supplied for her slides.");
  let photoIndex = 0;
  const nextPhoto = () => refs[photoIndex++ % refs.length];
  const title = (text: string): Title => ({ lines: givenTitleLines(titleSafe(text)), asTyped: true });

  const pairs = texts.map(givenPair);
  // A split set needs two lines on every slide; a text that cannot make two goes on a photo of its own instead.
  const layout: Layout = options.layout === "split" && pairs.some((pair) => !pair) ? "photos" : (options.layout ?? "mixed");

  const slides = texts.map((text, index): Slide => {
    if (layout === "split") {
      const [top, bottom] = pairs[index]!;
      return { type: "split", photos: [nextPhoto(), nextPhoto()], lines: [top, bottom] };
    }
    if (layout === "grid") {
      if (index === 0) {
        const { title: head, rest } = givenParts(text);
        return { type: "grid", photos: [nextPhoto(), nextPhoto(), nextPhoto(), nextPhoto()], headline: plain(head), ...(rest ? { sub: plain(rest) } : {}) };
      }
      return { type: "line", photo: nextPhoto(), text: plain(text) };
    }
    const { title: head, rest } = givenParts(text);
    // In a mixed set a slide that says two things sits on paper, its headline over its sentence; the rest are on photos.
    if (layout === "mixed" && index > 0 && rest) return { type: "paper", title: title(head), body: plain(rest) };
    return { type: "cover", photo: nextPhoto(), title: title(head), ...(rest ? { sub: plain(rest) } : {}) };
  });

  return carouselSpecSchema.parse({
    version: 1,
    name: options.name,
    format: options.format,
    layout,
    caption: givenCaption(texts, options.keyword),
    ...languageField(options.language),
    ownSlides: true,
    slides,
  });
}

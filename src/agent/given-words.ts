import { FORMATS } from "@/carousel/spec";
import { brandOff } from "@/content/brand-scope";
import type { BrandProfile } from "@/content/hooks";

import { hookLevel } from "./hook-level";
import type { AgentRequest } from "./plan";

/* The words she wrote for the screen, read off her message in code. Pure.
 *
 * "A 7-slide carousel. Slide 1: How a post turns into a sale. Slide 2: …
 * Last slide: Comment CASH and I'll send it to you." is not a topic to write
 * a set about: it is the set. The reader (a model) used to put those lines in
 * `reference` (a model for shape, rewritten) or the whole message in `exact`
 * (drawn as the cover, with the rest run on to slide 2), and the writer then
 * closed the set on her brand's keyword. Here her slides are found in her own
 * message, labels stripped, and the run draws them word for word, in order,
 * with nothing added after her last one.
 *
 * The same goes for a keyword she names ("Comment CASH"): it is the one the
 * post asks for, in place of her brand's. */

/* "Slide 3:", "slide #3 -", "Frame 2:": a numbered label, anywhere. */
const NUMBERED = String.raw`(?:slide|frame|card)\s*#?\s*(\d{1,2})`;
/* "Last slide:", "Final slide -". */
const LAST = String.raw`(?:last|final|closing)\s+(?:slide|frame|card)`;
/* "Cover:" only where a line or sentence starts, so "to cover: the basics" is not a label. */
const COVER = String.raw`(?:(?<=(?:^|[\n.!?])\s{0,3}(?:[-*•]\s{0,3})?)cover(?:\s+slide)?)`;
const SEPARATOR = String.raw`\s*(?::|[-–—](?=\s))\s*`;
const LABEL = new RegExp(`(?<![\\p{L}\\p{N}])(?:${NUMBERED}|(${LAST})|(${COVER}))${SEPARATOR}`, "giu");

/* A line that is nothing but a quotation, maybe after a bullet or a number. */
const QUOTED_LINE = /^\s*(?:[-*•]|\d{1,2}[.)])?\s*["“]([^"“”]+)["”]\s*[,.;]?\s*$/u;

const flat = (text: string) => text.replace(/[ \t]+/g, " ").trim();

/** A slide's words as she wrote them, without the quotes around them or the comma before the next label. */
function cleanSlide(raw: string): string {
  // A blank line ends the slide: what follows it is an instruction, not slide text.
  const text = raw.split(/\n\s*\n/)[0] ?? "";
  const lines = text.split(/\r?\n/).map(flat).filter(Boolean).join("\n");
  const unquoted = /^["“][^"“”]*["”]$/u.test(lines) ? lines.slice(1, -1).trim() : lines;
  return unquoted.replace(/\s*[,;]$/, "").trim();
}

/**
 * Her slide texts, in order, labels stripped, or null when she gave none.
 * Labelled slides ("Slide 1: …", "Cover: …", "Last slide: …") or two or more
 * lines that are each a quotation. A message that asks for her version of
 * someone else's set ("make my version of this") is a model, not her words.
 */
export function givenSlides(message: string): string[] | null {
  if (hookLevel(message) === "shape") return null;
  const labelled = labelledSlides(message);
  if (labelled) return labelled;
  const quoted = message
    .split(/\r?\n/)
    .map((line) => QUOTED_LINE.exec(line)?.[1]?.trim())
    .filter((line): line is string => Boolean(line));
  return quoted.length >= 2 ? quoted : null;
}

type Found = { order: number; at: number; text: string };

function labelledSlides(message: string): string[] | null {
  const matches = [...message.matchAll(LABEL)];
  if (matches.length < 2) return null;
  const found: Found[] = matches.map((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? message.length;
    // Her numbers set the order; the cover is first and the last slide last, wherever she wrote them.
    const order = match[1] ? Number(match[1]) : match[2] ? Number.MAX_SAFE_INTEGER : 0;
    return { order, at: index, text: cleanSlide(message.slice(start, end)) };
  });
  const slides = found
    .filter((slide) => slide.text)
    .sort((a, b) => a.order - b.order || a.at - b.at)
    .map((slide) => slide.text);
  return slides.length >= 2 ? slides : null;
}

/** True when this text carries a slide label: the request itself, not words for a slide. */
export function hasSlideLabel(text: string): boolean {
  LABEL.lastIndex = 0;
  const found = LABEL.test(text);
  LABEL.lastIndex = 0;
  return found;
}

/* Words that follow "comment" or "DM me" without being a keyword. */
const NOT_KEYWORDS = new Set(["ME", "US", "IT", "BELOW", "HERE", "NOW", "THE", "A", "AN", "AND", "OR"]);
const ASK = /(?<![\p{L}\p{N}])(?:comment|type|reply|dm(?:\s+me)?|message\s+me|(?:cta\s+)?keyword(?:\s+is)?\s*:?)\s+(?:the\s+word\s+)?(["“'‘])?([\p{L}\p{N}]{2,20})(["”'’])?(?![\p{L}\p{N}])/giu;

/**
 * The comment keyword she named, as she wrote it, or null. Only a word in
 * capitals ("Comment CASH") or in quotes ("comment 'cash'") counts, so
 * "comment below" and "keyword is in the caption" do not.
 */
export function ctaKeyword(message: string): string | null {
  for (const match of message.matchAll(ASK)) {
    const word = match[2];
    const quoted = Boolean(match[1] && match[3]);
    const capitals = word === word.toLocaleUpperCase() && /\p{L}/u.test(word);
    if (!quoted && !capitals) continue;
    if (NOT_KEYWORDS.has(word.toLocaleUpperCase())) continue;
    return word;
  }
  return null;
}

/* "On-screen text: …", "Text on screen: …", "Hook: …": her words for the screen. */
const SCREEN_LABEL = /(?<![\p{L}\p{N}])(?:on[- ]?screen text|text on screen|on[- ]?screen|overlay text|text overlay|hook)\s*:\s*/iu;

/**
 * The words she labelled for the screen, or null. A quotation right after the
 * label is taken as it is; otherwise the rest of that line.
 */
export function labelledScreenText(message: string): string | null {
  const match = SCREEN_LABEL.exec(message);
  if (!match) return null;
  const after = message.slice((match.index ?? 0) + match[0].length);
  const quoted = /^["“]([^"“”]+)["”]/u.exec(after);
  const text = quoted ? quoted[1] : (after.split(/\r?\n/)[0] ?? "");
  return flat(text) || null;
}

/**
 * The keyword a reel's second line may ask for: none with her brand off;
 * hers if she named one; none when the words on screen are hers; else the
 * profile's (already hers, through `withKeyword`, when she named one).
 */
export function cueKeyword(request: Extract<AgentRequest, { kind: "reel" }>, profile: Pick<BrandProfile, "keyword" | "brandOff">): string {
  if (brandOff(profile)) return "";
  if (request.keyword) return request.keyword;
  return request.hook?.trim() ? "" : profile.keyword;
}

/** True when the reader's cover is really her request: a slide label in it, or the whole message about a carousel. */
function isTheRequest(cover: string, message: string): boolean {
  if (hasSlideLabel(cover)) return true;
  const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
  return /\b(carousel|slides)\b/i.test(cover) && squash(cover).length >= squash(message).length * 0.8;
}

export type GivenWords = { kind: "run"; request: AgentRequest } | { kind: "chat"; reply: string };

/**
 * The request with her own words put where they go: her slides as the set's
 * slides, her keyword as the post's, her labelled words as the reel's hook or
 * the photo's words. A set with more slides than its format holds is answered
 * in words rather than cut short.
 */
export function withGivenWords(request: AgentRequest, message: string): GivenWords {
  const keyword = ctaKeyword(message) ?? undefined;
  const screen = labelledScreenText(message) ?? undefined;
  switch (request.kind) {
    case "carousel": {
      const slides = givenSlides(message);
      if (!slides) {
        const leak = request.cover !== undefined && isTheRequest(request.cover, message);
        const { cover, ...rest } = request;
        return { kind: "run", request: { ...rest, ...(cover && !leak ? { cover } : {}), ...(keyword ? { keyword } : {}) } };
      }
      const most = FORMATS[request.format].maxFrames;
      if (slides.length > most) {
        return {
          kind: "chat",
          reply: `A ${request.format === "story" ? "story sequence" : "carousel"} holds up to ${most} slides, and you wrote ${slides.length}. Send it again with ${most} or fewer.`,
        };
      }
      // Her slides are the set: no cover to pin, no one else's set to follow, nothing for the writer to write.
      const { cover: _cover, coverTemplate: _template, reference: _reference, ...rest } = request;
      void _cover;
      void _template;
      void _reference;
      return { kind: "run", request: { ...rest, slideTexts: slides, slides: slides.length, ...(keyword ? { keyword } : {}) } };
    }
    case "reel": {
      const hook = request.hook ?? (screen && !request.template ? screen : undefined);
      return { kind: "run", request: { ...request, ...(hook ? { hook } : {}), ...(keyword ? { keyword } : {}) } };
    }
    case "photos": {
      const drawn = Boolean(request.words?.trim() || request.wordsLike?.trim() || request.wordsBrief?.trim());
      if (!drawn || !screen || request.words?.trim()) return { kind: "run", request };
      const { wordsLike: _like, wordsBrief: _brief, ...rest } = request;
      void _like;
      void _brief;
      return { kind: "run", request: { ...rest, words: screen } };
    }
    case "text_photo":
      return { kind: "run", request: !request.words.trim() && screen ? { ...request, words: screen, wordsBrief: undefined } : request };
  }
}

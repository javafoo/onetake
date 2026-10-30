import { creditsWord } from "@/billing/gate";
import { normalizeTextStyle } from "@/content/text-styles";

import { agentCredits, drawsWords, type AgentRequest, type SceneIdea } from "./plan";
import { asksForTextOnPhoto, MAX_WORDS_CHARS, pointsAtMissingWords, quotedWords, TEXT_PHOTO_NEEDS_WORDS, wordsForTextPhoto } from "./text-photo";

/* A new photo of her like a screenshot, with the screenshot's words on it.
 * Pure.
 *
 * The founder's case: she pasted a quote post (a close crop of someone's
 * sweaty chest in a sports top, white words over it) and asked for "a photo of
 * maya like this, working out, sweaty, same angle, with the words on it".
 * Words on a photo need a photo of hers; with none attached the agent used to
 * ask for one. Now a request for a NEW photo like a screenshot is a photo run
 * with one more step: the words drawn on a copy of the photo it made.
 *
 * Which words: the screenshot's, exactly, unless she asks for her own ("a
 * quote like this", "my own words"), when the writer makes a line of about the
 * same length and shape in her voice. Quoted words in her message win. */

/** She asks for a new picture, not words on one she has. */
const NEW_PHOTO = /\b(photo|picture|pic|image|selfie|shot)\b/i;
/** …modelled on the screenshot. */
const LIKE_THIS =
  /\blike (this|that|it|the (screenshot|one|post|picture|photo|image|pic))\b|\bsame (vibe|angle|pose|framing|crop|shot|look|style|feel|energy|composition)\b|\b(just )?like the (screenshot|post)\b|\binspired by (this|that|the screenshot)\b/i;
/** "without the words", "no text", "just the photo": the photo alone. */
const NO_WORDS = /\b(without|no|minus|leave out|drop) (the |any )?(words|text|quote|caption|writing)\b|\bjust the (photo|picture|image)\b/i;
/** "a quote like this", "my own words", "in my voice": her own line, shaped like theirs. */
const OWN_WORDS =
  /\b(a|an|some|another|similar|different|new) (quote|line|caption|words?|text) (like|similar to) (this|that|it|theirs|the one)\b|\bmy own (words|quote|line|caption|text|version of the (quote|words|text))\b|\bin my (own )?(words|voice)\b|\bmy version of the (quote|words|text|line)\b|\b(write|make) (me )?(a|my|one|her) (own )?(quote|line|caption)\b|\bher own (words|quote|line)\b|\bin her (own )?(words|voice)\b/i;

export type PhotoWordsLevel = "exact" | "own" | "none";

/** She asked for a new photo of her like the screenshot. Needs the screenshot; checked by the caller. */
export function asksForPhotoLikeThis(message: string): boolean {
  return NEW_PHOTO.test(message) && LIKE_THIS.test(message);
}

/** Which words go on the new photo: the screenshot's, her own like them, or none. */
export function photoWordsLevel(message: string): PhotoWordsLevel {
  if (quotedWords(message)) return "exact";
  if (NO_WORDS.test(message)) return "none";
  if (OWN_WORDS.test(message)) return "own";
  return "exact";
}

export const PHOTO_WORDS_REPLY = "Making one photo of her like the screenshot, then putting the words on a copy of it.";
export const PHOTO_LIKE_REPLY = "Making one photo of her like the screenshot.";

type Reading = {
  message: string;
  /** What the reader classed the message as. */
  kind: string;
  /** The words the reader found on the screenshot, or "". */
  words: string;
  brief: string;
  /** The screenshot's camera angle, distance, crop and pose, or "". */
  framing: string;
  style: string;
  screenshots: number;
  /** Library photos attached with +: with one, words go on hers instead. */
  photos: number;
};

type PhotoRequest = Extract<AgentRequest, { kind: "photos" }>;

/**
 * A new photo like her screenshot, with its words or her own like them, or
 * null when this message is something else. Only with a screenshot, no photo
 * of hers attached, and a reading of photos or words on a photo: a reel or a
 * carousel "like this" stays what the reader said.
 */
export function photoLikeScreenshot(reading: Reading): { kind: "run"; request: PhotoRequest; reply: string } | { kind: "chat"; reply: string } | null {
  if (reading.screenshots === 0 || reading.photos > 0) return null;
  if (reading.kind !== "photos" && reading.kind !== "text_photo") return null;
  const framing = reading.framing.trim();
  if (!asksForPhotoLikeThis(reading.message) && !(reading.kind === "photos" && framing)) return null;

  const brief = withFramingLine(reading.brief.trim() || reading.message.trim().slice(0, 300), framing);
  const base: PhotoRequest = { kind: "photos", brief, count: 1, mode: "one", ...(framing ? { framing } : {}) };
  const level = photoWordsLevel(reading.message);
  const words = level === "none" ? null : wordsForTextPhoto(reading.message, reading.words, true);
  if (!words) return { kind: "run", request: base, reply: PHOTO_LIKE_REPLY };
  if (words.length > MAX_WORDS_CHARS) return { kind: "chat", reply: `That is a lot of words for one photo. Keep them under ${MAX_WORDS_CHARS} characters, or make a carousel instead.` };
  const style = normalizeTextStyle(reading.style);
  return {
    kind: "run",
    request: { ...base, style, ...(level === "own" ? { wordsLike: words } : { words }) },
    reply: level === "own" ? "Making one photo of her like the screenshot, then writing a line in her voice like that one and putting it on a copy." : PHOTO_WORDS_REPLY,
  };
}

/** The brief with the framing said once, so the planner sees it even if the reader left it out. */
function withFramingLine(brief: string, framing: string): string {
  if (!framing || brief.toLowerCase().includes(framing.toLowerCase())) return brief;
  return `${brief} Framing: ${framing}`;
}

/** A photos request that ends with words drawn on the photo it made. */
export function photoWithWords(request: AgentRequest): request is PhotoRequest & ({ words: string } | { wordsLike: string } | { wordsBrief: string }) {
  return request.kind === "photos" && drawsWords(request);
}

/**
 * Every planned scene carries the screenshot's framing in the same words, so
 * the photo prompt writer cannot lose the angle and the crop she asked for.
 */
export function withFraming(scenes: SceneIdea[], framing: string | undefined): SceneIdea[] {
  const text = framing?.trim();
  if (!text) return scenes;
  return scenes.map((scene) =>
    scene.idea.toLowerCase().includes(text.toLowerCase()) ? scene : { ...scene, idea: `${scene.idea.replace(/[.\s]+$/, "")}. Framing, as in her reference: ${text}` },
  );
}

/* A quote post with no photo of hers attached. Pure.
 *
 * The founder's case (2026-10-05): "make me a quote post about preparing for
 * the new year" and "add this quote: “…”", nothing attached, were each made
 * into an eight-slide carousel. A quote post is one picture with words on it:
 * one new photo of her that suits the quote, and the quote drawn on a copy.
 * The reader says whether she asked for words on the picture (`quote`); this
 * decides the words in code, as words on her own photo does: hers when she
 * gave them, else a line written in her voice on the subject she named. */

export const QUOTE_PHOTO_REPLY = "Making one photo of her that suits the quote, then putting the quote on a copy of it.";
export const QUOTE_PHOTO_WRITE_REPLY = "Making one photo of her, writing a quote in your voice and putting it on a copy of the photo.";
const NO_WRITING = "The picture itself has no writing on it.";

type QuoteReading = {
  message: string;
  kind: string;
  /** The reader's call: she wants words drawn on the picture. */
  quote: boolean;
  words: string;
  /** What the quote says or is about: what the writer is given when she gave no quote. */
  brief: string;
  /** The picture that suits the quote, or "". */
  scene?: string;
  style: string;
  screenshots: number;
  photos: number;
};

/**
 * One new photo with her quote on a copy, the question that stands in its
 * way, or null when this message is something else. Never with a photo of
 * hers attached (that is words on her photo), never for a carousel she asked
 * for, and never when she points at a photo of hers she forgot to attach
 * ("add this quote to this photo"): that one is asked for, not replaced.
 */
export function quotePhotoFromReading(reading: QuoteReading): { kind: "run"; request: PhotoRequest; reply: string } | { kind: "chat"; reply: string } | null {
  if (reading.photos > 0 || pointsAtHerPhoto(reading.message)) return null;
  if (!((reading.kind === "photos" && reading.quote) || reading.kind === "text_photo")) return null;
  const about = reading.brief.trim() || reading.message.trim().slice(0, 300);
  // The planner reads the picture too; the quote's writer reads only what the quote is about.
  const scene = reading.scene?.trim();
  const brief = scene ? withLine(about, `The photo: ${scene}`) : about;
  const style = normalizeTextStyle(reading.style);
  const base = { kind: "photos" as const, count: 1, mode: "one" as const, style };
  const words = wordsForTextPhoto(reading.message, reading.words, reading.screenshots > 0);
  if (!words) {
    // "Add this quote" with nothing quoted points at words that are not here: hers to give.
    if (pointsAtMissingWords(reading.message) && reading.screenshots === 0) return { kind: "chat", reply: TEXT_PHOTO_NEEDS_WORDS };
    return { kind: "run", request: { ...base, brief: withLine(brief, NO_WRITING), wordsBrief: about }, reply: QUOTE_PHOTO_WRITE_REPLY };
  }
  if (words.length > MAX_WORDS_CHARS) return { kind: "chat", reply: `That is a lot of words for one photo. Keep them under ${MAX_WORDS_CHARS} characters, or make a carousel instead.` };
  return { kind: "run", request: { ...base, brief: sceneForQuote(brief, words), words }, reply: QUOTE_PHOTO_REPLY };
}

/** "this photo", "my picture", "put it on the photo": a photo of hers she meant to attach, however long the quote before it. */
const HER_PHOTO = /\b(this|that|my|her|the)\s+(photo|picture|pic|image|selfie)\b/i;

export function pointsAtHerPhoto(message: string): boolean {
  return asksForTextOnPhoto(message) || HER_PHOTO.test(message.replace(/["“][^"“”]*["”]/g, " "));
}

/**
 * The brief the scene planner reads for a photo that carries a quote: the
 * quote said once, so the picture fits what it says, and no writing in the
 * picture itself, since the words are drawn on a copy afterwards.
 */
export function sceneForQuote(brief: string, words: string): string {
  const quote = words.replace(/\s+/g, " ").trim();
  const said = brief.replace(/\s+/g, " ").includes(quote);
  return withLine(said ? brief : withLine(brief, `The picture suits the quote drawn on it afterwards: “${quote}”`), NO_WRITING);
}

/** A sentence added once, after a full stop. */
function withLine(brief: string, line: string): string {
  if (brief.includes(line)) return brief;
  const text = brief.trim();
  return text ? `${/[.!?”"]$/.test(text) ? text : `${text}.`} ${line}` : line;
}

/** The run's reply with its price: the photo's credits from the price list, the words free. */
export function withPhotoPrice(request: AgentRequest, reply: string): string {
  if (!photoWithWords(request)) return reply;
  return `${reply.trim()} It costs ${creditsWord(agentCredits(request))} for the photo; the words are free.`;
}

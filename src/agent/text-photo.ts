import { normalizeTextStyle } from "@/content/text-styles";

import type { AgentRequest } from "./plan";

/* Words on her own photo, read off a message. Pure.
 *
 * "add this quote to this photo", "put this on the photo", "write X on it":
 * her photo, attached with +, and her words drawn on it. Never a new photo.
 * The reader (a model) says whether that is what she asked and copies the
 * words it found; this decides which words are hers, in code, so her exact
 * text never rests on the model's copy of it when her message already has it. */

/** She asked for words on a photo: a verb that puts words somewhere and a picture to put them on. */
const ON_PHOTO =
  /\b(add|put|write|place|overlay|type|stick|slap|caption)\b[\s\S]{0,80}?\b(on(to)?|over|to|across|in)\s+(this|that|the|my|her|it\b)\s*(photo|picture|pic|image|selfie|one)?\b/i;
/** …and what goes on it is words, not a thing in the scene ("put a hat on her"). */
const WORDS = /\b(quote|text|words?|caption|line|lines|title|hook|this|that|it)\b|["“]/i;

export function asksForTextOnPhoto(message: string): boolean {
  const match = ON_PHOTO.exec(message);
  if (!match) return false;
  // "write X on it" is words whatever X is; "add/put …" needs the thing to be words.
  if (/^(write|type|caption|overlay)$/i.test(match[1])) return true;
  return WORDS.test(match[0]);
}

/** The words she put in quotes, exactly as typed. The longest quotation wins; none is null. */
export function quotedWords(message: string): string | null {
  const found = [...message.matchAll(/["“]([^"“”]+)["”]/g)].map((match) => match[1].trim()).filter(Boolean);
  if (!found.length) return null;
  return found.reduce((longest, next) => (next.length > longest.length ? next : longest));
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();

/** The stretch of her message that says what the reader read, in her own case and line breaks, or null. */
function inHerMessage(message: string, read: string): string | null {
  const wanted = squash(read).replace(/^["“]+|["”]+$/g, "");
  if (!wanted) return null;
  /* Walk her message word by word so the slice keeps her own spacing and
     line breaks, not the reader's. */
  const tokens = [...message.matchAll(/\S+/g)];
  for (let start = 0; start < tokens.length; start++) {
    let joined = "";
    for (let end = start; end < tokens.length; end++) {
      joined = joined ? `${joined} ${tokens[end][0].toLowerCase()}` : tokens[end][0].toLowerCase();
      if (joined.length > wanted.length + 2) break;
      if (joined.replace(/^["“]+|["”]+$/g, "") === wanted) {
        const from = tokens[start].index ?? 0;
        const last = tokens[end];
        return message.slice(from, (last.index ?? 0) + last[0].length).replace(/^["“]+|["”]+$/g, "").trim();
      }
    }
  }
  return null;
}

/**
 * The words that go on the photo, or null when there are none yet.
 *
 * Quoted words in her message win, as typed. Otherwise what the reader found:
 * taken from her own message when it is there (typed after the ask), so her
 * case and breaks survive; else, with a screenshot attached, the reader's copy
 * of every word on it. With neither, null: the chat asks her for them.
 */
export function wordsForTextPhoto(message: string, read: string | undefined, hasScreenshot: boolean): string | null {
  const quoted = quotedWords(message);
  if (quoted) return quoted;
  const reading = read?.trim();
  if (!reading) return null;
  const typed = inHerMessage(message, reading);
  if (typed) return typed;
  return hasScreenshot ? unwrapScreenshotLines(reading) : null;
}

/**
 * Words read off a screenshot carry that post's own wrapping: where its text
 * box happened to run out of width ("moving like i / should have been…"),
 * which is not a break she chose. Single line breaks are joined with a space so
 * the renderer can break at the pauses; a blank line (a separate block on the
 * post) is kept. Her own typed words never come through here.
 */
export function unwrapScreenshotLines(words: string): string {
  return words
    .split(/\n\s*\n/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean)
    .join("\n\n");
}

/** She points at words that are not here: "add this quote", with nothing quoted and no screenshot. Those are hers to give, not ours to invent. */
const POINTS_AT_WORDS = /\b(this|that|these|those|the following|my|her)\s+(quote|quotes|text|words?|caption|line|lines|title|hook)\b/i;

export function pointsAtMissingWords(message: string): boolean {
  return POINTS_AT_WORDS.test(message);
}

export const TEXT_PHOTO_NEEDS_PHOTO = "Attach the photo with + first, then send this again. I put the words on your own photo; I don't make a new one for this.";
export const TEXT_PHOTO_NEEDS_WORDS = "Which words should go on the photo? Type them in quotes or paste a screenshot of them, or say what they should be about and I'll write them.";

export const TEXT_PHOTO_REPLY = "Putting your words on your photo. Free.";
export const TEXT_PHOTO_WRITE_REPLY = "Writing the words and putting them on your photo. Free.";
/** The longest words one photo takes; the job refuses more. */
export const MAX_WORDS_CHARS = 600;

type Reading = {
  message: string;
  /** What the reader classed the message as. */
  kind: string;
  /** The words the reader found. */
  words: string;
  brief: string;
  style: string;
  screenshots: number;
  /** Library photos attached with +. */
  photos: number;
  /** Her message just before, when it was answered in chat rather than run. */
  lastChat?: { message: string; reply: string } | null;
};

/** "can you write them for me", "you pick", "up to you": the words are left to us. */
const LEAVES_WORDS_TO_US = /\b(write|make|come up with|think of|pick|choose|decide)\b[\s\S]{0,40}\b(them|it|one|some|something|the words|for me)\b|\bup to you\b|\byou (pick|choose|decide)\b|\bsurprise me\b/i;

/** Her answer to our own "which words?" question, asking us to write them: the earlier ask, continued. */
function continuesWordsQuestion(reading: Reading): boolean {
  return Boolean(reading.lastChat && reading.lastChat.reply === TEXT_PHOTO_NEEDS_WORDS && reading.photos > 0 && LEAVES_WORDS_TO_US.test(reading.message));
}

/**
 * Whether this message is words on her photo, and if so the run or the one
 * question that stands in its way. Null when it is something else.
 *
 * Decided in code as well as by the reader: the founder's "add this quote to
 * this photo" was once read as a new photo and charged for one. With her
 * photo attached and a plain ask, it is words on that photo whatever the
 * reader said, unless the reader answered in chat.
 */
export function textPhotoFromReading(reading: Reading):
  | { kind: "run"; request: Extract<AgentRequest, { kind: "text_photo" }>; reply: string; words: string }
  | { kind: "chat"; reply: string }
  | null {
  if (continuesWordsQuestion(reading)) {
    // Written from what she first asked for, which is where she said what the words are about.
    const wordsBrief = reading.lastChat!.message.trim().slice(0, 300);
    return {
      kind: "run",
      request: { kind: "text_photo", brief: wordsBrief, words: "", wordsBrief, style: normalizeTextStyle(reading.style) },
      reply: TEXT_PHOTO_WRITE_REPLY,
      words: "",
    };
  }
  const asked = reading.kind === "text_photo" || (reading.photos > 0 && reading.kind !== "chat" && asksForTextOnPhoto(reading.message));
  if (!asked) return null;
  if (reading.photos === 0) return { kind: "chat", reply: TEXT_PHOTO_NEEDS_PHOTO };
  const words = wordsForTextPhoto(reading.message, reading.words, reading.screenshots > 0);
  if (!words) {
    /* No words given. "Add this quote" points at words that should be here
       and are not: ask for them. Anything else describes the words she wants
       ("a trending, relatable, slightly unhinged life quote") or leaves them
       to us, and the run writes them: she asked once, so it works once. */
    if (pointsAtMissingWords(reading.message) && reading.screenshots === 0) return { kind: "chat", reply: TEXT_PHOTO_NEEDS_WORDS };
    const wordsBrief = (reading.brief.trim() || reading.message.trim()).slice(0, 300);
    return {
      kind: "run",
      request: { kind: "text_photo", brief: wordsBrief, words: "", wordsBrief, style: normalizeTextStyle(reading.style) },
      reply: TEXT_PHOTO_WRITE_REPLY,
      words: "",
    };
  }
  if (words.length > MAX_WORDS_CHARS) return { kind: "chat", reply: `That is a lot of words for one photo. Keep them under ${MAX_WORDS_CHARS} characters, or make a carousel instead.` };
  return {
    kind: "run",
    request: { kind: "text_photo", brief: reading.brief.trim() || reading.message.trim().slice(0, 300), words, style: normalizeTextStyle(reading.style) },
    reply: TEXT_PHOTO_REPLY,
    words,
  };
}

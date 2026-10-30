/* The reel's second line: a short line that pops in once the hook has been
   read. With the agent on, the director decides; with it off, she picks one
   of four in the composer, and it travels as the reel job's `cue`. Pure, and
   safe in the browser. */

import { commentLine, isEnglish, readTheCaption } from "@/content/languages";

export type SecondLine =
  | { kind: "none" }
  | { kind: "caption" }
  | { kind: "comment"; word: string }
  | { kind: "own"; text: string };

export const NO_SECOND_LINE: SecondLine = { kind: "none" };

/** The longest line she may type for her own. */
export const MAX_OWN_LINE = 40;
/** The longest word in "Comment WORD". */
export const MAX_COMMENT_WORD = 20;
/** The longest cue the reel job takes from a form: "Comment " plus the word, or her own line. */
export const MAX_CUE_CHARS = 40;

export const READ_THE_CAPTION = "Read the caption";

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The comment word as it is shown: one word, no punctuation, capitals. */
export function commentWord(raw: string): string {
  return oneLine(raw).split(" ")[0]?.replace(/[^\p{L}\p{N}_-]/gu, "").toUpperCase().slice(0, MAX_COMMENT_WORD) ?? "";
}

/**
 * The words that go on the reel, or undefined for none (or a line left
 * empty). The two stock lines are in her content language, because a viewer
 * reads them; her keyword and her own line are used as she typed them.
 */
export function secondLineText(line: SecondLine, language?: string): string | undefined {
  switch (line.kind) {
    case "none":
      return undefined;
    case "caption":
      return isEnglish(language) ? READ_THE_CAPTION : readTheCaption(language);
    case "comment": {
      const word = commentWord(line.word);
      if (!word) return undefined;
      return isEnglish(language) ? `Comment ${word}` : commentLine(word, language);
    }
    case "own": {
      const text = oneLine(line.text).slice(0, MAX_OWN_LINE);
      return text || undefined;
    }
  }
}

/** What the chip reads. */
export function secondLineLabel(line: SecondLine, language?: string): string {
  return secondLineText(line, language) ?? "None";
}

/** A cue that came in on a form: one line, short, or nothing. */
export function cleanCue(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const text = oneLine(raw);
  return text ? text.slice(0, MAX_CUE_CHARS) : undefined;
}

/**
 * She said there should be no second line. Read off her words as well as by
 * the model, because "just the hook" is a plain instruction that must not be
 * second-guessed.
 */
export function refusesSecondLine(message: string): boolean {
  return /\b(no|without( a| the)?|skip( the)?|don'?t (add|want|put)( a| the)?)\s+(second|2nd)\s+line\b|\bno\s+["“']?read the caption\b|\bjust the hook\b|\bonly the hook\b/i.test(message);
}

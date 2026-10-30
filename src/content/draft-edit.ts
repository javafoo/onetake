import { MAX_SAVED_HOOK_CHARS, MAX_SAVED_HOOK_WORDS } from "../data/hook-rules";
import { InvalidRequestError } from "../lib/errors";
import { countWords } from "../reel/timing";

import { MAX_HOOK_WORDS } from "./hooks";

/* The rules a hand-edited draft has to keep.
 *
 * They are the writer's own rules (`writePosts` at the bottom of ./hooks.ts):
 * a hook that outruns the reel, or a CTA that forgets the keyword, is broken
 * whether a model wrote it or a person did. The writer throws at itself, which
 * is a bug report; this refuses at the person, which is a sentence on a form,
 * so the two say the same thing in different registers.
 *
 * Pure, so the rules can be tested without a database. */

/** The longest caption Instagram will take. */
export const MAX_CAPTION_CHARS = 1500;

export interface DraftEdit {
  hook: string;
  caption: string;
  cta: string;
}

/**
 * The edit as it should be saved, or `InvalidRequestError` saying which field
 * is wrong and why.
 *
 * `keyword` is the brand profile's comment keyword. An account that has not set
 * one yet cannot have its CTA checked against it, so that rule is skipped
 * rather than failing every edit on a half-filled Brand page.
 */
/**
 * The hook rule on its own: a hook she typed is checked here before the writer
 * is paid to fit a caption to it, so a hook too long for a reel costs nothing.
 */
export function checkHook(raw: string): string {
  const hook = raw.trim();
  if (!hook) throw new InvalidRequestError("The hook cannot be empty: it is the only text on screen.");
  const words = countWords(hook);
  if (words > MAX_HOOK_WORDS) {
    throw new InvalidRequestError(
      `The hook is ${words} words. A reel is at most ${MAX_HOOK_WORDS} words, so cut ${words - MAX_HOOK_WORDS}.`,
    );
  }
  return hook;
}

/**
 * A hook as the Hooks page keeps it: any length a person would write, because
 * it is not on a clip yet. Claims are checked where words are written for her,
 * not here.
 */
export function checkSavedHook(raw: string): string {
  const hook = raw.trim();
  if (!hook) throw new InvalidRequestError("Type the hook first.");
  const words = countWords(hook);
  if (words > MAX_SAVED_HOOK_WORDS) throw new InvalidRequestError(`The hook is ${words} words. A saved hook is at most ${MAX_SAVED_HOOK_WORDS}.`);
  if (hook.length > MAX_SAVED_HOOK_CHARS) {
    throw new InvalidRequestError(`The hook is ${hook.length} characters. A saved hook is at most ${MAX_SAVED_HOOK_CHARS.toLocaleString("en-US")}.`);
  }
  return hook;
}

/**
 * The words for a reel made from a clip she attached. Typed words are held to
 * the reel's limit; a saved hook she pinned is not, as with the agent (the
 * renderer shrinks a long hook to fit), and only to the saved-hook limit.
 */
export function checkReelHook(raw: string, pinned: boolean): string {
  return pinned ? checkSavedHook(raw) : checkHook(raw);
}

export function checkDraftEdit(edit: DraftEdit, keyword: string | readonly string[]): DraftEdit {
  const hook = checkHook(edit.hook);
  const caption = edit.caption.trim();
  const cta = edit.cta.trim();

  if (!caption) throw new InvalidRequestError("The caption cannot be empty: it is where the hook is paid off.");
  if (caption.length > MAX_CAPTION_CHARS) {
    throw new InvalidRequestError(
      `The caption is ${caption.length} characters. Instagram takes ${MAX_CAPTION_CHARS.toLocaleString("en-US")}.`,
    );
  }

  // With more than one offer, any of her keywords will do: the post sells one of them.
  const wanted = (typeof keyword === "string" ? [keyword] : keyword).map((word) => word.trim()).filter(Boolean);
  if (wanted.length && !wanted.some((word) => cta.toLowerCase().includes(word.toLowerCase()))) {
    const named = wanted.length === 1 ? `the keyword "${wanted[0]}"` : `one of your keywords (${wanted.join(", ")})`;
    throw new InvalidRequestError(`The call to action has to ask for ${named} by name.`);
  }

  return { hook, caption, cta };
}

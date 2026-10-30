import { matchWords } from "../style/match-words";

import type { PhotoStyle } from "../style/photo-style";

import type { IdentityLock } from "./build";

/* Editing her description after setup. Pure: the fields she typed and the
 * words that may never reach a prompt in, the new lock or a sentence out.
 *
 * Every field is written into every photo prompt word for word, and the
 * subject opens it, so a word the prompt writer may not use would fail every
 * photo from then on. Those are refused here, by name, before anything is
 * saved, rather than discovered one failed photo at a time. The per-avatar
 * list of words that pushed her off-model is kept as it is: it is learned
 * from photos, not typed. */

export type LockEdit = {
  subject: string;
  hair: string;
  skinMakeup: string;
  accessories: string;
  expressions: string;
  /** One item per line. */
  wardrobe: string;
  /** One place per line. */
  scenes: string;
};

/** The longest any one field may be: a description, not an essay a prompt has to carry. */
export const MAX_FIELD_CHARS = 400;
export const MAX_LIST_ITEMS = 12;

const LABEL: Record<keyof LockEdit, string> = {
  subject: "Who she is",
  hair: "Hair",
  skinMakeup: "Face",
  accessories: "Accessories",
  expressions: "Expressions",
  wardrobe: "Wardrobe",
  scenes: "Usual places",
};

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const listOf = (text: string) => text.split(/\r?\n/).map(oneLine).filter(Boolean);

export function lockFromEdit(existing: IdentityLock, edit: LockEdit, neverWords: readonly string[]): { ok: true; lock: IdentityLock } | { ok: false; message: string } {
  const lock: IdentityLock = {
    subject: oneLine(edit.subject),
    hair: oneLine(edit.hair),
    skinMakeup: oneLine(edit.skinMakeup),
    accessories: oneLine(edit.accessories),
    expressions: oneLine(edit.expressions),
    wardrobe: listOf(edit.wardrobe),
    scenes: listOf(edit.scenes),
    bannedWords: existing.bannedWords ?? [],
    ...(existing.photoStyle ? { photoStyle: existing.photoStyle } : {}),
  };

  for (const key of ["subject", "hair", "skinMakeup"] as const) {
    if (!lock[key]) return { ok: false, message: `${LABEL[key]} cannot be empty: it is what keeps her looking like herself.` };
  }
  for (const key of Object.keys(LABEL) as (keyof LockEdit)[]) {
    const value = lock[key];
    const text = Array.isArray(value) ? value.join("\n") : value;
    if (text.length > MAX_FIELD_CHARS * (Array.isArray(value) ? 3 : 1)) {
      return { ok: false, message: `${LABEL[key]} is too long. Keep it to the few things that matter most.` };
    }
    if (Array.isArray(value) && value.length > MAX_LIST_ITEMS) {
      return { ok: false, message: `${LABEL[key]} has ${value.length} lines. Keep it to ${MAX_LIST_ITEMS} or fewer.` };
    }
    const hits = matchWords(text, [...neverWords, ...lock.bannedWords]);
    if (hits.length) {
      return {
        ok: false,
        message: `${LABEL[key]} uses ${hits.map((word) => `“${word}”`).join(", ")}, which photo prompts never use: describe what you see instead, like hair colour or the kind of light. Her look comes from her photos.`,
      };
    }
  }
  return { ok: true, lock };
}

/**
 * Her photo style changed. Every field of the lock is written into every photo
 * prompt, and the two styles forbid different words ("studio" is plain
 * description in an editorial set and a failed prompt in an everyday one), so a
 * switch to a stricter style is refused, by name, if her description already
 * uses one. `neverWords` is the new style's list. Everyday is stored as no field
 * at all, the way every avatar was before there was a choice.
 */
export function lockWithStyle(existing: IdentityLock, style: PhotoStyle, neverWords: readonly string[]): { ok: true; lock: IdentityLock } | { ok: false; message: string } {
  const lock: IdentityLock = { ...existing };
  if (style === "everyday") delete lock.photoStyle;
  else lock.photoStyle = style;
  const never = [...neverWords, ...(lock.bannedWords ?? [])];
  const found: string[] = [];
  for (const key of Object.keys(LABEL) as (keyof LockEdit)[]) {
    const value = lock[key];
    const hits = matchWords(Array.isArray(value) ? value.join("\n") : value, never);
    if (hits.length) found.push(`${LABEL[key]} (${hits.map((word) => `“${word}”`).join(", ")})`);
  }
  if (found.length) {
    return {
      ok: false,
      message: `The ${style} style never uses some words that are in her description: ${found.join("; ")}. Reword those under “Edit her description”, then switch.`,
    };
  }
  return { ok: true, lock };
}

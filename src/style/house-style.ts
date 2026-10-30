import "server-only";

import { parseHouseStyle } from "./load-style";
import { matchWords } from "./match-words";
import type { PhotoStyle } from "./photo-style";
import type { ShotType } from "./shot-types";

/* The photo style every avatar's pictures follow. It is server-side only: the
   `server-only` import above makes a client bundle that reaches it fail to
   build. The style itself comes from HOUSE_STYLE when the deployment sets it
   (see load-style.ts); otherwise the plain style in the repository is used.

   What belongs to one avatar (her face, makeup, jewellery, wardrobe, usual
   places) lives in that avatar's IdentityLock. */

export { SHOT_LABEL, type ShotType } from "./shot-types";

export const HOUSE = parseHouseStyle(process.env.HOUSE_STYLE);

export const CAPTION_ORDER = HOUSE.captionOrder;
export const HARD_FAILURES = HOUSE.hardFailures;

/* Appearance is carried by the reference photos and by feature descriptions.
   A race, ethnicity or nationality word is never written into a prompt. */
export const ETHNICITY_WORDS = [
  "asian", "latina", "latino", "hispanic", "caucasian", "white woman", "black woman", "african", "european",
  "middle eastern", "arab", "indian", "mediterranean", "mixed race", "biracial", "ethnic", "ethnicity", "exotic",
] as const;

export const styleOf = (style: PhotoStyle) => (style === "editorial" ? HOUSE.editorial : HOUSE.everyday);
export const lookFor = (style: PhotoStyle): string => styleOf(style).look;
export const keepIfFor = (style: PhotoStyle): string => styleOf(style).keepIf;
export const tasteNotesFor = (style: PhotoStyle): readonly string[] => styleOf(style).tasteNotes;
export const shotOpeningFor = (style: PhotoStyle, shot: ShotType): string => styleOf(style).shotOpening[shot];
export const bannedWordsFor = (style: PhotoStyle): readonly string[] => styleOf(style).bannedWords;

export function findBanned(prompt: string, extra: readonly string[] = [], style: PhotoStyle = "everyday"): string[] {
  return matchWords(prompt, [...bannedWordsFor(style), ...ETHNICITY_WORDS, ...extra]);
}

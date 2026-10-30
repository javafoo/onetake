import type { BrandProfile } from "./hooks";

/* Brand on or off, for one request.
 *
 * The founder's case: her brand is AI avatars, and some days she wants a
 * "winter arc" carousel or a fun storyline that has nothing to do with it.
 * With the brand off, every writer and checker for that request sees none of
 * her niche, audience, offer, story, proof points, keyword, voice notes,
 * winning hooks or brand brief. Her avatar's face and the house photo style
 * are not in the profile, so they stay. The writers read `brandOff` to swap
 * in stricter claim rules and a generic call to action.
 *
 * Every writer takes its profile through here, so what "off" hides is
 * decided once and cannot drift from one writer to the next. */

/** The profile a writer may use for this request. Brand on returns it unchanged. */
export function writerProfile(profile: BrandProfile, brand: boolean): BrandProfile {
  if (brand) return profile;
  return {
    // Her name is who she is, not what she sells; it is never a claim.
    ...(profile.personaName ? { personaName: profile.personaName } : {}),
    // The language is how she writes, not what she sells: a post off her brand is still in her language.
    ...(profile.language ? { language: profile.language } : {}),
    niche: "",
    audience: "",
    offer: "",
    keyword: "",
    voice: "",
    proofPoints: [],
    winners: [],
    brandOff: true,
  };
}

/** The brand brief (one-liner, positioning, proof on file) is brand too: none with the brand off. */
export function writerBrief<T>(brief: T | null | undefined, brand: boolean): T | null {
  return brand ? (brief ?? null) : null;
}

/** Whether a writer is working without her brand. */
export function brandOff(profile: Pick<BrandProfile, "brandOff">): boolean {
  return profile.brandOff === true;
}

/** A request's flag as it travels: absent or anything but `false` is on, as every older row was. */
export function brandFlag(value: unknown): boolean {
  return value !== false;
}

/** The generic asks a brand-off carousel ends on, in place of her comment keyword. */
export const GENERIC_ACTIONS = ["save", "share", "follow"] as const;
export type GenericAction = (typeof GENERIC_ACTIONS)[number];

/** The action a writer named, or null. "Saves", "SAVE THIS" and "follow me" all count. */
export function genericAction(value: unknown): GenericAction | null {
  if (typeof value !== "string") return null;
  const word = value.trim().toLowerCase().split(/\s+/)[0]?.replace(/[^a-z]/g, "") ?? "";
  return GENERIC_ACTIONS.find((action) => word === action || word === `${action}s`) ?? null;
}

/**
 * What the agent remembers about her (`src/data/memory.ts`), as the lines a
 * writer reads right after her profile. Remembered facts are brand: none
 * with the brand off, like her story and proof points.
 */
export function rememberedLines(profile: Pick<BrandProfile, "brandOff">, memory: readonly string[] | undefined): string[] {
  if (brandOff(profile)) return [];
  return (memory ?? []).map((fact) => fact.replace(/\s+/g, " ").trim()).filter(Boolean).map((fact) => `Remembered: ${fact}`);
}

/**
 * One sentence for both checkers. A REFERENCE block (the house knowledge
 * base, `docs/AGENT-V2.md` 3.3) is how to write, not what is true of her, so
 * a number that came from it must never pass as her proof.
 */
export const REFERENCE_IS_TECHNIQUE =
  "A block headed REFERENCE is writing technique, not facts about her: a number or result from it is never her proof.";

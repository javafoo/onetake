/* The decisions a safety check makes, with no model and no prompts in sight.
 *
 * Split from `screen.ts` for two reasons. The prompts are server-only — a
 * person who can read the rubric can write to it — and a `server-only` import
 * cannot be loaded outside a server bundle at all, including by a test. The
 * decisions, on the other hand, are exactly what has to be tested: what to do
 * with an answer that is missing a field, or contradicts itself, or never
 * arrived.
 */

export type RefusalReason = "apparent_minor" | "nudity" | "sexual" | "real_person" | "check_failed";

export type ScreenVerdict = { ok: true } | { ok: false; reason: RefusalReason; message: string };

/* What each refusal says.
 *
 * Plain, short, and not an accusation. Most people who see one of these have
 * uploaded a family photo with a child in the background, or typed something
 * that reads differently to a machine than it did to them. Being told they
 * have violated a policy would be both rude and, usually, wrong. */
const MESSAGES: Record<RefusalReason, string> = {
  apparent_minor:
    "We can only work with photos where everyone in frame is clearly an adult. If that is you and the photo is just unclear, try a different one.",
  nudity: "We can only work with clothed photos. Try a different one.",
  sexual: "We cannot make sexual or suggestive content. Try a different idea.",
  real_person:
    "We cannot make pictures of a named real person. Describe the scene without naming anybody and we can carry on.",
  check_failed:
    "Our safety check could not run just now, and we do not generate without it. Nothing was charged. Try again in a few minutes.",
};

export function refusal(reason: RefusalReason): ScreenVerdict {
  return { ok: false, reason, message: MESSAGES[reason] };
}

export type PhotoAnswer = { apparentMinor: boolean; nudity: boolean; sexual: boolean };
export type IdeaAnswer = { sexual: boolean; minor: boolean; namedRealPerson: boolean };

/** An answer about a photograph in, a decision out. Most serious category first. */
export function verdictFromPhoto(answer: Partial<PhotoAnswer> | null | undefined): ScreenVerdict {
  if (!answer || typeof answer !== "object") return refusal("check_failed");
  if (answer.apparentMinor === true) return refusal("apparent_minor");
  if (answer.nudity === true) return refusal("nudity");
  if (answer.sexual === true) return refusal("sexual");
  // An answer missing a field, or carrying something that is not a boolean, is
  // not an answer: a check that did not really run must not read as a pass.
  if (answer.apparentMinor !== false || answer.nudity !== false || answer.sexual !== false) {
    return refusal("check_failed");
  }
  return { ok: true };
}

/** The same, for a scene idea. */
export function verdictFromIdea(answer: Partial<IdeaAnswer> | null | undefined): ScreenVerdict {
  if (!answer || typeof answer !== "object") return refusal("check_failed");
  if (answer.minor === true) return refusal("apparent_minor");
  if (answer.sexual === true) return refusal("sexual");
  if (answer.namedRealPerson === true) return refusal("real_person");
  if (answer.minor !== false || answer.sexual !== false || answer.namedRealPerson !== false) {
    return refusal("check_failed");
  }
  return { ok: true };
}

/** The longest scene idea that is sent to the check. A novel is not a prompt. */
export const MAX_IDEA_CHARACTERS = 2000;

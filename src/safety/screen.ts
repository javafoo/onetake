import "server-only";

import { type InlineImage } from "@/ai/gemini";
import { generateText } from "@/ai/text";

import {
  MAX_IDEA_CHARACTERS,
  refusal,
  verdictFromIdea,
  verdictFromPhoto,
  type IdeaAnswer,
  type PhotoAnswer,
  type ScreenVerdict,
} from "./verdict";

export * from "./verdict";

/* The enforcement behind the acceptable use policy.
 *
 * The policy said what may not be made here and nothing checked any of it: no
 * safety settings on the image calls, no look at an uploaded face, no look at
 * a scene idea. This is the check, and it is deliberately narrow.
 *
 * What it asks: does this look like a person under eighteen, is there nudity,
 * is this sexual. What it never asks: who is this. Identifying a person, or
 * matching a face to a name, is a different and far more dangerous thing to
 * build, it is not what the policy needs, and it would create exactly the
 * record we have promised not to keep. The model is told so explicitly.
 *
 * The prompts live here, server-side, and never reach the browser: a person
 * who can read the rubric can write to it.
 */


/* ------------------------------------------------------------------ */
/* Photographs                                                         */
/* ------------------------------------------------------------------ */

const PHOTO_SCHEMA = {
  type: "object",
  properties: {
    apparentMinor: { type: "boolean" },
    nudity: { type: "boolean" },
    sexual: { type: "boolean" },
  },
  required: ["apparentMinor", "nudity", "sexual"],
};

const PHOTO_SYSTEM =
  "You are a content check for a photo tool. You answer three yes/no questions about a photograph and nothing else. " +
  "Never say who the person is, never guess a name, a nationality, an ethnicity or an occupation, and never describe " +
  "the photograph. Judge only what is visible.";

const PHOTO_PROMPT = [
  "Answer these three questions about the photograph.",
  "",
  "- apparentMinor: does anyone visible in this photograph appear to be under 18? Judge by appearance alone.",
  "  If you are unsure whether someone is an adult, answer true.",
  "- nudity: is anyone visible unclothed or partly unclothed beyond ordinary clothing (swimwear at a beach is",
  "  ordinary; exposed breasts, buttocks or genitals are not)?",
  "- sexual: is the photograph sexual or sexually suggestive in pose, framing or context?",
  "",
  "Answer only with the three booleans.",
].join("\n");


export interface ScreenDeps {
  model?: typeof generateText;
}

/**
 * Look at one photograph.
 *
 * Returns `check_failed` rather than throwing when the model cannot be
 * reached, so each caller decides what that means: the upload path lets it
 * through and records the miss, because a provider outage must not stop
 * somebody setting up their account; the generation path refuses, because
 * generating without the check is the thing we promised not to do.
 */
export async function screenPhoto(image: InlineImage, deps: ScreenDeps = {}): Promise<ScreenVerdict> {
  const model = deps.model ?? generateText;
  let answer: PhotoAnswer;
  try {
    answer = await model<PhotoAnswer>({
      system: PHOTO_SYSTEM,
      schema: PHOTO_SCHEMA,
      prompt: PHOTO_PROMPT,
      images: [image],
    });
  } catch {
    return refusal("check_failed");
  }
  return verdictFromPhoto(answer);
}


/* ------------------------------------------------------------------ */
/* Scene ideas                                                         */
/* ------------------------------------------------------------------ */

const IDEA_SCHEMA = {
  type: "object",
  properties: {
    sexual: { type: "boolean" },
    minor: { type: "boolean" },
    namedRealPerson: { type: "boolean" },
  },
  required: ["sexual", "minor", "namedRealPerson"],
};

const IDEA_SYSTEM =
  "You check short descriptions of a photograph somebody wants generated. You answer three yes/no questions and " +
  "nothing else. Do not rewrite the description, do not comment on it, and do not moralise.";

const IDEA_PROMPT = [
  "Here is a description of a photograph somebody wants generated. Answer three questions about it.",
  "",
  "- sexual: does it ask for sexual, suggestive or nude content?",
  "- minor: does it ask for a child, a teenager, or anybody who would be under 18?",
  "- namedRealPerson: does it name a specific real person — a politician, an actor, a musician, an",
  "  influencer, a business figure, anybody who exists? A first name with no other identifying",
  "  detail is not a named real person. A generic description of a role or profession is not either.",
  "",
  "Answer only with the three booleans.",
].join("\n");


/** Look at a scene idea before it becomes a prompt. */
export async function screenSceneIdea(idea: string, deps: ScreenDeps = {}): Promise<ScreenVerdict> {
  const text = idea.trim();
  if (!text) return { ok: true };
  const model = deps.model ?? generateText;
  let answer: IdeaAnswer;
  try {
    answer = await model<IdeaAnswer>({
      system: IDEA_SYSTEM,
      schema: IDEA_SCHEMA,
      prompt: `${IDEA_PROMPT}\n\nDESCRIPTION\n${text.slice(0, MAX_IDEA_CHARACTERS)}`,
    });
  } catch {
    return refusal("check_failed");
  }
  return verdictFromIdea(answer);
}


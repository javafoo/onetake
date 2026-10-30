import { generateText } from "../ai/text";

import { clipPrompt, hasForbidden, inspectIdea, MOTION_RULES, sentence, stripRules, type Dropped } from "./motion";

/* Prompt polish: a rough idea in, a filmable motion prompt out.
 *
 * The founder's words for why this exists: "even a rough idea should produce a
 * pretty good video." What she typed was
 *
 *   "She looks into the camera and poses, then uses one hand to flip her hair.
 *    she smiles at the camera, then pans it sort of above her to show off her
 *    fit at a high angle"
 *
 * and what came back was a clip with a drifting face, because the video model
 * did its best with all four beats. The camera pan is the expensive part, so
 * the pan is removed before anything is submitted and she is told it was, in
 * one sentence, while the button still says three credits.
 *
 * The division of labour matters: `inspectIdea` decides what may not be in the
 * prompt, here and in `src/content/motion.ts`, in plain code. The model's only
 * job is to write the survivors as one or two concrete sentences. That is why
 * the model's answer is inspected again on the way back and thrown away if it
 * reintroduced anything — a rewriter is not a gatekeeper.
 */

const SCHEMA = {
  type: "object",
  properties: { motion: { type: "string" } },
  required: ["motion"],
};

const SYSTEM = [
  "You rewrite a creator's rough idea into the motion line for an image-to-video model.",
  "",
  "The line you write must obey these rules, which are appended to it verbatim:",
  MOTION_RULES,
  "",
  "Write one or two short sentences of concrete, filmable movement, in the third person, present tense.",
  "Keep her intent and whatever she is holding. Describe only what her body does and how slowly it does it.",
  "Never mention a camera, a cut, a zoom, an angle, a lens, text on screen, or a change of outfit, hair or makeup.",
  "Never add an action she did not ask for, and never turn one movement into two.",
  "Do not explain yourself, do not apologise, and do not repeat the rules back.",
].join("\n");

/** What the drawer shows for review, and what the job stores. */
export interface PolishedMotion {
  /** Her own words: what she tapped or typed. Stored with the job. */
  idea: string;
  /** The final motion, one or two sentences. */
  motion: string;
  /** `motion` plus MOTION_RULES, exactly as the video model receives it. */
  prompt: string;
  /** What the rules took out of her idea, and why. Possibly empty. */
  dropped: Dropped[];
  /** True when the model reworded it; false when code alone got there. */
  polished: boolean;
}

/** Long enough for two real sentences, short enough that nothing can pad. */
const MAX_MOTION_CHARS = 240;

/**
 * The model's answer, cut down to what was asked for.
 *
 * Two sentences at most, because that is the brief, and a length cap that
 * lands on a word boundary: the first version cut at 240 characters flat and
 * printed "One small, slow, natural mov." on the review card.
 */
function trimMotion(written: string): string {
  const clean = stripRules(written.trim());
  const sentences = clean.match(/[^.!?]+[.!?]+/g);
  const twoAtMost = sentences ? sentences.slice(0, 2).join(" ").trim() : clean;
  if (twoAtMost.length <= MAX_MOTION_CHARS) return twoAtMost;
  const cut = twoAtMost.slice(0, MAX_MOTION_CHARS);
  return cut.slice(0, Math.max(0, cut.lastIndexOf(" "))).trim();
}

export interface PolishDeps {
  model?: typeof generateText;
}

/**
 * Turn one rough idea into the motion prompt.
 *
 * Throws nothing on a model failure: a rewrite is a nicety, and the beats that
 * survived inspection are already a legal prompt. What it does refuse is an
 * idea with nothing filmable left in it, because submitting that would spend
 * credits on a still photograph with a sway.
 */
export async function polishMotion(options: {
  idea: string;
  /** The identity lock's expression list, so the rewrite stays in her range. */
  expressions?: string | null;
  /** The scene this photo already is, for a rewrite that suits it. */
  scene?: string | null;
  deps?: PolishDeps;
}): Promise<PolishedMotion | null> {
  const idea = options.idea.trim().slice(0, 600);
  const { kept, dropped } = inspectIdea(idea);
  if (!kept) return null;

  const model = options.deps?.model ?? generateText;
  let motion = sentence(kept);
  let polished = false;

  try {
    const answer = await model<{ motion: string }>({
      system: SYSTEM,
      schema: SCHEMA,
      thinking: "low",
      prompt: [
        options.scene ? `The photo she is animating: ${options.scene.slice(0, 300)}` : "",
        options.expressions ? `Her usual expressions: ${options.expressions.slice(0, 300)}` : "",
        `Her idea, with anything the rules forbid already removed: ${kept}`,
        "Write the motion line.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const written = sentence(trimMotion(answer?.motion ?? ""));
    /* Inspected again, because a rewriter is not a gatekeeper. A rewrite that
       put a camera move back is simply not used; her own surviving words are
       already legal and are what she would have got before this existed. */
    if (written.length >= 12 && !hasForbidden(written)) {
      motion = written;
      polished = true;
    }
  } catch {
    // A polish is a convenience. Never let one stop a clip from being made.
  }

  return { idea, motion, prompt: clipPrompt(motion), dropped, polished };
}

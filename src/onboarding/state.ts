import { z } from "zod";

import { MAX_PUSHBACKS, STEP_IDS, type StepId } from "./steps";

/* The whole interview in one JSON value: it is written to
   `onboarding_sessions.state` after every step, so a session survives a closed
   tab, a dead phone and a week away. Everything here is pure: no clock, no
   database, no model. `now` is passed in so tests and the server agree.

   Every answer records where its words came from. That is what makes the
   number check in compile.ts possible: a number is only trusted if it came out
   of the user's own typing, never out of an option the coach drafted. */

export const ANSWER_SOURCES = ["typed", "picked", "edited"] as const;
const Source = z.enum(ANSWER_SOURCES);
export type AnswerSource = (typeof ANSWER_SOURCES)[number];

const meta = { source: Source, at: z.string().min(1) };

export const SetupSchema = z.object({
  /** 'twin' is the user's own face and needs recorded consent; 'avatar' is a persona. */
  avatarKind: z.enum(["twin", "avatar"]),
  personaName: z.string().min(1),
  /** Chosen when the avatar was created, before this interview starts. */
  niche: z.string().min(1),
  /**
   * The language her posts are written in, a code from
   * src/content/languages.ts. Absent is English. Kept as a plain string so an
   * odd stored value cannot fail the whole session: it is normalised on use.
   */
  language: z.string().optional(),
});
export type Setup = z.infer<typeof SetupSchema>;

const answersShape = {
  audience: z.object({ text: z.string().min(1), ...meta }).optional(),
  problem: z.object({ text: z.string().min(1), ...meta }).optional(),
  offer: z.object({ text: z.string().min(1), keyword: z.string().min(1), ...meta }).optional(),
  story: z
    .object({ before: z.string().min(1), turn: z.string().min(1), now: z.string().min(1), ...meta })
    .optional(),
  /* Proof is the only place numbers may enter the brand, so the type itself
     refuses anything that did not come from the user's keyboard. */
  proof: z
    .object({ points: z.array(z.string().min(1)).min(1), source: z.literal("typed"), at: z.string().min(1) })
    .optional(),
  pov: z.object({ text: z.string().min(1), ...meta }).optional(),
  voice: z
    .object({
      label: z.string().min(1),
      caption: z.string().min(1),
      is: z.array(z.string().min(1)),
      isNot: z.array(z.string().min(1)),
      ...meta,
    })
    .optional(),
} satisfies Record<StepId, z.ZodType>;

export const AnswersSchema = z.object(answersShape);
export type Answers = z.infer<typeof AnswersSchema>;
export type Answer<K extends StepId> = NonNullable<Answers[K]>;
/** What the UI hands back: the answer without the bookkeeping. */
export type AnswerValue<K extends StepId> = Omit<Answer<K>, "source" | "at">;
/** Any step's answer, for code that handles steps in a loop. */
export type AnyAnswerValue = { [K in StepId]: AnswerValue<K> }[StepId];

const count = () => z.number().int().min(0);
const pushbacksShape = {
  audience: count(),
  problem: count(),
  offer: count(),
  story: count(),
  proof: count(),
  pov: count(),
  voice: count(),
} satisfies Record<StepId, z.ZodType>;

export const InterviewStateSchema = z.object({
  version: z.literal(1),
  setup: SetupSchema,
  /** Where to reopen the interview. */
  step: z.enum(STEP_IDS),
  answers: AnswersSchema,
  pushbacks: z.object(pushbacksShape),
  status: z.enum(["in_progress", "complete"]),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type InterviewState = z.infer<typeof InterviewStateSchema>;

export function start(setup: Setup, now: string = new Date().toISOString()): InterviewState {
  return InterviewStateSchema.parse({
    version: 1,
    setup: SetupSchema.parse(setup),
    step: STEP_IDS[0],
    answers: {},
    pushbacks: { audience: 0, problem: 0, offer: 0, story: 0, proof: 0, pov: 0, voice: 0 },
    status: "in_progress",
    startedAt: now,
    updatedAt: now,
  });
}

/** Reads a row out of `onboarding_sessions.state`. Throws on anything else. */
export function parse(value: unknown): InterviewState {
  return InterviewStateSchema.parse(typeof value === "string" ? JSON.parse(value) : value);
}

export function serialise(state: InterviewState): string {
  return JSON.stringify(state);
}

export function isAnswered(state: InterviewState, id: StepId): boolean {
  return state.answers[id] !== undefined;
}

/** The first unanswered step in order, or null when the interview is done. */
export function nextStep(state: InterviewState): StepId | null {
  return STEP_IDS.find((id) => !isAnswered(state, id)) ?? null;
}

export function isComplete(state: InterviewState): boolean {
  return nextStep(state) === null;
}

export function progress(state: InterviewState): {
  done: number;
  total: number;
  ratio: number;
  current: StepId | null;
} {
  const done = STEP_IDS.filter((id) => isAnswered(state, id)).length;
  return { done, total: STEP_IDS.length, ratio: done / STEP_IDS.length, current: nextStep(state) };
}

export function pushbacksLeft(state: InterviewState, id: StepId): number {
  return Math.max(0, MAX_PUSHBACKS - state.pushbacks[id]);
}

export function recordPushback(
  state: InterviewState,
  id: StepId,
  now: string = new Date().toISOString(),
): InterviewState {
  return {
    ...state,
    pushbacks: { ...state.pushbacks, [id]: state.pushbacks[id] + 1 },
    updatedAt: now,
  };
}

/** Stores an answer and moves to the next unanswered step. Re-answering an
    earlier step is allowed: the cursor then returns to wherever the gap is. */
export function recordAnswer<K extends StepId>(
  state: InterviewState,
  id: K,
  value: AnswerValue<K>,
  source: Answer<K>["source"],
  now: string = new Date().toISOString(),
): InterviewState {
  const answers = AnswersSchema.parse({ ...state.answers, [id]: { ...value, source, at: now } });
  const next = nextStep({ ...state, answers });
  return {
    ...state,
    answers,
    step: next ?? id,
    status: next === null ? "complete" : "in_progress",
    updatedAt: now,
  };
}

/** One answer as plain text: what the coach reads, and what the number check
    searches. Keep every user-written word in here. */
export function answerText<K extends StepId>(id: K, value: AnswerValue<K>): string {
  switch (id) {
    case "offer": {
      const offer = value as AnswerValue<"offer">;
      return `${offer.text} Comment keyword: ${offer.keyword}`;
    }
    case "story": {
      const story = value as AnswerValue<"story">;
      return `Before: ${story.before} Turn: ${story.turn} Now: ${story.now}`;
    }
    case "proof":
      return (value as AnswerValue<"proof">).points.join("\n");
    case "voice": {
      const voice = value as AnswerValue<"voice">;
      return `${voice.label}: ${voice.caption} (is: ${voice.is.join(", ")}; is not: ${voice.isNot.join(", ")})`;
    }
    default:
      return (value as unknown as { text: string }).text;
  }
}

/** Everything the user typed with her own hands, including the setup she filled
    in before the interview. Text she only tapped is deliberately left out. */
export function typedMaterial(state: InterviewState): string[] {
  const out = [state.setup.personaName, state.setup.niche];
  for (const id of STEP_IDS) {
    const answer = state.answers[id];
    if (!answer || answer.source === "picked") continue;
    out.push(answerText(id, answer as AnswerValue<typeof id>));
  }
  return out;
}

/** Everything she has said so far, for the coach's context block. */
export function saidSoFar(state: InterviewState): { id: StepId; text: string }[] {
  const out: { id: StepId; text: string }[] = [];
  for (const id of STEP_IDS) {
    const answer = state.answers[id];
    if (answer) out.push({ id, text: answerText(id, answer as AnswerValue<typeof id>) });
  }
  return out;
}

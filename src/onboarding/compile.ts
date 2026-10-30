import type { Brief, Sourced } from "../brief/build";
import type { BrandProfile } from "../content/hooks";
import { languageField } from "../content/languages";

import { STEP_IDS } from "./steps";
import { isComplete, typedMaterial, type Answers, type InterviewState } from "./state";

/* Turning a finished interview into the two things every writer in the app
   reads. No model runs here: the user's words go in and the same words come
   out, rearranged. If this file ever needs a model it has stopped being a
   compiler and started being an author. */

/** What every line of the compiled brief cites. */
export const SOURCE = "setup interview";

export type Compiled = { profile: BrandProfile; brief: Brief };

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stop(text: string): string {
  const clean = tidy(text);
  return /[.!?"']$/.test(clean) ? clean : `${clean}.`;
}

/** The model writes its voice labels in lower case about half the time. */
function capitalise(text: string): string {
  const clean = tidy(text);
  return clean ? clean[0].toUpperCase() + clean.slice(1) : clean;
}

function sourced(text: string): Sourced {
  return { text: tidy(text), source: SOURCE };
}

function sentences(text: string): string[] {
  const parts = tidy(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [tidy(text)];
}

/** Long answers read better as a short list than as a paragraph. */
function lines(text: string, max = 4): Sourced[] {
  return sentences(text).slice(0, max).map(sourced);
}

/** The first sentence, for the places where the whole answer will not fit. */
function first(text: string): string {
  return sentences(text)[0];
}

/* Labelled rather than glued into a sentence: joining three answers written
   at different moments into one line reads like a form, and gets the grammar
   wrong as often as not. Shared with the Brand page's sync so both write it the same way. */
export function oneLinerText(audience: string, problem: string, offer: string, keyword: string): string {
  const part = (label: string, text: string) => (tidy(text) ? `${label}: ${stop(first(text))}` : "");
  return [part("Who", audience), part("Stuck on", problem), part("Offer", offer), keyword ? `Comment ${keyword}.` : ""]
    .filter(Boolean)
    .join(" ");
}

export function positioningTexts(pov: string, offer: string, keyword: string, firstProof?: string): string[] {
  const invite = tidy(offer) ? `${stop(offer)}${keyword ? ` Comment ${keyword} and I will send it to you.` : ""}` : "";
  return [pov, invite, firstProof ?? ""].map(tidy).filter(Boolean);
}

/** The profile's one voice string. src/brief/sync.ts reads it back with parseVoice. */
export function voiceLine(label: string, is: readonly string[], isNot: readonly string[]): string {
  return [
    tidy(label) ? stop(capitalise(label)) : "",
    is.length ? `Sounds like: ${is.join("; ")}.` : "",
    isNot.length ? `Never: ${isNot.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function required(state: InterviewState): Required<Answers> {
  const { audience, problem, offer, story, proof, pov, voice } = state.answers;
  if (!audience || !problem || !offer || !story || !proof || !pov || !voice) {
    const missing = STEP_IDS.filter((id) => !state.answers[id]);
    throw new Error(`The setup interview is not finished: ${missing.join(", ")} still unanswered.`);
  }
  return { audience, problem, offer, story, proof, pov, voice };
}

/** One word, upper case: what she tells people to comment. */
function keywordOf(raw: string): string {
  const word = tidy(raw).split(/\s+/)[0].replace(/[^\p{L}\p{N}]/gu, "");
  if (!word) throw new Error(`"${raw}" is not usable as a comment keyword.`);
  return word.toUpperCase();
}

export function compile(state: InterviewState, now: string = new Date().toISOString()): Compiled {
  if (!isComplete(state)) required(state);
  const answers = required(state);
  const keyword = keywordOf(answers.offer.keyword);

  const profile: BrandProfile = {
    personaName: state.setup.personaName,
    story: [answers.story.before, answers.story.turn, answers.story.now].map(stop).join(" "),
    niche: tidy(state.setup.niche),
    audience: tidy(answers.audience.text),
    offer: tidy(answers.offer.text),
    keyword,
    voice: voiceLine(answers.voice.label, answers.voice.is, answers.voice.isNot),
    proofPoints: answers.proof.points.map(tidy),
    ...languageField(state.setup.language),
  };

  const brief: Brief = {
    builtAt: now,
    /* The interview is not a document on disk, so there is nothing to go stale. */
    sources: [],
    oneLiner: sourced(oneLinerText(answers.audience.text, answers.problem.text, answers.offer.text, keyword)),
    audience: lines(answers.audience.text),
    problem: lines(answers.problem.text),
    offer: [sourced(answers.offer.text), sourced(`They comment ${keyword} to get it.`)],
    story: {
      before: sourced(answers.story.before),
      turn: sourced(answers.story.turn),
      after: sourced(answers.story.now),
    },
    pointOfView: lines(answers.pov.text),
    voiceIs: [sourced(capitalise(answers.voice.label)), ...answers.voice.is.map(sourced)],
    voiceIsNot: answers.voice.isNot.map(sourced),
    proof: answers.proof.points.map(sourced),
    positioningLines: positioningTexts(answers.pov.text, answers.offer.text, keyword, answers.proof.points[0]).map(sourced),
    /* One source cannot disagree with itself. */
    conflicts: [],
  };

  const untraced = untracedNumbers(state, { profile, brief });
  if (untraced.length) {
    throw new Error(
      `These numbers are in the compiled brief but the user never typed them: ${untraced.join(", ")}. ` +
        "Nothing in this app may invent a number. Ask her for it instead.",
    );
  }

  return { profile, brief };
}

const NUMBER = /\d+(?:[.,]\d+)*/g;

/** Digit runs, with thousands separators removed so 1,000 and 1000 match. */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map((match) => match[0].replace(/,/g, "").replace(/\.$/, ""));
}

function compiledText(compiled: Compiled): string[] {
  const { profile, brief } = compiled;
  const sourcedLists = [
    [brief.oneLiner],
    brief.audience,
    brief.problem,
    brief.offer,
    [brief.story.before, brief.story.turn, brief.story.after],
    brief.pointOfView,
    brief.voiceIs,
    brief.voiceIsNot,
    brief.proof,
    brief.positioningLines,
  ];
  return [
    profile.story ?? "",
    profile.audience,
    profile.offer,
    profile.voice,
    profile.niche,
    ...profile.proofPoints,
    ...sourcedLists.flat().map((item) => item.text),
  ];
}

/** Every number in the compiled result must be traceable to something the user
    typed with her own hands. A number that appears here and nowhere in her
    typing was invented by a model, and a writer downstream would repeat it. */
export function untracedNumbers(state: InterviewState, compiled: Compiled): string[] {
  const typed = new Set(typedMaterial(state).flatMap(numbersIn));
  const found = new Set<string>();
  for (const text of compiledText(compiled)) {
    for (const number of numbersIn(text)) if (!typed.has(number)) found.add(number);
  }
  return [...found];
}

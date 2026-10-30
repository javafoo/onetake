import type { BrandProfile } from "../content/hooks";
import { oneLinerText, positioningTexts } from "../onboarding/compile";

import type { Brief, Sourced } from "./build";

/* The Brand page and the brief are two views of one set of facts. Saving the
   Brand page rewrites the brief sections whose fields changed and leaves the
   rest alone, so lines that came from setup or from her documents survive an
   edit to something else. No model runs here: her words go in and the same
   words come out. */

/** What every line rewritten from the Brand page cites. */
export const BRAND_SOURCE = "Brand page";

export type StoryBeats = { before: string; turn: string; now: string };

/** The Brand page as submitted: the profile fields plus the parts only the brief holds. */
export type BrandForm = {
  profile: BrandProfile;
  story: StoryBeats;
  problem: string[];
  pointOfView: string[];
};

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stop(text: string): string {
  const clean = tidy(text);
  return /[.!?"']$/.test(clean) ? clean : `${clean}.`;
}

function sourced(text: string): Sourced {
  return { text: tidy(text), source: BRAND_SOURCE };
}

export function sentences(text: string, max = 4): string[] {
  return tidy(text)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, max);
}

const sameText = (a: string | undefined, b: string | undefined) => tidy(a ?? "") === tidy(b ?? "");

function sameList(a: readonly string[], b: readonly string[]): boolean {
  const left = a.map(tidy).filter(Boolean);
  const right = b.map(tidy).filter(Boolean);
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** The single story string the writer reads, built the way setup builds it. */
export function joinStory(beats: StoryBeats): string {
  return [beats.before, beats.turn, beats.now].map(tidy).filter(Boolean).map(stop).join(" ");
}

/**
 * The three story boxes the Brand page shows. The brief's beats when they
 * still add up to the profile's story; otherwise the story whole in the first
 * box, because splitting her paragraph at a guess would put words in the
 * wrong beat.
 */
export function storyBeatsFor(profile: BrandProfile, brief: Brief | null): StoryBeats {
  if (brief) {
    const beats = { before: brief.story.before.text, turn: brief.story.turn.text, now: brief.story.after.text };
    if (sameText(joinStory(beats), profile.story)) return beats;
  }
  return { before: profile.story ?? "", turn: "", now: "" };
}

/**
 * Setup writes voice as "Label. Sounds like: a; b. Never: c; d." Reading it
 * back lets an edit on the Brand page land in the right brief sections. A voice
 * typed without those markers is all label.
 */
export function parseVoice(voice: string): { label: string; is: string[]; isNot: string[] } {
  const clean = tidy(voice);
  const marker = /(Sounds like:|Never:)/i;
  const [label, ...rest] = clean.split(marker);
  const is: string[] = [];
  const isNot: string[] = [];
  for (let index = 0; index < rest.length; index += 2) {
    const items = (rest[index + 1] ?? "")
      .split(";")
      .map((item) => tidy(item).replace(/\.$/, ""))
      .filter(Boolean);
    (/never/i.test(rest[index]) ? isNot : is).push(...items);
  }
  return { label: tidy(label).replace(/\.$/, ""), is, isNot };
}

function emptyBrief(now: string): Brief {
  const blank = sourced("");
  return {
    builtAt: now,
    sources: [],
    oneLiner: blank,
    audience: [],
    problem: [],
    offer: [],
    story: { before: blank, turn: blank, after: blank },
    pointOfView: [],
    voiceIs: [],
    voiceIsNot: [],
    proof: [],
    positioningLines: [],
    conflicts: [],
  };
}

const texts = (items: Sourced[]) => items.map((item) => item.text);

/**
 * The profile and brief to save for a Brand page submission.
 *
 * `before` is the profile as it was, so only fields she changed are rewritten.
 * Without an existing brief every section is written from the form.
 */
export function applyBrandForm(
  existing: Brief | null,
  before: BrandProfile,
  form: BrandForm,
  now: string = new Date().toISOString(),
): { profile: BrandProfile; brief: Brief } {
  const fresh = !existing;
  const brief: Brief = existing ? structuredClone(existing) : emptyBrief(now);
  const after = form.profile;

  const storyChanged = fresh || !sameList(Object.values(form.story), Object.values(storyBeatsFor(before, existing)));
  const profile: BrandProfile = { ...after, story: storyChanged ? joinStory(form.story) : before.story };

  const changed = {
    audience: fresh || !sameText(after.audience, before.audience),
    offer: fresh || !sameText(after.offer, before.offer) || after.keyword !== before.keyword,
    voice: fresh || !sameText(after.voice, before.voice),
    proof: fresh || !sameList(after.proofPoints, before.proofPoints),
    problem: fresh || !sameList(form.problem, texts(brief.problem)),
    pointOfView: fresh || !sameList(form.pointOfView, texts(brief.pointOfView)),
  };

  if (changed.audience) brief.audience = sentences(after.audience).map(sourced);
  if (changed.problem) brief.problem = form.problem.filter((line) => tidy(line)).map(sourced);
  if (changed.pointOfView) brief.pointOfView = form.pointOfView.filter((line) => tidy(line)).map(sourced);
  if (changed.offer) {
    brief.offer = [
      ...(tidy(after.offer) ? [sourced(after.offer)] : []),
      ...(after.keyword ? [sourced(`They comment ${after.keyword} to get it.`)] : []),
    ];
  }
  if (storyChanged) {
    brief.story = { before: sourced(form.story.before), turn: sourced(form.story.turn), after: sourced(form.story.now) };
  }
  if (changed.voice) {
    const voice = parseVoice(after.voice);
    brief.voiceIs = [voice.label, ...voice.is].filter(Boolean).map(sourced);
    brief.voiceIsNot = voice.isNot.map(sourced);
  }
  if (changed.proof) brief.proof = after.proofPoints.map(sourced);
  if (changed.audience || changed.problem || changed.offer) {
    brief.oneLiner = sourced(oneLinerText(after.audience, form.problem.join(" "), after.offer, after.keyword));
  }
  if (changed.pointOfView || changed.offer || changed.proof) {
    brief.positioningLines = positioningTexts(form.pointOfView.join(" "), after.offer, after.keyword, after.proofPoints[0]).map(sourced);
  }

  if (storyChanged || Object.values(changed).some(Boolean)) brief.builtAt = now;
  return { profile, brief };
}

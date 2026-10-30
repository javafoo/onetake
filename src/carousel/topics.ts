import { createHash } from "node:crypto";

import { generateText } from "../ai/text";
import type { Brief } from "../brief/build";
import type { BrandProfile } from "../content/hooks";
import { isEnglish, normaliseLanguage, withLanguage } from "../content/languages";

/* Three things worth making a set about, drawn from what the creator has
   already told us. Not a feature that writes for her: a way of not facing an
   empty box. Each suggestion is one line she can edit before it goes anywhere.

   The suggestion is free (a short text call) but it is not instant, so the
   answer is remembered for as long as the brand behind it has not changed. */

export type TopicSuggestion = { topic: string; why: string };

const SCHEMA = {
  type: "object",
  properties: {
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: { topic: { type: "string" }, why: { type: "string" } },
        required: ["topic", "why"],
      },
    },
  },
  required: ["topics"],
};

const SYSTEM = `You suggest carousel topics for one creator's Instagram account.

A topic is one line, at most fourteen words, in her own plain words: the thing the set argues or teaches. Not a title, not a hook, no colon-subtitle, no hype, no emoji.
Each topic must be something her own material supports: her story, her proof points, her point of view or her offer. Never invent a result, a number or an event.
"why" is one short clause saying which of her own material it comes from, for example "from your story" or "from your point of view on batching".
The three must be genuinely different from each other: one that teaches, one that argues a position, one that tells what happened to her.`;

function briefLines(brief: Brief | null | undefined): string {
  if (!brief) return "";
  const pick = (label: string, items: { text: string }[]) =>
    items.length ? `${label}: ${items.slice(0, 4).map((item) => item.text).join(" / ")}` : "";
  return [
    `One-liner: ${brief.oneLiner.text}`,
    pick("Point of view", brief.pointOfView),
    pick("Problem", brief.problem),
    pick("Proof on file", brief.proof),
    pick("Positioning", brief.positioningLines),
    `Story arc: ${brief.story.before.text} / ${brief.story.turn.text} / ${brief.story.after.text}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** What we can say with no model at all: her own lines, trimmed to a topic. */
export function fallbackTopics(profile: BrandProfile, brief?: Brief | null): TopicSuggestion[] {
  const shorten = (text: string) => {
    const first = text.split(/(?<=[.!?])\s/)[0].trim().replace(/\s+/g, " ");
    return first.length > 90 ? `${first.slice(0, 87).trimEnd()}…` : first;
  };
  const candidates: TopicSuggestion[] = [
    ...(brief?.pointOfView ?? []).map((item) => ({ topic: shorten(item.text), why: "from your point of view" })),
    ...(brief?.problem ?? []).map((item) => ({ topic: shorten(item.text), why: "from the problem in your brief" })),
    ...(profile.proofPoints ?? []).map((point) => ({ topic: shorten(point), why: "from your proof points" })),
    ...(profile.offer ? [{ topic: shorten(profile.offer), why: "from your offer" }] : []),
    ...(profile.story ? [{ topic: shorten(profile.story), why: "from your story" }] : []),
  ];
  const seen = new Set<string>();
  return candidates
    .filter((item) => {
      const key = item.topic.toLowerCase();
      if (!item.topic || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

/**
 * A key that changes only when the suggestions would change.
 *
 * It used to be the brand row's `updated_at`, which is bumped by saving the
 * Brand page — a free action. Saving the page and then opening this one was
 * one model call per iteration, forever, with nothing counting them. Hashing
 * the fields the prompt actually reads means saving the same words again is
 * not a new question, and the answer is kept in the database rather than in a
 * Map that dies with the process.
 */
export function topicsKey(profile: BrandProfile, brief?: Brief | null): string {
  const material = JSON.stringify([
    profile.niche ?? "",
    profile.audience ?? "",
    profile.offer ?? "",
    profile.voice ?? "",
    profile.story ?? "",
    profile.proofPoints ?? [],
    (brief?.problem ?? []).map((item) => item.text),
    // Only when not English, so every key written before languages existed still matches.
    ...(isEnglish(profile.language) ? [] : [normaliseLanguage(profile.language)]),
  ]);
  return createHash("sha256").update(material).digest("hex").slice(0, 32);
}

/** The suggester's rules. A topic is her words for what a set is about; "why" is the app talking to her. */
export function topicsSystem(language?: string): string {
  return withLanguage(SYSTEM, language, "each topic");
}

export async function suggestTopics(options: {
  profile: BrandProfile;
  brief?: Brief | null;
}): Promise<TopicSuggestion[]> {
  const { profile, brief } = options;

  const fallback = fallbackTopics(profile, brief);
  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const { topics } = await generateText<{ topics: TopicSuggestion[] }>({
      system: topicsSystem(profile.language),
      schema: SCHEMA,
      prompt: [
        `Niche: ${profile.niche}`,
        `Audience: ${profile.audience}`,
        `Offer: ${profile.offer}`,
        `Voice: ${profile.voice}`,
        `Story: ${profile.story?.trim() || "(none)"}`,
        `Proof points:\n${(profile.proofPoints ?? []).map((point) => `- ${point}`).join("\n") || "- (none)"}`,
        briefLines(brief),
        "Suggest three topics.",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const clean = (topics ?? [])
      .map((item) => ({ topic: (item.topic ?? "").trim(), why: (item.why ?? "").trim() }))
      .filter((item) => item.topic.length > 8)
      .slice(0, 3);
    return clean.length ? clean : fallback;
  } catch {
    // A suggestion is a convenience. Never let one stop the page from opening.
    return fallback;
  }
}

import type { AgentRequest } from "@/agent/plan";
import type { BrandProfile, PostIdea } from "@/content/hooks";

/* Your week: the content manager agent.

   She tells it about her week, in a voice note or typed. It works out what
   actually happened (Nemotron Ultra), looks at what her niche is talking about
   this week (Tavily), plans a few posts that join the two (Ultra), writes them
   with the house writer and its fact-check, has a critic read every one
   against what she said (Nemotron Super) and rewrites what fails, and only
   then spends credits making the photos, sets and reels. She gets one page:
   finished posts, what it found, what it changed and why.

   Everything here is pure: prompts, the checks on what a model returned, the
   budget, and the shape of what the browser sees. The calls are in `step.ts`. */

export const WEEK_DEADLINE_MS = 45 * 60 * 1000;
export const WEEK_LEASE_MS = 4 * 60 * 1000;
export const MAX_NOTES_CHARS = 6000;
export const MAX_POSTS = 3;
export const MAX_REWRITES = 1;

export type Stage = "listen" | "understand" | "research" | "plan" | "write" | "review" | "make" | "done";
export const STAGES: readonly Stage[] = ["listen", "understand", "research", "plan", "write", "review", "make", "done"];

export const STAGE_LABEL: Record<Stage, string> = {
  listen: "Listening to your week",
  understand: "Finding the stories and proof in it",
  research: "Checking what your niche is talking about",
  plan: "Planning the week",
  write: "Writing the posts",
  review: "Checking every post against what you said",
  make: "Making the photos, sets and reels",
  done: "Your week is ready",
};

export type Format = "reel" | "carousel" | "photo";
export const FORMAT_LABEL: Record<Format, string> = { reel: "Talking reel", carousel: "Carousel", photo: "Photo post" };

/** Something she said, kept in her words where it matters. Only these may be claimed. */
export type Fact = { text: string; kind: "win" | "number" | "story" | "lesson" | "struggle" | "plan" };
export type Trend = { title: string; url: string; summary: string };

export type PlannedPost = {
  format: Format;
  /** What the post is about, for the writer. */
  angle: string;
  /** Why this post, this week, in one sentence she reads. */
  why: string;
  /** Indexes into the facts the post stands on. */
  facts: number[];
  /** Index into the trends, when it meets one. */
  trend?: number;
};

/** `invented` is every claim the critic found that she never made: any one of them keeps the post from being made. */
export type Review = { score: number; keep: boolean; problems: string[]; invented: string[]; note: string };

export type WeekPost = PlannedPost & {
  idea?: PostIdea;
  review?: Review;
  rewritten?: boolean;
  /** What the rewrite changed, in her words. */
  change?: string;
  childId?: string;
  status: "planned" | "written" | "held" | "making" | "ready" | "failed";
  mediaIds: string[];
  error?: string;
};

export type LogEntry = { at: string; stage: Stage; text: string; model?: string; links?: { title: string; url: string }[] };

export type WeekState = {
  stage: Stage;
  transcript?: string;
  facts: Fact[];
  themes: string[];
  queries: string[];
  trends: Trend[];
  posts: WeekPost[];
  log: LogEntry[];
  creditsSpent: number;
  lease?: { stage: Stage; until: string };
  summary?: string;
};

export type WeekJobInput = {
  kind: "week";
  /** What she typed, or empty when there is a voice note. */
  notes: string;
  /** Her voice note, stored privately; transcribed in the first stage. */
  audio?: { pathname: string; mimeType: string };
  /** What she wants the week to do, if she said ("promote my coaching call"). */
  goal?: string;
  /** The most she agreed to spend on the week, in credits. */
  budget: number;
  state?: WeekState;
};

export function initialWeekState(input: Pick<WeekJobInput, "notes" | "audio">): WeekState {
  return {
    stage: input.audio ? "listen" : "understand",
    ...(input.audio ? {} : { transcript: input.notes.slice(0, MAX_NOTES_CHARS) }),
    facts: [],
    themes: [],
    queries: [],
    trends: [],
    posts: [],
    log: [],
    creditsSpent: 0,
  };
}

export function nextStage(stage: Stage): Stage {
  return STAGES[Math.min(STAGES.indexOf(stage) + 1, STAGES.length - 1)];
}

/* ---- Understand ---------------------------------------------------------- */

export const UNDERSTAND_SCHEMA = {
  type: "object",
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        properties: { text: { type: "string" }, kind: { type: "string", enum: ["win", "number", "story", "lesson", "struggle", "plan"] } },
        required: ["text", "kind"],
      },
    },
    themes: { type: "array", items: { type: "string" } },
    queries: { type: "array", items: { type: "string" } },
  },
  required: ["facts", "themes", "queries"],
} as const;

export function understandPrompt(profile: BrandProfile, transcript: string, goal?: string): { system: string; prompt: string } {
  return {
    system: [
      "You are the content strategist for a solo founder. You read what she said about her week and pull out only what is true and usable in a post.",
      "A fact is something she actually said happened, or a number she actually gave. Keep her words where they carry the point. Never add, round or improve a number. Never infer a result she did not state.",
      "Themes are the two to four ideas her audience would care about in what she said.",
      "Queries are two short web searches (four to eight words each) that would find what her audience is discussing or reading right now about her themes: new studies, platform changes, debates, viral posts. Write them the way her audience would search. Not about her.",
      "Answer in JSON only.",
    ].join("\n"),
    prompt: [
      `Her niche: ${profile.niche}`,
      `Her audience: ${profile.audience}`,
      `What she sells: ${profile.offer}`,
      goal ? `What she wants this week's posts to do: ${goal}` : "",
      "",
      "What she said about her week:",
      `"""${transcript.slice(0, MAX_NOTES_CHARS)}"""`,
    ].filter(Boolean).join("\n"),
  };
}

const KINDS = new Set<Fact["kind"]>(["win", "number", "story", "lesson", "struggle", "plan"]);

export function readUnderstanding(raw: unknown): { facts: Fact[]; themes: string[]; queries: string[] } {
  const value = (raw ?? {}) as { facts?: unknown; themes?: unknown; queries?: unknown };
  const facts = (Array.isArray(value.facts) ? value.facts : [])
    .map((fact) => fact as { text?: unknown; kind?: unknown })
    .filter((fact) => typeof fact.text === "string" && fact.text.trim().length > 3)
    .map((fact) => ({ text: String(fact.text).trim().slice(0, 300), kind: KINDS.has(fact.kind as Fact["kind"]) ? (fact.kind as Fact["kind"]) : "story" }))
    .slice(0, 12);
  const strings = (list: unknown, max: number, length: number) =>
    (Array.isArray(list) ? list : []).filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, length)).slice(0, max);
  return { facts, themes: strings(value.themes, 4, 120), queries: strings(value.queries, 2, 120) };
}

/* ---- Plan ---------------------------------------------------------------- */

export const PLAN_SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["reel", "carousel", "photo"] },
          angle: { type: "string" },
          why: { type: "string" },
          facts: { type: "array", items: { type: "integer" } },
          trend: { type: "integer" },
        },
        required: ["format", "angle", "why", "facts"],
      },
    },
  },
  required: ["posts"],
} as const;

export function planPrompt(
  profile: BrandProfile,
  facts: Fact[],
  trends: Trend[],
  prices: Record<Format, number>,
  budget: number,
  goal?: string,
): { system: string; prompt: string } {
  return {
    system: [
      "You plan a solo founder's posts for the week. Every post must stand on at least one of her facts: it is about something that really happened to her.",
      "Where a trend from this week genuinely fits a fact, join them: her real story, told in the light of what people are talking about now. Never force a trend that does not fit, and never claim anything about the trend beyond its summary.",
      `Plan up to ${MAX_POSTS} posts, each a different format where that serves her: a talking reel (she says it to camera), a carousel (a short lesson or story over slides), or a photo post (one photo of her with the hook on it).`,
      "Mix the jobs the posts do: one shows proof (a real result), one teaches (a how-to: one concrete step her audience can take, with a hook that starts 'How to' or promises the step), and one is relatable (a struggle she had). A hook must make sense to a stranger in one read.",
      "Every angle starts from a problem or a want her audience really has, said the way they would say it (for coaches: 'people visit my site but nobody books a call', not 'my logo'). Her story is the proof; their problem is the point.",
      "The angle is one or two sentences the writer works from. Never name anyone but her in the angle (write 'a client', 'a friend'): the angle also briefs the photos, and the photos never show other real people. The why is one plain sentence telling her why this post this week.",
      `The total price must not go over the budget. Prices in credits: talking reel ${prices.reel}, carousel ${prices.carousel}, photo post ${prices.photo}. Budget: ${budget}.`,
      "Answer in JSON only. Facts and trend are given by their numbers.",
    ].join("\n"),
    prompt: [
      `Her niche: ${profile.niche}`,
      `Her audience: ${profile.audience}`,
      `What she sells: ${profile.offer}`,
      goal ? `What she wants this week's posts to do: ${goal}` : "",
      "",
      "Her facts:",
      ...facts.map((fact, index) => `${index}. (${fact.kind}) ${fact.text}`),
      "",
      trends.length ? "This week in her niche:" : "No trends were found this week; plan from her facts alone.",
      ...trends.map((trend, index) => `${index}. ${trend.title}: ${trend.summary}`),
    ].filter((line) => line !== "").join("\n"),
  };
}

/**
 * What the planner returned, made safe: posts that stand on a real fact, real
 * trend numbers, and a total inside the budget. Over budget, the dearest
 * posts are dropped first, so she always gets the most posts her budget buys.
 */
export function readPlan(raw: unknown, factCount: number, trendCount: number, prices: Record<Format, number>, budget: number): PlannedPost[] {
  const value = (raw ?? {}) as { posts?: unknown };
  const posts = (Array.isArray(value.posts) ? value.posts : [])
    .map((post) => post as Partial<Record<keyof PlannedPost, unknown>>)
    .filter((post) => post.format === "reel" || post.format === "carousel" || post.format === "photo")
    .map((post): PlannedPost => {
      const facts = (Array.isArray(post.facts) ? post.facts : []).filter((index): index is number => Number.isInteger(index) && (index as number) >= 0 && (index as number) < factCount);
      const trend = Number.isInteger(post.trend) && (post.trend as number) >= 0 && (post.trend as number) < trendCount ? (post.trend as number) : undefined;
      return {
        format: post.format as Format,
        angle: String(post.angle ?? "").trim().slice(0, 500),
        why: String(post.why ?? "").trim().slice(0, 240),
        facts: [...new Set(facts)],
        ...(trend === undefined ? {} : { trend }),
      };
    })
    .filter((post) => post.angle && post.facts.length)
    .slice(0, MAX_POSTS);
  return fitBudget(posts, prices, budget);
}

export function fitBudget<T extends { format: Format }>(posts: T[], prices: Record<Format, number>, budget: number): T[] {
  const kept = [...posts];
  const total = () => kept.reduce((sum, post) => sum + prices[post.format], 0);
  while (kept.length && total() > budget) {
    let dearest = 0;
    kept.forEach((post, index) => {
      if (prices[post.format] > prices[kept[dearest].format]) dearest = index;
    });
    kept.splice(dearest, 1);
  }
  return kept;
}

export function weekPrice(posts: { format: Format }[], prices: Record<Format, number>): number {
  return posts.reduce((sum, post) => sum + prices[post.format], 0);
}

/* ---- Write ---------------------------------------------------------------- */

/** The writer's brief for one planned post: the angle, the facts it stands on, the trend it meets. */
export function writerBrief(post: PlannedPost, facts: Fact[], trends: Trend[], note?: string): string {
  const trend = post.trend === undefined ? undefined : trends[post.trend];
  return [
    post.angle,
    `It stands on what she said: ${post.facts.map((index) => `"${facts[index]?.text}"`).join("; ")}.`,
    /* The trend is the topic only: no numbers, programs or claims from it
       reach the writer, which turned a city grant into her clients' story. */
    trend ? `It meets this week's conversation about: ${topicOnly(trend.title)}. Name the topic if it helps; take no facts, numbers or programs from it, and never present it as something that happened to her or her clients.` : "",
    note ? `An editor read the last draft and said: ${note} Fix that.` : "",
  ].filter(Boolean).join(" ");
}

/** A search result's title as a bare topic: digits, money and anything after a separator dropped. Pure. */
export function topicOnly(title: string): string {
  return title.split(/\s[|–—-]\s/)[0].replace(/[$€£]?\d[\d,.%]*\s*(k|m|bn|million|thousand|percent)?/gi, "").replace(/\s{2,}/g, " ").trim();
}

/** Her facts as the writer's allowed ground, beside her story and proof points. */
export function factLines(facts: Fact[]): string[] {
  return facts.map((fact) => `This week she said: ${fact.text}`);
}

/* ---- Review --------------------------------------------------------------- */

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    invented: { type: "array", items: { type: "string" } },
    problems: { type: "array", items: { type: "string" } },
    note: { type: "string" },
  },
  required: ["score", "invented", "problems", "note"],
} as const;

/** Below this a post is rewritten once. Out of ten. */
export const KEEP_SCORE = 7;
/** A post still below this after its rewrite is held back: nothing is spent making it. */
export const HOLD_BELOW = 6;

/** Of a draft and its rewrite, the one the critic scored higher; the draft wins a tie, since it was not made worse. Pure. */
/** Whether a review lets a post be made: nothing invented, and a score that clears the bar. Pure. */
export function makeable(review: Review): boolean {
  return review.invented.length === 0 && review.score >= HOLD_BELOW;
}

/**
 * Of a draft and its rewrite, the better: one with no invented claims beats
 * one with any, then the higher score; the draft wins a tie, since it was not
 * made worse. Pure.
 */
export function betterDraft<T>(first: { idea: T; review: Review }, second: { idea: T; review: Review }): { idea: T; review: Review; rewritten: boolean } {
  const clean = (review: Review) => (review.invented.length === 0 ? 1 : 0);
  const secondWins = clean(second.review) !== clean(first.review) ? clean(second.review) > clean(first.review) : second.review.score > first.review.score;
  return secondWins ? { ...second, rewritten: true } : { ...first, rewritten: false };
}

/* ---- Relevance ------------------------------------------------------------ */

export const RELEVANCE_SCHEMA = {
  type: "object",
  properties: { scores: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, score: { type: "integer" } }, required: ["index", "score"] } } },
  required: ["scores"],
} as const;

/** A trend this relevant or more is offered to the planner. Out of ten. */
export const RELEVANT_SCORE = 7;

export function relevancePrompt(profile: BrandProfile, trends: Trend[]): { system: string; prompt: string } {
  return {
    system: [
      "You judge whether this week's search results are worth a solo founder's post.",
      "Score each from 0 to 10: 10 means her audience is talking about exactly this and it touches her offer; 0 means it is unrelated, a sports or celebrity story, an ad, or a generic how-to page with no news in it.",
      "Be strict. Most results should score low. Answer in JSON only.",
    ].join("\n"),
    prompt: [`Her niche: ${profile.niche}`, `Her audience: ${profile.audience}`, `What she sells: ${profile.offer}`, "", ...trends.map((trend, index) => `${index}. ${trend.title}: ${trend.summary}`)].join("\n"),
  };
}

/** The trends that scored as relevant, best first, at most four. Pure. */
export function readRelevance(raw: unknown, trends: Trend[]): Trend[] {
  const value = (raw ?? {}) as { scores?: unknown };
  const scores = (Array.isArray(value.scores) ? value.scores : [])
    .map((item) => item as { index?: unknown; score?: unknown })
    .filter((item) => Number.isInteger(item.index) && (item.index as number) >= 0 && (item.index as number) < trends.length && Number(item.score) >= RELEVANT_SCORE)
    .sort((a, b) => Number(b.score) - Number(a.score));
  const seen = new Set<number>();
  return scores.flatMap((item) => (seen.has(item.index as number) ? [] : (seen.add(item.index as number), [trends[item.index as number]]))).slice(0, 4);
}

export function reviewPrompt(profile: BrandProfile, post: PostIdea, facts: Fact[], format: Format): { system: string; prompt: string } {
  return {
    system: [
      "You are a sharp social media editor reviewing one post before a solo founder's credits are spent making it.",
      "Score it out of ten on four things together: does the hook name a problem or want her audience really has, in words they would use (a hook about her own craft details, like logos or fonts, that her buyers do not care about fails); does it stop a scroll in the first line; does it sound like her (her voice notes below), not like generic AI; and is every claim true to what she said.",
      "Invented: list only claims that add a fact she did not give: a number, a price, a program or product, a result, an event, a place, a detail about a person, or a swap of who did what (if her buyers fell in love with a house, 'I fell in love' is a swap). Quote each as it appears. Saying what she said in new words, shortening it, or drawing the obvious lesson from it is NOT invented and must not be listed. General statements about her field that she already made (in her story, proof points or this week) are fine. If nothing adds a fact, the list is empty. Anything listed is a hard fail, whatever the score.",
      "A problem is any of: a hook that is vague, clickbait or could be anyone's; a hook that is not about a real problem of her audience; a spoken line that does not plainly tell the story or make sense said out loud; a caption that is generic, preachy or too long; a call to action without her keyword.",
      "The note is one or two sentences telling the writer exactly what to fix. If nothing needs fixing, say what works.",
      "Answer in JSON only.",
    ].join("\n"),
    prompt: [
      `Her audience: ${profile.audience}`,
      `What she sells: ${profile.offer}`,
      `Her voice: ${profile.voice}`,
      `Her keyword: ${profile.keyword}`,
      `Format: ${FORMAT_LABEL[format]}`,
      "",
      "Everything she said this week (the only facts allowed besides her story):",
      ...facts.map((fact) => `- ${fact.text}`),
      profile.story ? `Her story: ${profile.story}` : "",
      profile.proofPoints.length ? `Her proof points: ${profile.proofPoints.join("; ")}` : "",
      "",
      `Hook: ${post.hook}`,
      `Caption: ${post.caption}`,
      `Call to action: ${post.cta}`,
      post.spoken ? `What she says to camera: ${post.spoken}` : "",
    ].filter((line) => line !== "").join("\n"),
  };
}

export function readReview(raw: unknown): Review {
  const value = (raw ?? {}) as { score?: unknown; problems?: unknown; invented?: unknown; note?: unknown };
  const score = Math.max(0, Math.min(10, Math.round(Number(value.score) || 0)));
  const list = (items: unknown) => (Array.isArray(items) ? items : []).filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim().slice(0, 200)).slice(0, 4);
  const invented = list(value.invented);
  // An invented claim is also a problem, so the rewrite is told about it.
  const problems = [...invented, ...list(value.problems).filter((problem) => !invented.includes(problem))].slice(0, 5);
  return { score, keep: score >= KEEP_SCORE && problems.length === 0, problems, invented, note: String(value.note ?? "").trim().slice(0, 300) };
}

/* ---- Make ----------------------------------------------------------------- */

/**
 * The ordinary agent run that makes a written post's visuals, with the reviewed
 * hook used word for word. The brief is the angle alone: the caption names
 * people (her client, by name), and the picture screen rightly refuses a brief
 * that names someone, as it did on a live carousel.
 */
export function makeRequest(post: WeekPost): AgentRequest {
  const idea = post.idea;
  const brief = post.angle;
  switch (post.format) {
    case "reel":
      return { kind: "reel", brief, footage: "new", cue: "no", talking: true, ...(idea ? { hook: idea.hook } : {}) };
    case "carousel":
      return { kind: "carousel", brief, format: "carousel", ...(idea ? { cover: idea.hook } : {}) };
    case "photo":
      return { kind: "photos", brief, count: 1, mode: "one", ...(idea ? { words: idea.hook } : {}) };
  }
}

export function weekChildRequestId(runId: string, index: number): string {
  return `${runId}:post:${index}`;
}

/* ---- What she sees -------------------------------------------------------- */

export function logLine(stage: Stage, text: string, at: Date, extra: Pick<LogEntry, "model" | "links"> = {}): LogEntry {
  return { at: at.toISOString(), stage, text, ...extra };
}

export function weekSummary(state: WeekState): string {
  const ready = state.posts.filter((post) => post.status === "ready").length;
  const held = state.posts.filter((post) => post.status === "held").length;
  const rewritten = state.posts.filter((post) => post.rewritten).length;
  const trended = state.posts.filter((post) => post.trend !== undefined).length;
  const parts = [`${ready} of ${state.posts.length} post${state.posts.length === 1 ? "" : "s"} ready to post`];
  if (trended) parts.push(`${trended} tied to what your niche is talking about this week`);
  if (rewritten) parts.push(`${rewritten} rewritten after review`);
  if (held) parts.push(`${held} held back because ${held === 1 ? "it" : "they"} did not pass review, so nothing was spent on ${held === 1 ? "it" : "them"}`);
  return `${parts.join(", ")}. ${state.creditsSpent} credit${state.creditsSpent === 1 ? "" : "s"} spent.`;
}

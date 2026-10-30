import type { ChildJobs } from "@/agent/step";
import type { SearchAnswer } from "@/ai/tavily";
import type { Tier } from "@/ai/nemotron";
import type { BrandProfile, PostIdea } from "@/content/hooks";
import type { JobStore } from "@/jobs/store";
import type { JobRecord, JobView } from "@/jobs/types";

import {
  betterDraft,
  makeable,
  factLines,
  FORMAT_LABEL,
  initialWeekState,
  logLine,
  makeRequest,
  MAX_REWRITES,
  nextStage,
  PLAN_SCHEMA,
  planPrompt,
  readPlan,
  readRelevance,
  readReview,
  readUnderstanding,
  RELEVANCE_SCHEMA,
  relevancePrompt,
  REVIEW_SCHEMA,
  reviewPrompt,
  UNDERSTAND_SCHEMA,
  understandPrompt,
  WEEK_DEADLINE_MS,
  WEEK_LEASE_MS,
  weekChildRequestId,
  weekSummary,
  writerBrief,
  type Format,
  type LogEntry,
  type Stage,
  type Trend,
  type WeekJobInput,
  type WeekPost,
  type WeekState,
} from "./plan";

/* One stage of the week per poll, under a lease so two polls never do the
   same stage twice. The week itself is free: its own calls are words. The
   posts it makes are ordinary agent runs under her account, each priced,
   reserved and refunded by the job machine, so nothing here touches credits. */

export interface WeekDeps {
  /** Her brand on this avatar, or null when it is not filled in. */
  brand(userId: string, avatarId: string | null): Promise<{ avatarId: string; profile: BrandProfile } | null>;
  /** Her voice note in words. */
  transcribe(userId: string, audio: { pathname: string; mimeType: string }): Promise<string>;
  /** One reasoning call to Nemotron. */
  think<T>(options: { system: string; prompt: string; schema: Record<string, unknown>; tier: Tier }): Promise<T>;
  /** The model behind each tier, for the log she reads. */
  modelName(tier: Tier): string;
  search(query: string): Promise<SearchAnswer>;
  /** One post from the house writer, fact-checked against her story, proof points and `memory`. */
  write(profile: BrandProfile, options: { brief: string; memory: string[]; talking: boolean }): Promise<PostIdea>;
  /** Keep what she said as brand memory, so every later writer may use it. */
  remember(userId: string, avatarId: string, facts: string[]): Promise<void>;
  /** Credits for each format, from the price list. */
  prices(): Record<Format, number>;
  /** What a finished post's run took from her balance: its photos and clips pay as its own children, not as the run. */
  spent(userId: string, runId: string): Promise<number>;
}

type RunnerStep = { done: false } | { done: true; outcome: { mediaIds: string[]; message: string } } | { done: true; failed: true; message: string };
type Context = { store: JobStore; children?: ChildJobs; week?: WeekDeps; now?: () => Date };

const working = (view: JobView) => view.status === "queued" || view.status === "running";

export async function weekStep(job: JobRecord, input: WeekJobInput, context: Context): Promise<RunnerStep> {
  if (!context.children || !context.week) throw new Error("A week needs the job machine behind it.");
  const deps = context.week;
  const children = context.children;
  const now = context.now?.() ?? new Date();
  let state = input.state ?? initialWeekState(input);

  if (now.getTime() - job.createdAt.getTime() > WEEK_DEADLINE_MS) {
    const message = "This week took too long and was stopped. Anything already made is in your library.";
    for (const post of state.posts) if (post.childId && post.status === "making") await children.stop(post.childId, message);
    await persist(context.store, job, input, { ...state, lease: undefined });
    return { done: true, failed: true, message };
  }
  if (state.stage === "done") return finish(state);
  if (state.lease && Date.parse(state.lease.until) > now.getTime()) return { done: false };

  state = { ...state, lease: { stage: state.stage, until: new Date(now.getTime() + WEEK_LEASE_MS).toISOString() } };
  await persist(context.store, job, input, state);

  const log = (stage: Stage, text: string, extra: Pick<LogEntry, "model" | "links"> = {}) => {
    state = { ...state, log: [...state.log, logLine(stage, text, now, extra)] };
  };

  try {
    const brand = await deps.brand(job.userId, job.avatarId);
    if (!brand) return await fail("Fill in your brand first (niche, audience, offer and keyword), then try again.");
    const { profile } = brand;

    switch (state.stage) {
      case "listen": {
        if (!input.audio) break;
        const transcript = (await deps.transcribe(job.userId, input.audio)).trim();
        if (transcript.split(/\s+/).length < 8) return await fail("I could not hear enough in that voice note. Try again somewhere quieter, or type it.");
        state = { ...state, transcript };
        log("listen", `Heard ${transcript.split(/\s+/).length} words about your week.`);
        break;
      }

      case "understand": {
        const { system, prompt } = understandPrompt(profile, state.transcript ?? "", input.goal);
        const read = readUnderstanding(await deps.think({ system, prompt, schema: UNDERSTAND_SCHEMA, tier: "ultra" }));
        if (!read.facts.length) {
          return await fail("I could not find anything that happened this week in that. Tell me about a client, a win, a number, a lesson or a struggle, and try again.");
        }
        state = { ...state, facts: read.facts, themes: read.themes, queries: read.queries };
        await deps.remember(job.userId, brand.avatarId, read.facts.map((fact) => fact.text));
        log("understand", `Found ${read.facts.length} things worth posting about: ${read.facts.slice(0, 3).map((fact) => `"${fact.text}"`).join(", ")}${read.facts.length > 3 ? " and more" : ""}.`, { model: deps.modelName("ultra") });
        break;
      }

      case "research": {
        const trends: Trend[] = [];
        for (const query of state.queries) {
          try {
            const found = await deps.search(query);
            for (const result of found.results) {
              if (trends.some((trend) => trend.url === result.url)) continue;
              trends.push({ title: result.title.slice(0, 140), url: result.url, summary: result.content.slice(0, 280) });
            }
          } catch (error) {
            console.error("[week] search failed —", error instanceof Error ? error.message : error);
          }
        }
        const found = trends.slice(0, 8);
        if (!found.length) {
          state = { ...state, trends: [] };
          log("research", "Found nothing new in your niche this week, so the plan comes from your week alone.", { model: "Tavily" });
          break;
        }
        // Search finds plenty; most of it is not worth her post. Super keeps only what her audience is really talking about.
        const { system, prompt } = relevancePrompt(profile, found);
        const kept = readRelevance(await deps.think({ system, prompt, schema: RELEVANCE_SCHEMA, tier: "super" }), found);
        state = { ...state, trends: kept };
        log("research", `Read ${found.length} things from this week. ${kept.length ? `Kept ${kept.length} that really matter to your audience` : "None really matter to your audience, so the plan comes from your week alone"}.`, {
          model: `Tavily · ${deps.modelName("super")}`,
          ...(kept.length ? { links: kept.map(({ title, url }) => ({ title, url })) } : {}),
        });
        break;
      }

      case "plan": {
        const prices = deps.prices();
        const { system, prompt } = planPrompt(profile, state.facts, state.trends, prices, input.budget, input.goal);
        const planned = readPlan(await deps.think({ system, prompt, schema: PLAN_SCHEMA, tier: "ultra" }), state.facts.length, state.trends.length, prices, input.budget);
        if (!planned.length) return await fail("I could not plan posts inside your budget from that. Try a larger budget, or tell me more about your week.");
        state = { ...state, posts: planned.map((post): WeekPost => ({ ...post, status: "planned", mediaIds: [] })) };
        log("plan", `Planned ${planned.length} post${planned.length === 1 ? "" : "s"}: ${planned.map((post) => `${FORMAT_LABEL[post.format].toLowerCase()} (${post.why})`).join("; ")}`, { model: deps.modelName("ultra") });
        break;
      }

      case "write": {
        /* The posts are written side by side: each is a writer call and a
           fact-check, and one after another took two minutes of the week. */
        const written = await Promise.all(
          state.posts.map(async (post): Promise<WeekPost> => {
            if (post.idea || post.status === "failed") return post;
            const options = { brief: writerBrief(post, state.facts, state.trends), memory: factLines(state.facts), talking: post.format === "reel" };
            // One post that will not come out right must not cost her the others: a second try, then it is marked and the week goes on.
            const idea = await deps.write(profile, options).catch(() => deps.write(profile, options)).catch((error: unknown) => {
              console.error("[week] writing failed twice —", error instanceof Error ? error.message : error);
              return null;
            });
            return idea ? { ...post, idea, status: "written" } : { ...post, status: "failed", error: "This post could not be written. Nothing was spent on it." };
          }),
        );
        state = { ...state, posts: written };
        const count = written.filter((post) => post.idea).length;
        if (!count) return await fail("None of the posts could be written. Nothing was spent. Try again in a minute.");
        log("write", `Wrote ${count} post${count === 1 ? "" : "s"} in your voice, each fact-checked against your story and what you said.`, { model: deps.modelName("super") });
        break;
      }

      case "review": {
        // Reviewed side by side too; the log lines are added in post order, so the timeline reads the same every time.
        const reviewed = await Promise.all(state.posts.map((post) => reviewPost(post)));
        state = { ...state, posts: reviewed.map((result) => result.post) };
        for (const result of reviewed) if (result.line) log("review", result.line, { model: deps.modelName("super") });
        break;
      }

      case "make": {
        const posts = [...state.posts];
        for (const [index, post] of posts.entries()) {
          if (post.childId || post.status !== "written") continue;
          try {
            const child = await children.start({
              kind: "agent",
              requestId: weekChildRequestId(job.id, index),
              avatarId: brand.avatarId,
              input: { kind: "agent", message: post.angle, request: makeRequest(post), reply: `Making your ${FORMAT_LABEL[post.format].toLowerCase()}.` },
            });
            posts[index] = { ...post, childId: child.id, status: "making" };
          } catch (error) {
            posts[index] = { ...post, status: "failed", error: error instanceof Error ? error.message : String(error) };
          }
        }
        let spent = state.creditsSpent;
        for (const [index, post] of posts.entries()) {
          if (!post.childId || post.status !== "making") continue;
          const view = await children.advance(post.childId);
          if (!view || working(view)) continue;
          if (view.status === "completed") {
            posts[index] = { ...post, status: "ready", mediaIds: view.mediaIds };
            spent += await deps.spent(job.userId, post.childId);
          } else {
            posts[index] = { ...post, status: "failed", error: view.error ?? "This post could not be made. Nothing was charged for it." };
          }
        }
        state = { ...state, posts, creditsSpent: spent };
        if (posts.some((post) => post.status === "making")) {
          state = { ...state, lease: undefined };
          await persist(context.store, job, input, state);
          return { done: false };
        }
        log("make", `Made ${posts.filter((post) => post.status === "ready").length} of ${posts.filter((post) => post.status !== "held").length}.`);
        break;
      }
    }

    const stage = nextStage(state.stage);
    state = { ...state, stage, lease: undefined };
    if (stage === "done") {
      state = { ...state, summary: weekSummary(state) };
      log("done", state.summary ?? "Your week is ready.");
    }
    await persist(context.store, job, input, state);
    return stage === "done" ? finish(state) : { done: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persist(context.store, job, input, { ...state, lease: undefined });
    throw new Error(message);
  }

  /** One post's review: kept, rewritten once (the better draft kept), or held back. A rewrite that fails keeps the first draft. */
  async function reviewPost(post: WeekPost): Promise<{ post: WeekPost; line?: string }> {
    if (!post.idea || post.review) return { post };
    const brand = await deps.brand(job.userId, job.avatarId);
    if (!brand) return { post };
    const { profile } = brand;
    const label = FORMAT_LABEL[post.format].toLowerCase();
    const first = await review(deps, profile, post.idea, state.facts, post.format);
    if ((first.keep && first.invented.length === 0) || MAX_REWRITES < 1) return { post: { ...post, review: first }, line: `${FORMAT_LABEL[post.format]} passed review (${first.score}/10). ${first.note}` };

    const rewrite = await deps
      .write(profile, { brief: writerBrief(post, state.facts, state.trends, [first.note, ...first.problems].join(" ")), memory: factLines(state.facts), talking: post.format === "reel" })
      .then(async (idea) => ({ idea, review: await review(deps, profile, idea, state.facts, post.format) }))
      .catch(() => null);
    const best = rewrite ? betterDraft({ idea: post.idea, review: first }, rewrite) : { idea: post.idea, review: first, rewritten: false };
    if (!makeable(best.review)) {
      // Still not good enough: held back, so no credits go on a post she should not publish.
      const why = reason(best.review);
      return {
        post: { ...post, idea: best.idea, review: best.review, rewritten: best.rewritten, status: "held", change: first.note, error: `Held back after review (${best.review.score}/10): ${why} Nothing was spent on it.` },
        line: `Held back the ${label}: ${best.review.score}/10 after ${rewrite ? "a rewrite" : "review"} (${why}). Nothing will be spent on it.`,
      };
    }
    if (best.rewritten && rewrite) {
      return { post: { ...post, idea: best.idea, review: best.review, rewritten: true, change: first.note }, line: `Rewrote the ${label} (${first.score}/10 → ${rewrite.review.score}/10): ${reason(first)}` };
    }
    return {
      post: { ...post, review: first },
      line: rewrite
        ? `Tried a rewrite of the ${label}, but it was ${rewrite.review.score === first.score ? "no better" : "worse"} (${rewrite.review.score}/10 against ${first.score}/10), so the first draft stays.`
        : `The ${label} scored ${first.score}/10; a rewrite could not be written, so the first draft stays.`,
    };
  }

  async function fail(message: string): Promise<RunnerStep> {
    await persist(context.store, job, input, { ...state, lease: undefined });
    return { done: true, failed: true, message };
  }
}

async function review(deps: WeekDeps, profile: BrandProfile, idea: PostIdea, facts: WeekState["facts"], format: Format) {
  const { system, prompt } = reviewPrompt(profile, idea, facts, format);
  return readReview(await deps.think({ system, prompt, schema: REVIEW_SCHEMA, tier: "super" }));
}

/** What the critic objected to, in a sentence she can read: a claim she never made, its first problem, or its note when the problem is only a label ("hook"). */
function reason(review: { problems: string[]; invented?: string[]; note: string }): string {
  const invented = review.invented?.[0]?.trim();
  if (invented) return `took out “${invented.replace(/^["“]|["”]$/g, "")}”, which you never said`;
  const first = review.problems[0]?.trim() ?? "";
  return first.split(/\s+/).length >= 4 ? first : review.note || first;
}

function finish(state: WeekState): RunnerStep {
  return { done: true, outcome: { mediaIds: state.posts.flatMap((post) => post.mediaIds), message: state.summary ?? "Your week is ready." } };
}

async function persist(store: JobStore, job: JobRecord, input: WeekJobInput, state: WeekState): Promise<void> {
  await store.transition({
    userId: job.userId,
    jobId: job.id,
    from: ["running", "queued"],
    patch: { input: { ...input, state }, provider: "week" },
  });
}

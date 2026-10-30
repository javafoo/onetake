import { InvalidRequestError } from "@/lib/errors";
import { brandFlag, writerBrief, writerProfile } from "@/content/brand-scope";
import { briefForOffer, pickOffer, withKeyword, withOffer } from "@/content/offers";
import type { BrandProfile, PostIdea, WriteOptions } from "@/content/hooks";
import { referenceQuery, type WriterContext } from "@/content/writer-context";
import { contentLanguage, languageField } from "@/content/languages";
import { maxTalkingSecondsFor, talkingSeconds } from "@/content/motion";
import { TEXT_STYLES, isTextStyle, normalizeTextStyle, type TextSize } from "@/content/text-styles";
import { clipSecondsFor } from "@/reel/timing";
import { photoPool } from "@/carousel/pick";
import type { Layout } from "@/carousel/spec";
import type { IdentityLock } from "@/identity/build";
import type { Brief } from "@/brief/build";
import type { JobStore } from "@/jobs/store";
import type { StartJobRequest } from "@/jobs";
import type { JobRecord, JobView } from "@/jobs/types";
import { creditWord } from "@/components/ui/button";

import type { DescribedClip, DirectInput } from "./direct";
import {
  applyDirection,
  childRequestId,
  initialState,
  isFinished,
  markStep,
  MAX_SOURCE_PHOTOS,
  photoModelOf,
  reelClipModel,
  reelMaterial,
  nextStep,
  type AgentJobInput,
  type AgentRequest,
  type AgentState,
  type Direction,
  type SceneIdea,
  type StepName,
} from "./plan";
import { cueKeyword } from "./given-words";
import { photoWithWords, sceneForQuote, withFraming } from "./photo-words";
import { pickSkeleton } from "./skeleton";

/* One step of an agent run, per poll.
 *
 * The run is a job of kind "agent"; this is what `src/jobs/runner.ts` calls
 * for it. Each call does one bounded thing — writes the post, makes the two
 * production decisions, starts a child job, or asks a child how it is going —
 * then writes the run's state back onto its own row and returns. The children
 * are ordinary jobs: they are priced, reserved, refunded and rate limited by
 * the same machine, under the same account, and a poll of this run is what
 * polls them.
 *
 * Everything that talks to a model or a table comes in through `AgentDeps`
 * and `ChildJobs`, so the whole run can be walked in a test with fakes. */

/** A run that has not finished in this long is stopped; what its children made stays in the library. */
export const AGENT_DEADLINE_MS = 30 * 60 * 1000;
/** Longer than any one step takes; a lease left behind by a crash lapses after this and the step is taken again. */
export const STEP_LEASE_MS = 3 * 60 * 1000;

export interface ChildJobs {
  start(request: StartJobRequest): Promise<JobView>;
  advance(jobId: string): Promise<JobView | null>;
  /** Fail a child still working, so it refunds. A child already settled is returned as it is. */
  stop(jobId: string, message: string): Promise<JobView | null>;
}

export interface BrandContext {
  avatarId: string;
  avatarName: string;
  profile: BrandProfile;
  lock: IdentityLock | null;
  brief: Brief | null;
}

export interface AgentDeps {
  /** The brand of one avatar; null falls back to the account's first. */
  brand(userId: string, avatarId: string | null): Promise<BrandContext | null>;
  /** Throws a user-facing refusal when the idea may not be made. */
  screenIdea(userId: string, idea: string): Promise<void>;
  write(profile: BrandProfile, options: WriteOptions): Promise<PostIdea>;
  /** The line for her own photo when she said what it should be rather than giving it. */
  writeWords(profile: BrandProfile, brief: string, knowledge?: string): Promise<string>;
  /**
   * The house knowledge and her memory for one writer call
   * (`src/content/writer-context.ts`). Never throws; absent means none, as in
   * tests that do not need it.
   */
  writerContext?(userId: string, avatarId: string, query: string, brand: boolean): Promise<WriterContext>;
  direct(input: DirectInput): Promise<Direction>;
  /** The motion line as the video model should receive it, from the writer's beats. */
  polishMotion(motion: string, lock: IdentityLock | null, scene: string): Promise<string>;
  planScenes(input: { brief: string; mode: "one" | "set" | "related" | "various"; count: number; scene?: string; lock: IdentityLock | null; language?: string }): Promise<SceneIdea[]>;
  /** One avatar's clips: a reel for her never reuses another avatar's footage. */
  libraryClips(userId: string, avatarId: string): Promise<DescribedClip[]>;
  addDraft(userId: string, avatarId: string, post: PostIdea): Promise<string>;
  /** Whether the photo passed the judge, and what it found. */
  photoVerdict(userId: string, mediaId: string): Promise<{ keep: boolean; problems: string[] }>;
  /** A folder for a set of photos; null when one cannot be made (the cap is reached). */
  createFolder(userId: string, name: string): Promise<string | null>;
  carouselDraft(userId: string, avatarId: string, input: { topic: string; format: "carousel" | "story"; skeleton: string }): Promise<string>;
  /** The layout decides whether scene photos (no face) may be picked. */
  carouselPhotos(userId: string, avatarId: string, count: number, layout?: Layout): Promise<string[]>;
}

type RunnerStep = { done: false } | { done: true; outcome: { mediaIds: string[]; message: string } } | { done: true; failed: true; message: string };

interface Context {
  job: JobRecord;
  input: AgentJobInput;
  deps: AgentDeps;
  children: ChildJobs;
  store: JobStore;
  now: Date;
  /**
   * Write the state down part-way through a step. A handler that has just
   * paid for something calls this before it does the next thing, so a throw
   * after that (a rate limit, the daily cap) cannot lose what was bought.
   */
  checkpoint(state: AgentState): Promise<void>;
}

type Handled = { state: AgentState; failed?: string };
type Handler = (state: AgentState, ctx: Context) => Promise<Handled>;

export async function agentStep(
  job: JobRecord,
  input: AgentJobInput,
  context: { store: JobStore; children?: ChildJobs; agent?: AgentDeps; now?: () => Date },
): Promise<RunnerStep> {
  if (!context.children || !context.agent) throw new Error("An agent run needs the job machine behind it.");
  const now = context.now?.() ?? new Date();
  let state = input.state ?? initialState(input.request);

  if (now.getTime() - job.createdAt.getTime() > AGENT_DEADLINE_MS) {
    const message = "This took too long and was stopped. Anything already made is in your library.";
    const waiting = nextStep(state);
    if (waiting) state = markStep(state, waiting.name, "failed", message, now.toISOString());
    /* The run is what is stopped; its children are what hold the credits.
       Each one the run was still waiting on gets one last poll — a finished
       child keeps its output and its charge — and one still working is
       failed, so it refunds now rather than never. */
    const stopped = await stopChildren(state, waiting?.name, context.children, message);
    state = { ...state, waitingOn: null, creditsSpent: state.creditsSpent + stopped.charged, mediaIds: [...state.mediaIds, ...stopped.mediaIds] };
    await persist(context.store, job, input, state);
    return { done: true, failed: true, message };
  }

  const step = nextStep(state);
  if (!step) return finish(state);

  /* Somebody is already on this step (the background run that started the
     job, or an earlier poll): this poll reports and leaves it alone. Seen
     live on 2026-09-23: a poll landed during the write step, wrote a second
     post and a second draft, and the reel was printed from the wrong one. */
  if (state.lease && Date.parse(state.lease.until) > now.getTime()) return { done: false };

  state = {
    ...markStep(state, step.name, "running", undefined, now.toISOString()),
    lease: { step: step.name, until: new Date(now.getTime() + STEP_LEASE_MS).toISOString() },
  };
  // The lease is written before the work starts, so the next poll can see it.
  await persist(context.store, job, input, state);

  // What the handler last wrote down, so a throw fails the latest state, not the one it started from.
  let latest = state;
  const ctx: Context = {
    job,
    input,
    deps: context.agent,
    children: context.children,
    store: context.store,
    now,
    checkpoint: async (checkpointed) => {
      latest = checkpointed;
      await persist(context.store, job, input, checkpointed);
    },
  };

  let handled: Handled;
  try {
    handled = await HANDLERS[step.name](state, ctx);
  } catch (error) {
    /* The note is what she reads under the step; the job's own error, set by
       the machine from this throw, is what she reads at the bottom. */
    const message = error instanceof Error ? error.message : String(error);
    /* Children this step had already started are paid for whatever the
       throw was about; the step only sums them when they all finish, so
       without this the failed run says it cost nothing while they run. */
    const charged = await chargedByChildren(latest, step.name, context.children);
    const failedState = { ...latest, waitingOn: null, lease: undefined, creditsSpent: latest.creditsSpent + charged };
    await persist(context.store, job, input, markStep(failedState, step.name, "failed", message, now.toISOString()));
    throw error;
  }
  state = handled.failed
    ? markStep({ ...handled.state, waitingOn: null, lease: undefined }, step.name, "failed", handled.failed, now.toISOString())
    : { ...handled.state, lease: undefined };
  await persist(context.store, job, input, state);
  if (handled.failed) return { done: true, failed: true, message: handled.failed };
  return isFinished(state) ? finish(state) : { done: false };
}

/* No `costUsd`: the run's model calls were estimated when it started and are
   never billed as one figure, so the estimate stands in `provider_costs` and
   keeps counting toward the daily cap. Settling at zero used to erase it. */
function finish(state: AgentState): RunnerStep {
  return { done: true, outcome: { mediaIds: state.mediaIds, message: state.summary ?? "Done." } };
}

/**
 * The deadline's last word on the children of the step that was running.
 * Returns what the finished ones charged and made, so the run's totals stay
 * true; a child still working is failed and refunds.
 */
async function stopChildren(
  state: AgentState,
  step: StepName | undefined,
  children: ChildJobs,
  message: string,
): Promise<{ charged: number; mediaIds: string[] }> {
  const ids = step ? state.children[step] ?? [] : [];
  let charged = 0;
  const mediaIds: string[] = [];
  for (const id of ids) {
    const polled = await children.advance(id);
    const view = polled && working(polled) ? await children.stop(id, message) : polled;
    if (!view || view.status !== "completed") continue;
    charged += view.creditsCharged;
    mediaIds.push(...view.mediaIds.filter((mediaId) => !state.mediaIds.includes(mediaId)));
  }
  return { charged, mediaIds };
}

/** What a step's children have taken from the balance so far, one poll each. A queued child has already reserved its price. */
async function chargedByChildren(state: AgentState, step: StepName, children: ChildJobs): Promise<number> {
  let charged = 0;
  for (const id of state.children[step] ?? []) charged += (await children.advance(id))?.creditsCharged ?? 0;
  return charged;
}

/* The state goes back onto the run's own row, beside the request it belongs
   to, the way a clip keeps its provider status URL. `providerRequestId` names
   the child the run is waiting on, which also keeps the machine's stuck rule
   off a run that is legitimately waiting minutes for a clip. */
async function persist(store: JobStore, job: JobRecord, input: AgentJobInput, state: AgentState): Promise<void> {
  await store.transition({
    userId: job.userId,
    jobId: job.id,
    from: ["running", "queued"],
    patch: {
      input: { ...input, state },
      provider: "agent",
      providerRequestId: state.waitingOn,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Helpers shared by the handlers                                       */
/* ------------------------------------------------------------------ */

const done = (state: AgentState, name: StepName, note: string): Handled => ({ state: markStep({ ...state, waitingOn: null }, name, "done", note) });
const waiting = (state: AgentState, name: StepName, note: string, childId: string): Handled => ({
  state: markStep({ ...state, waitingOn: childId }, name, "running", note),
});

/* Every handler reads the brand through here, so a run with the brand off
   hands every writer, the director included, the scoped profile. The
   identity lock is not brand: her face and places stay. With more than one
   offer, the one her message is about is the one every writer sees. */
async function brandOf(ctx: Context): Promise<BrandContext> {
  const brand = await ctx.deps.brand(ctx.job.userId, ctx.job.avatarId);
  if (!brand) throw new InvalidRequestError("Fill in the Brand page first: niche, audience, offer and keyword.");
  const on = brandFlag(ctx.input.brand);
  const offer = offerOf(brand.profile, ctx);
  // A keyword she named for this post ("Comment CASH") is the one it asks for, over the offer's own.
  const profile = withKeyword(withOffer(brand.profile, offer), requestKeyword(ctx.input.request));
  return { ...brand, profile: writerProfile(profile, on), brief: writerBrief(briefForOffer(brand.brief, brand.profile, offer), on) };
}

/** Reference material for a writer in this run, found for `query`, with the run's brand flag. */
async function contextFor(ctx: Context, brand: BrandContext, ...query: (string | undefined)[]): Promise<WriterContext> {
  if (!ctx.deps.writerContext) return {};
  return ctx.deps.writerContext(ctx.job.userId, brand.avatarId, referenceQuery(...query), brandFlag(ctx.input.brand));
}

/** The keyword she named in her message, on the requests that can carry one. */
function requestKeyword(request: AgentRequest): string | undefined {
  return request.kind === "reel" || request.kind === "carousel" ? request.keyword : undefined;
}

/** Which of her offers this run sells, from what she typed. */
function offerOf(profile: BrandProfile, ctx: Context): number {
  return pickOffer(profile, ctx.input.message);
}

function reelRequest(input: AgentJobInput): Extract<AgentRequest, { kind: "reel" }> {
  if (input.request.kind !== "reel") throw new Error("This step belongs to a reel run.");
  return input.request;
}

/** Start the step's child if it has none yet, otherwise ask it how it is going. */
async function child(state: AgentState, name: StepName, ctx: Context, start: () => Promise<StartJobRequest>): Promise<{ state: AgentState; view: JobView | null; started: boolean }> {
  const existing = state.children[name]?.[0];
  if (!existing) {
    const view = await ctx.children.start(await start());
    return { state: { ...state, children: { ...state.children, [name]: [view.id] } }, view, started: true };
  }
  return { state, view: await ctx.children.advance(existing), started: false };
}

const working = (view: JobView) => view.status === "queued" || view.status === "running";

/* ------------------------------------------------------------------ */
/* The reel                                                            */
/* ------------------------------------------------------------------ */

const write: Handler = async (state, ctx) => {
  const request = reelRequest(ctx.input);
  const brand = await brandOf(ctx);
  await ctx.deps.screenIdea(ctx.job.userId, [request.brief, request.scene].filter(Boolean).join(". "));
  // Found for her hook when she wrote one, otherwise for what the post is about.
  const context = await contextFor(ctx, brand, request.hook ?? request.brief);
  const post = await ctx.deps.write(brand.profile, {
    ...context,
    visual: true,
    brief: request.brief,
    scene: request.scene,
    places: brand.lock?.scenes,
    format: request.talking ? "talking" : "loop",
    // Her script is written for the clip it will be spoken in: eight seconds on Omni, twelve otherwise.
    ...(request.talking ? { talkingSeconds: maxTalkingSecondsFor(reelClipModel(request)) } : {}),
    style: normalizeTextStyle(request.style),
    hook: request.hook,
    template: request.hook ? undefined : request.template,
    reference: request.reference,
  });
  const draftId = await ctx.deps.addDraft(ctx.job.userId, brand.avatarId, post);
  const spoken = request.talking && post.spoken ? `\nShe says: “${post.spoken}”` : "";
  return done({ ...state, post, draftId }, "write", `Hook: “${post.hook}”${spoken}`);
};

const direct: Handler = async (state, ctx) => {
  const request = reelRequest(ctx.input);
  if (!state.post) throw new Error("No post to direct.");
  const brand = await brandOf(ctx);
  const attached = reelMaterial(request);
  /* Footage she attached is the footage: the library is not offered, so the
     director only decides the second line. */
  const library = request.talking || attached.clip || attached.photo ? [] : await ctx.deps.libraryClips(ctx.job.userId, brand.avatarId);
  /* Words on screen she wrote herself get no "Comment <brand keyword>" line
     under them; a keyword she named is the one a second line may ask for. */
  const direction = await ctx.deps.direct({ post: state.post, keyword: cueKeyword(request, brand.profile), request, library, ...languageField(brand.profile.language) });
  const footage = attached.clip
    ? "Using the clip you attached."
    : attached.photo
      ? "Animating the photo you attached."
      : direction.clip
    ? `Using a clip you already have: ${direction.clip.why}`
    : request.talking
      ? "A talking clip is always new footage."
      : request.footage === "new"
        ? "Making new footage, as you asked."
        : "Nothing in your library shows this scene, so a new photo and clip are needed.";
  const cue = direction.cue ? `Second line “${direction.cue.text}”: ${direction.cue.why}` : `No second line: ${direction.noCueWhy}`;
  return done(applyDirection(state, direction), "direct", `${footage}\n${cue}`);
};

const photo: Handler = async (state, ctx) => {
  const request = reelRequest(ctx.input);
  const visual = state.post?.visual;
  if (!visual) throw new Error("This post has no visual brief.");
  const { state: next, view, started } = await child(state, "photo", ctx, async () => {
    await ctx.deps.screenIdea(ctx.job.userId, visual.scene);
    return {
      kind: "image",
      avatarId: ctx.job.avatarId,
      requestId: childRequestId(ctx.job.id, "photo"),
      input: { kind: "image", idea: visual.scene, shot: visual.shot, aspect: "9:16", model: photoModelOf(request), folderId: null },
    };
  });
  if (!view) return { state: next, failed: "The photo could not be found. Try again from here." };
  if (started || working(view)) return waiting(next, "photo", started ? `Making the photo: ${visual.scene}` : "Making the photo, about a minute.", view.id);
  if (view.status === "failed") return { state: next, failed: `The photo could not be made. ${view.error ?? ""}`.trim() };

  const mediaId = view.mediaIds[0];
  if (!mediaId) return { state: next, failed: "The photo job finished without a photo." };
  const verdict = await ctx.deps.photoVerdict(ctx.job.userId, mediaId);
  const spent = next.creditsSpent + view.creditsCharged;
  if (!verdict.keep) {
    /* Animating a photo with a hard fault would waste the clip's credits, so
       the run stops here and says why. The photo is in the library, hidden. */
    return {
      state: { ...next, photoMediaId: mediaId, creditsSpent: spent, mediaIds: [...next.mediaIds, mediaId] },
      failed: `The photo failed the check (${verdict.problems.join("; ")}). Try again for another photo, or make one yourself on the Library page.`,
    };
  }
  return done({ ...next, photoMediaId: mediaId, creditsSpent: spent, mediaIds: [...next.mediaIds, mediaId] }, "photo", view.message ?? "Photo made.");
};

const clip: Handler = async (state, ctx) => {
  const request = reelRequest(ctx.input);
  const post = state.post;
  if (!post?.visual || !state.photoMediaId) throw new Error("No photo to animate.");
  const talking = request.talking && Boolean(post.spoken);
  /* The clip is made as long as the reel will be, so the reel never loops it
     and she is moving for the whole of it. */
  const model = reelClipModel(request);
  // Her language sets how fast the line is spoken; the brand is read once more below, where the job is started.
  const language = talking ? contentLanguage((await brandOf(ctx)).profile) : undefined;
  const seconds = talking
    ? talkingSeconds(post.spoken as string, undefined, maxTalkingSecondsFor(model), language)
    : clipSecondsFor(post.hook, state.direction?.cue?.text);
  const { state: next, view, started } = await child(state, "clip", ctx, async () => {
    const brand = await brandOf(ctx);
    const motion = talking ? (post.spoken as string) : await ctx.deps.polishMotion(post.visual!.motion, brand.lock, post.visual!.scene);
    return {
      kind: "clip",
      avatarId: ctx.job.avatarId,
      requestId: childRequestId(ctx.job.id, "clip"),
      input: {
        kind: "clip",
        imageMediaId: state.photoMediaId!,
        motion,
        idea: talking ? undefined : post.visual!.motion,
        seconds,
        model,
        aspectRatio: "9:16",
        speech: talking,
        ...(talking ? languageField(brand.profile.language) : {}),
      },
    };
  });
  if (!view) return { state: next, failed: "The clip could not be found. Try again from here." };
  if (started || working(view)) {
    return waiting(next, "clip", started ? (talking ? `Animating her saying the line, ${seconds} seconds. Two to four minutes.` : `Animating a ${seconds}-second clip to fit the hook. Two to four minutes.`) : "The video service is still working on it.", view.id);
  }
  if (view.status === "failed") return { state: next, failed: `The clip could not be made. ${view.error ?? ""}`.trim() };
  const mediaId = view.mediaIds[0];
  if (!mediaId) return { state: next, failed: "The clip job finished without a clip." };
  return done({ ...next, clipMediaId: mediaId, creditsSpent: next.creditsSpent + view.creditsCharged, mediaIds: [...next.mediaIds, mediaId] }, "clip", view.message ?? "Clip made.");
};

const reel: Handler = async (state, ctx) => {
  const request = reelRequest(ctx.input);
  if (!state.draftId || !state.clipMediaId) throw new Error("No clip to put the hook on.");
  const { state: next, view, started } = await child(state, "reel", ctx, async () => ({
    kind: "reel",
    avatarId: ctx.job.avatarId,
    requestId: childRequestId(ctx.job.id, "reel"),
    input: {
      kind: "reel",
      draftId: state.draftId!,
      clipMediaId: state.clipMediaId!,
      cue: state.direction?.cue?.text,
      mode: request.talking ? "talking" : "loop",
      style: normalizeTextStyle(request.style),
      ...lookInput(request),
    },
  }));
  if (!view) return { state: next, failed: "The reel could not be found. Try again from here." };
  if (started || working(view)) return waiting(next, "reel", `Building the reel in the ${TEXT_STYLES[normalizeTextStyle(request.style)].label} style, about ten seconds.`, view.id);
  if (view.status === "failed") return { state: next, failed: `The reel could not be rendered. ${view.error ?? ""}`.trim() };
  const mediaId = view.mediaIds[0];
  const spent = next.creditsSpent + view.creditsCharged;
  const cost = spent > 0 ? `It cost ${creditWord(spent)}.` : "It cost nothing: the clip was already in your library.";
  const summary = `Your reel is ready. ${cost} It is on the Reels page too, where you can give it a day.`;
  return done({ ...next, creditsSpent: spent, mediaIds: mediaId ? [...next.mediaIds, mediaId] : next.mediaIds, summary }, "reel", view.message ?? "Reel rendered.");
};

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

const plan: Handler = async (state, ctx) => {
  const request = ctx.input.request;
  const brand = await brandOf(ctx);
  await ctx.deps.screenIdea(ctx.job.userId, request.brief);

  if (request.kind === "photos") {
    /* A quote post with no quote given: the quote is written first, so the
       photo is planned to suit what it says, and written down so the words
       step and a retry draw the same line. */
    let next = state;
    if (request.wordsBrief && !request.words && !next.words) {
      next = { ...next, words: await ctx.deps.writeWords(brand.profile, request.wordsBrief, (await contextFor(ctx, brand, request.wordsBrief)).knowledge) };
      await ctx.checkpoint(next);
    }
    const brief = request.wordsBrief && next.words ? sceneForQuote(request.brief, next.words) : request.brief;
    const planned = await ctx.deps.planScenes({ brief, mode: request.mode, count: request.count, scene: request.scene, lock: brand.lock, ...languageField(brand.profile.language) });
    const scenes = withFraming(planned, request.framing);
    for (const scene of scenes) await ctx.deps.screenIdea(ctx.job.userId, scene.idea);
    const list = scenes.map((scene, index) => `${index + 1}. ${scene.idea}`).join("\n");
    const quote = request.wordsBrief && next.words ? `\nQuote: “${next.words}”` : "";
    return done({ ...next, scenes }, "plan", `${scenes.length === 1 ? "One photo" : `${scenes.length} photos`}:\n${list}${quote}`);
  }

  if (request.kind === "carousel") {
    const skeleton = pickSkeleton(request.brief);
    const own = request.slideTexts?.length ?? 0;
    const needed = photoPool(request.format, request.layout);
    // Photos she attached are the set's photos, in her order; nothing is picked for her.
    const attached = request.material?.photos ?? [];
    const photos = attached.length ? attached : await ctx.deps.carouselPhotos(ctx.job.userId, brand.avatarId, needed, request.layout);
    if (photos.length === 0) throw new InvalidRequestError("There are no photos to build a cover from. Make one first, or ask me for a photo.");
    const where =
      request.layout === "split"
        ? `Two photos on every slide, from ${photos.length} of yours`
        : request.layout === "grid"
          ? `Four photos on the cover and one on each slide after, from ${photos.length} of yours`
          : request.layout === "photos"
            ? `Every slide on a photo, from ${photos.length} of yours`
            : `Covers from ${photos.length} of your photos`;
    /* A cover she pointed at is rewritten for her once, here, and then drawn
       as her own words: the set's writer never sees someone else's. */
    const cover = own ? undefined : (request.cover ?? (request.coverTemplate ? (await ctx.deps.write(brand.profile, { ...(await contextFor(ctx, brand, request.brief)), brief: request.brief, template: request.coverTemplate })).hook : undefined));
    const draftId = await ctx.deps.carouselDraft(ctx.job.userId, brand.avatarId, { topic: request.brief, format: request.format, skeleton: skeleton.id });
    const look = request.kit && isTextStyle(request.kit) ? `the ${TEXT_STYLES[request.kit].label} look` : "the house look";
    const shape = own ? `Your ${own} slides, word for word, in your order, with nothing added after the last.` : `Shape: ${skeleton.label}. ${skeleton.why}`;
    return done({ ...state, draftId, photoIds: photos, ...(cover ? { cover } : {}) }, "plan", `${shape} ${attached.length ? `Your ${attached.length === 1 ? "photo" : `${attached.length} photos`} in the order you attached them${own ? "" : "; any slide past them is plain paper"}` : where}, in ${look}.${request.coverTemplate && cover ? `\nCover, made yours: “${cover}”` : ""}`);
  }
  throw new Error("This step belongs to a photo or carousel run.");
};

const photos: Handler = async (state, ctx) => {
  const request = ctx.input.request;
  const scenes = state.scenes;
  if (request.kind !== "photos" || !scenes) throw new Error("No scenes to make.");
  let next = state;
  const ids = next.children.photos ?? [];
  const sources = (request.material?.photos ?? []).slice(0, MAX_SOURCE_PHOTOS);
  if (ids.length < scenes.length) {
    /* The folder is made here, when the photos are, so a run that stops at
       the plan (a refusal, a model error) leaves no empty folder behind; a
       retry that already has one keeps it. */
    if (scenes.length > 1 && next.folderId === undefined) {
      next = { ...next, folderId: await ctx.deps.createFolder(ctx.job.userId, folderName(request.brief)) };
    }
    /* Only the scenes with no child yet. Each start is paid for, and the
       state is written after each one, so the fifth start throwing (a rate
       limit, the daily cap) leaves the first four on the row: "Try again
       from here" then starts the missing ones and prices only those, rather
       than orphaning four paid photos and buying all five again. */
    const started = [...ids];
    for (const [index, scene] of scenes.entries()) {
      if (index < started.length) continue;
      const view = await ctx.children.start({
        kind: "image",
        avatarId: ctx.job.avatarId,
        requestId: childRequestId(ctx.job.id, "photos", index),
        input: {
          kind: "image",
          idea: scene.idea,
          shot: scene.shot,
          aspect: request.aspect,
          model: photoModelOf(request),
          folderId: next.folderId ?? null,
          ...(sources.length ? { sourceMediaIds: sources } : {}),
          ...(request.lookMediaIds?.length ? { lookMediaIds: request.lookMediaIds, ...(request.lookMode ? { lookMode: request.lookMode } : {}) } : {}),
        },
      });
      started.push(view.id);
      next = { ...next, children: { ...next.children, photos: [...started] }, waitingOn: started[0] };
      await ctx.checkpoint(next);
    }
    const filed = next.folderId ? ` They go in the folder “${folderName(request.brief)}”.` : "";
    return waiting(next, "photos", `Making ${started.length === 1 ? "the photo" : `${started.length} photos`}, about a minute each.${filed}`, started[0]);
  }

  const views: JobView[] = [];
  for (const id of ids) {
    const view = await ctx.children.advance(id);
    if (view) views.push(view);
  }
  const still = views.filter(working);
  if (still.length) return waiting(next, "photos", `${views.length - still.length} of ${views.length} done.`, still[0].id);

  const made = views.filter((view) => view.status === "completed").flatMap((view) => view.mediaIds);
  const failed = views.filter((view) => view.status === "failed");
  const spent = views.reduce((sum, view) => sum + view.creditsCharged, 0);
  if (made.length === 0) return { state: { ...next, creditsSpent: spent }, failed: `None of the photos could be made. ${failed[0]?.error ?? ""}`.trim() };
  if (photoWithWords(request)) {
    /* Words drawn on a photo with a hard fault would hand her a post she
       cannot use, so the run stops here and says why, as a reel does before
       its clip. The photo stays in the library. */
    const photoId = made[0];
    const verdict = await ctx.deps.photoVerdict(ctx.job.userId, photoId);
    const kept = { ...next, photoMediaId: photoId, mediaIds: [photoId], creditsSpent: spent };
    if (!verdict.keep) {
      return { state: kept, failed: `The photo failed the check (${verdict.problems.join("; ")}). Try again for another photo; the words go on once one passes.` };
    }
    return done(kept, "photos", "Photo made.");
  }
  const problems = failed.length ? ` ${failed.length} could not be made and ${failed.length === 1 ? "was" : "were"} not charged.` : "";
  const summary = `${made.length === 1 ? "Your photo is" : `${made.length} photos are`} in your library${next.folderId ? ", in their own folder" : ""}. It cost ${creditWord(spent)}.${problems}`;
  return done({ ...next, mediaIds: made, creditsSpent: spent, summary }, "photos", `${made.length} made.${problems}`);
};

/* ------------------------------------------------------------------ */
/* The carousel                                                        */
/* ------------------------------------------------------------------ */

const render: Handler = async (state, ctx) => {
  const request = ctx.input.request;
  if (request.kind !== "carousel" || !state.draftId) throw new Error("No set to draw.");
  const photoIds = state.photoIds ?? [];
  const brand = await ctx.deps.brand(ctx.job.userId, ctx.job.avatarId);
  // The set sells the offer her message was about; the job would otherwise guess from the rewritten topic.
  const offer = brand ? offerOf(brand.profile, ctx) : 0;
  const { state: next, view, started } = await child(state, "render", ctx, async () => ({
    kind: "carousel",
    avatarId: ctx.job.avatarId,
    requestId: childRequestId(ctx.job.id, "render"),
    input: {
      kind: "carousel",
      draftId: state.draftId!,
      format: request.format,
      topic: request.brief,
      skeleton: pickSkeleton(request.brief).id,
      layout: request.layout,
      kit: request.kit ?? "signal",
      photoMediaIds: photoIds,
      ...(request.material?.photos.length ? { photosOnce: true } : {}),
      coverTitle: state.cover ?? request.cover,
      reference: request.reference,
      slides: request.slides,
      ...(request.slideTexts?.length ? { slideTexts: request.slideTexts } : {}),
      ...(request.keyword ? { keyword: request.keyword } : {}),
      ...(brandFlag(ctx.input.brand) ? {} : { brand: false }),
      ...(offer > 0 ? { offer } : {}),
      ...lookInput(request),
    },
  }));
  if (!view) return { state: next, failed: "The set could not be found. Try again from here." };
  if (started || working(view)) return waiting(next, "render", "Writing the slides and drawing them, about a minute.", view.id);
  if (view.status === "failed") return { state: next, failed: `The set could not be made. ${view.error ?? ""}`.trim() };
  const summary = `Your ${request.format === "story" ? "story sequence" : "carousel"} is ready: ${view.mediaIds.length} slides. It cost nothing. Open it on the Carousels page to read every slide, change a photo or give it a day.`;
  return done({ ...next, mediaIds: view.mediaIds, summary }, "render", view.message ?? "Set drawn.");
};

/* ------------------------------------------------------------------ */
/* Words on her photo                                                  */
/* ------------------------------------------------------------------ */

const words: Handler = async (state, ctx) => {
  const request = ctx.input.request;
  if (request.kind !== "text_photo" && request.kind !== "photos") throw new Error("This step belongs to a words-on-a-photo run.");
  /* Her own photo for words on a photo; the photo this run just made for a
     photo with words. */
  const photoId = request.kind === "text_photo" ? request.material?.photos[0] : state.photoMediaId;
  if (!photoId) throw new InvalidRequestError(request.kind === "text_photo" ? "Attach the photo with + first. The words go on your own photo." : "There is no photo to put the words on. Try again from here.");
  let next = state;
  let text = request.kind === "text_photo" ? request.words || state.words : request.words?.trim() || state.words;
  // Written by us, not given by her: the card says what was written.
  let written = false;
  if (!text && request.kind === "photos" && request.wordsLike && !state.children.words?.length) {
    /* "A quote like this": a line of about the same length and shape, in her
       voice, from the shape path of the hook writer, so nothing of the
       original's is kept but its form. Written once and written down. */
    const brand = await brandOf(ctx);
    const post = await ctx.deps.write(brand.profile, {
      ...(await contextFor(ctx, brand, request.wordsLike, request.brief)),
      brief: `A short quote to put on a photo of her. The photo: ${request.brief}`,
      reference: request.wordsLike,
    });
    text = post.hook;
    next = { ...next, words: text };
    await ctx.checkpoint(next);
  }
  if (!text && (request.kind === "text_photo" || request.kind === "photos") && request.wordsBrief && !state.children.words?.length) {
    /* She said what the words should be rather than giving them: written once,
       on the subject she asked for and in her voice (not by the hook writer,
       which pulls every line toward her niche), and written down so a retry
       draws the same words. */
    const brand = await brandOf(ctx);
    text = await ctx.deps.writeWords(brand.profile, request.wordsBrief, (await contextFor(ctx, brand, request.wordsBrief)).knowledge);
    written = true;
    next = { ...next, words: text };
    await ctx.checkpoint(next);
  }
  if (!text) throw new Error("There are no words to put on the photo.");
  const style = normalizeTextStyle(request.style);
  const words = text;
  const { state: after, view, started } = await child(next, "words", ctx, async () => ({
    kind: "text_photo",
    avatarId: ctx.job.avatarId,
    requestId: childRequestId(ctx.job.id, "words"),
    input: {
      kind: "text_photo",
      photoMediaId: photoId,
      text: words,
      style,
      ...lookInput(request),
      ...(request.kind === "text_photo" && request.aspect ? { aspect: request.aspect } : {}),
      // Lowercasing follows her language's rules; only asked for when there is lowercasing to do.
      ...(request.lowercase === true ? languageField((await brandOf(ctx)).profile.language) : {}),
    },
  }));
  if (!view) return { state: after, failed: "The photo with your words could not be found. Try again from here." };
  const ours = written || (request.kind === "photos" && Boolean(request.wordsLike || request.wordsBrief)) || (request.kind === "text_photo" && !request.words);
  if (started || working(view)) return waiting(after, "words", `Drawing ${ours ? `“${words}”` : "your words"} in the ${TEXT_STYLES[style].label} look, a few seconds.`, view.id);
  if (view.status === "failed") return { state: after, failed: `The words could not be put on the photo. ${view.error ?? ""}`.trim() };
  if (request.kind === "photos") {
    // Both are hers: the clean photo, then the copy with the words.
    const mediaIds = [...after.mediaIds.filter((id) => !view.mediaIds.includes(id)), ...view.mediaIds];
    const summary = `Your photo is in your library, and a copy with the words on it. It cost ${creditWord(after.creditsSpent)}; the words were free.`;
    return done({ ...after, mediaIds, summary }, "words", view.message ?? "Words drawn.");
  }
  const summary = ours
    ? `Your photo with “${words}” on it is in your library, on the Quotes tab. It cost nothing. Want different words? Say so, or type your own in quotes.`
    : "Your photo with the words is in your library, on the Quotes tab. It cost nothing.";
  return done({ ...after, mediaIds: view.mediaIds, summary }, "words", view.message ?? "Words drawn.");
};

/** Size and case as a child job carries them: only what differs from large, as typed, so older runs read the same. */
function lookInput(request: { size?: TextSize; lowercase?: boolean }): { size?: TextSize; lowercase?: boolean } {
  return { ...(request.size === "small" ? { size: "small" as const } : {}), ...(request.lowercase === true ? { lowercase: true } : {}) };
}

const HANDLERS: Record<StepName, Handler> = { write, direct, photo, clip, reel, plan, photos, render, words };

/** A folder name from what she asked for: the first few words, tidied. */
export function folderName(brief: string): string {
  const words = brief.trim().replace(/[^\p{L}\p{N}\s'-]/gu, "").split(/\s+/).filter(Boolean).slice(0, 5);
  const name = words.join(" ");
  return (name ? name.charAt(0).toUpperCase() + name.slice(1) : "Agent photos").slice(0, 40);
}

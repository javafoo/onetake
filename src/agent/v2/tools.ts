import type { FunctionCall, InlineImage, ToolDecl } from "@/ai/gemini";
import { LAYOUTS, type Layout } from "@/carousel/spec";
import type { BrandProfile } from "@/content/hooks";
import { IMAGE_MODELS, type ImageModel } from "@/content/image-options";
import { TEXT_STYLE_IDS, type TextStyle } from "@/content/text-styles";
import type { StartJobRequest } from "@/jobs";
import { isUserFacing } from "@/lib/errors";

import { withOptions, type AskOptions } from "../options";
import { agentCredits, agentNoun, MAX_LOOKS, MAX_PHOTOS, type AgentRequest, type Material, type PhotoMode } from "../plan";

import { jobCardKind, toolLabel } from "./labels";
import type { Offer, ThreadMessage, TurnEvent } from "./types";

/* The agent's tools: what the model is told it can call, and what each call
   does. Declarations are plain data. Handlers reach the app only through
   `ToolDeps`, so the loop runs in a test with fakes and no network.

   Money is decided here, in code, never by the model. A paid tool prices its
   work with the same estimator the old chat uses (`agentCredits`), then
   either starts it, when the budget she stated in this chat covers it, or
   returns an offer: a button with a price that only her tap can press. Every
   job is an ordinary agent run whose paid children reserve and refund as
   they always have, under a request id fixed by the thread, the turn and the
   call, so a retried turn cannot start it twice. */

export type LibraryKind = "photo" | "clip" | "reel" | "set";
export type LibraryItem = { id: string; kind: LibraryKind; label: string; favorite: boolean };
export type PostItem = { draftId: string; format: string; hook: string; status: string; finished: boolean; createdAt: string };

export interface ToolDeps {
  /** The reference block a writer gets for this query, or "" when there is none. */
  reference(query: string): Promise<string>;
  /** Her remembered facts, as writer lines. */
  memory(): Promise<string[]>;
  /** What `read_brand` returns. */
  brand(): Promise<Record<string, unknown>>;
  library(kind: LibraryKind, options: { favorites: boolean; query: string }): Promise<LibraryItem[]>;
  recentPosts(n: number): Promise<PostItem[]>;
  writePost(input: { brief: string; hook?: string; talking: boolean; knowledge: string; memory: string[] }): Promise<{ draftId: string; hook: string; caption: string; cta: string }>;
  writeHooks(input: { count: number; topic: string; knowledge: string; memory: string[] }): Promise<{ hooks: string[]; dropped: number }>;
  /** Her library items, owner-checked; throws a sentence she can read when one is not hers. */
  ownMaterial(material: Material): Promise<Material>;
  addFact(text: string): Promise<string>;
  /** Throws a sentence she can read when her balance cannot pay `credits`. */
  affordable(credits: number, noun: string): Promise<void>;
  /** Saves pasted screenshots as hidden photos of hers, under ids fixed by `requestId`, so a retried turn finds the same ones. */
  saveLooks(images: InlineImage[], requestId: string): Promise<string[]>;
  startJob(request: StartJobRequest): Promise<{ jobId: string; created: boolean }>;
  newId(): string;
  now(): Date;
}

export type ToolContext = {
  threadId: string;
  avatarId: string;
  /** Which of her messages this is, from 1. Part of every job's request id. */
  turn: number;
  /** Her message this turn: a budget is only taken from her own words. */
  message: string;
  profile: BrandProfile;
  /** What this chat may still spend without asking, counting what this turn already spent. */
  budgetLeft: number;
  /** The pickers in her box: text look, image model and shape, video model, slides format and layout. */
  options?: AskOptions;
  /** The screenshots pasted with this message, already screened. */
  screenshots?: InlineImage[];
};

/** What one call did: the answer for the model, and what it adds to the thread and the stream. */
export type ToolOutcome = {
  /** What the model is sent. */
  result: Record<string, unknown>;
  /** What the thread keeps in place of `result`, when that is smaller or must not be kept. */
  stored?: Record<string, unknown>;
  events: TurnEvent[];
  messages: ThreadMessage[];
  offers: Offer[];
  spent: number;
  budget?: number;
  /** The one sentence she is told when this call only started a job or made an offer, so the model need not write it. */
  reply?: string;
};

const outcome = (result: Record<string, unknown>, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ result, events: [], messages: [], offers: [], spent: 0, ...extra });

/* ---- Declarations -------------------------------------------------------- */

const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const bool = (description: string) => ({ type: "boolean", description });
const strs = (description: string) => ({ type: "array", items: { type: "string" }, description });
const oneOf = (values: readonly string[], description: string) => ({ type: "string", enum: [...values], description });
const object = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, ...(required.length ? { required } : {}) });

export const TOOLS: ToolDecl[] = [
  { name: "read_brand", description: "Her brand profile and the facts remembered about her.", parameters: object({}) },
  {
    name: "search_library",
    description: "Find items in her library. Returns ids, kinds, short labels and whether she hearted them. Favorites come first.",
    parameters: object(
      {
        kind: oneOf(["photo", "clip", "reel", "set"], "What to look for."),
        query: str("Words to match, optional."),
        favorites: bool("Only hearted items."),
      },
      ["kind"],
    ),
  },
  { name: "recent_posts", description: "Her newest drafts and posts, newest first.", parameters: object({ n: int("How many, 1 to 10.") }) },
  {
    name: "write_post",
    description: "Write one post (hook, caption, call to action) in her voice and save it as a draft. Free.",
    parameters: object(
      {
        format: oneOf(["reel", "talking"], "reel: a hook over a silent clip. talking: she speaks to camera."),
        brief: str("What the post is about, in her words."),
        goal: str("What the post should do: reach, trust, or sell. Optional."),
        hook: str("Her own hook, used word for word. Optional."),
      },
      ["format", "brief"],
    ),
  },
  {
    name: "write_hooks",
    description: "Write hooks and save them to her Hooks page. Free.",
    parameters: object({ count: int("How many, 1 to 10."), topic: str("What the hooks are about and the technique she asked for.") }, ["count"]),
  },
  {
    name: "make_photos",
    description: "Make new photos of her. Costs credits: returns an offer unless this chat's budget covers it.",
    parameters: object(
      {
        idea: str("The scene: where she is and what she is doing."),
        count: int(`How many photos, 1 to ${MAX_PHOTOS}.`),
        mode: oneOf(["one", "set", "related", "various"], "one photo; a set from one shoot; related scenes; unrelated scenes."),
        model: oneOf(Object.keys(IMAGE_MODELS), "Image model. daily is the default."),
        sourceMediaIds: strs("Photo ids from her library to draw from (same outfit, same place). Optional."),
        words: str("A quote to draw on the new photo, exactly, once it is made. One photo only. Free. Optional."),
        style: oneOf(TEXT_STYLE_IDS, "The text look for those words. Optional."),
        recreateHow: oneOf(["match", "swap"], "With recreate. match: a new photo that follows the screenshot's shot. swap: the screenshot itself with her face in it, everything else kept, for when she wants the exact photo. Uses Pro. Optional."),
        recreate: bool("Make it look like the screenshot she pasted: same pose, framing, light and blur, with her in it. One photo. Then idea is only what she changes (hair, outfit)."),
      },
      ["idea"],
    ),
  },
  {
    name: "make_reel",
    description: "Make a reel: a hook on screen over a clip. Costs credits for a new photo and clip unless she gives her own clip; returns an offer unless this chat's budget covers it.",
    parameters: object(
      {
        brief: str("What the reel is about."),
        hook: str("The hook, used word for word. Optional: written for her if absent."),
        talking: bool("She speaks to camera with sound."),
        scene: str("The scene under the hook. Optional."),
        clipMediaId: str("A clip id from her library to use. Makes the reel free."),
        photoMediaId: str("A photo id from her library to animate. Saves the photo's price."),
        style: oneOf(TEXT_STYLE_IDS, "The text look. Optional."),
      },
      ["brief"],
    ),
  },
  {
    name: "make_carousel",
    description: "Make a carousel set: written, drawn and saved. Free.",
    parameters: object(
      {
        topic: str("What the carousel is about."),
        slides: int("How many slides. Optional."),
        layout: oneOf(LAYOUTS, "mixed is the default. photos: every slide on a photo."),
        photoMediaIds: strs("Photo ids from her library to use, in order. Optional."),
      },
      ["topic"],
    ),
  },
  {
    name: "words_on_photo",
    description: "Put her exact words on one of her photos. Free.",
    parameters: object(
      { photoMediaId: str("The photo id."), text: str("The words, exactly."), style: oneOf(TEXT_STYLE_IDS, "The text look. Optional.") },
      ["photoMediaId", "text"],
    ),
  },
  {
    name: "remember",
    description: "Write down one lasting fact about her or her business, or a correction she made. One short line.",
    parameters: object({ fact: str("The fact, in one line.") }, ["fact"]),
  },
  {
    name: "set_budget",
    description: "Record the credits she said this chat may spend without asking. Only when her message states the number.",
    parameters: object({ credits: int("The number she stated.") }, ["credits"]),
  },
];

/** Tools that change what the chat spends or may spend. Run one at a time, in order, after the others. */
export const STATEFUL = new Set(["make_photos", "make_reel", "make_carousel", "words_on_photo", "set_budget"]);

/* ---- Reading arguments ---------------------------------------------------- */

const text = (value: unknown, max = 1000): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const whole = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n !== 0 ? Math.min(max, Math.max(min, n)) : fallback;
};
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : []);
const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined => (allowed.includes(value as T) ? (value as T) : undefined);

/** How a pasted screenshot is recreated when she does not say. Chosen by comparing the two on her own photos. */
export const DEFAULT_LOOK_MODE: "match" | "swap" = "match";

/** A refusal the model reads and passes on in its own words. */
class ToolRefusal extends Error {}

/** True when her message states this number: a budget is hers to set, never the model's. */
export function statesNumber(message: string, n: number): boolean {
  return (message.match(/\d[\d,]*/g) ?? []).some((found) => Number(found.replace(/,/g, "")) === n);
}

/* ---- Paid work ------------------------------------------------------------ */

/** One-line offer label: what the button makes. */
export function offerLabel(request: AgentRequest): string {
  const about = request.brief.replace(/\s+/g, " ").trim().slice(0, 80);
  switch (request.kind) {
    case "photos":
      return request.count === 1 ? `A photo: ${about}` : `${request.count} photos: ${about}`;
    case "reel":
      return `${request.talking ? "A talking reel" : "A reel"}: ${about}`;
    case "carousel":
      return `A carousel: ${about}`;
    case "text_photo":
      return "Your words on your photo";
  }
}

/** The job an agent run is started as. The request id is set by the caller: per call, or per offer. */
export function runRequest(ctx: ToolContext, request: AgentRequest, requestId: string): StartJobRequest {
  return {
    kind: "agent",
    avatarId: ctx.avatarId,
    requestId,
    input: { kind: "agent", message: ctx.message.slice(0, 1000) || request.brief, request, reply: offerLabel(request) },
  };
}

/** A job call's request id: the thread, the turn and the call, so a retried turn finds the same job. */
export const callRequestId = (threadId: string, turn: number, n: number) => `${threadId}:${turn}:${n}`;
/** An offer's request id: a second tap on the same button finds the same job. */
export const offerRequestId = (threadId: string, offerId: string) => `${threadId}:offer:${offerId}`;

/** The job message and event for a started run. */
export function jobRecord(jobId: string, request: AgentRequest, credits: number, at: string): { message: Extract<ThreadMessage, { role: "job" }>; event: TurnEvent } {
  const kind = jobCardKind(request.kind);
  return { message: { role: "job", jobId, kind, credits, at }, event: { type: "job", jobId, kind, credits } };
}

/**
 * Start the work when this chat's budget covers it, else offer it. Free work
 * (a carousel, words on her photo, a reel on her own clip) always starts.
 * Either way the price check runs first, so a start never fails for credits
 * halfway through a run.
 */
/** A look, model or layout the model named from her words stays, whatever the pickers say. */
function named(request: AgentRequest): Partial<Record<"style" | "model" | "layout", unknown>> {
  const given = request as Record<string, unknown>;
  return {
    ...(given.style ? { style: given.style } : {}),
    ...(given.model ? { model: given.model } : {}),
    ...(given.layout ? { layout: given.layout } : {}),
  };
}

async function startOrOffer(ctx: ToolContext, deps: ToolDeps, asked: AgentRequest, n: number): Promise<ToolOutcome> {
  /* The pickers in her box shape what is made, as they did in the first
     chat: the text look, the image model and shape, the video model, the
     slides format and layout. What she said in words wins over them. */
  const request: AgentRequest = ctx.options ? ({ ...withOptions(asked, ctx.options), ...named(asked) } as AgentRequest) : asked;
  const credits = agentCredits(request);
  const at = deps.now().toISOString();
  if (credits === 0 || ctx.budgetLeft >= credits) {
    await deps.affordable(credits, agentNoun(request));
    const started = await deps.startJob(runRequest(ctx, request, callRequestId(ctx.threadId, ctx.turn, n)));
    const { message, event } = jobRecord(started.jobId, request, credits, at);
    return outcome(
      { started: true, jobId: started.jobId, credits, note: credits ? `Started. ${credits} credits from this chat's budget.` : "Started. Free." },
      { events: [event], messages: [message], spent: started.created ? credits : 0, reply: startedReply(request.kind, credits) },
    );
  }
  const offer: Offer = { id: deps.newId(), label: offerLabel(request), credits, request: runRequest(ctx, request, ""), status: "open" };
  offer.request = { ...offer.request, requestId: offerRequestId(ctx.threadId, offer.id) };
  const { request: _stored, ...shown } = offer;
  void _stored;
  return outcome(
    { offered: true, offerId: offer.id, credits, label: offer.label, note: "Not started. Tell her what it makes and the price; she taps the button to start it." },
    { events: [{ type: "offer", offer: shown }], messages: [{ role: "offer", offer, at }], offers: [offer], reply: offeredReply(offer.label, credits) },
  );
}

const creditsOf = (credits: number) => `${credits} credit${credits === 1 ? "" : "s"}`;

/** What she is told when work has started: where it will be, how long, what it cost. */
export function startedReply(kind: AgentRequest["kind"], credits: number): string {
  const where: Record<AgentRequest["kind"], string> = {
    photos: "I've started your photo. It lands in your Library in about a minute.",
    reel: "I've started your reel. It takes a few minutes and lands in your Library.",
    carousel: "I've started your carousel. It takes about a minute and lands on the Carousels page.",
    text_photo: "I'm putting your words on the photo. It takes a few seconds.",
  };
  return `${where[kind]} ${credits ? `It uses ${creditsOf(credits)} from this chat's budget.` : "It's free."}`;
}

/** What she is told when a paid job waits for her tap. */
export function offeredReply(label: string, credits: number): string {
  return `${label}: ${creditsOf(credits)}. Tap the button to start it.`;
}

/* ---- Handlers ------------------------------------------------------------- */

type Handler = (args: Record<string, unknown>, ctx: ToolContext, deps: ToolDeps, n: number) => Promise<ToolOutcome>;

const HANDLERS: Record<string, Handler> = {
  async read_brand(_args, _ctx, deps) {
    return outcome(await deps.brand());
  },

  async search_library(args, _ctx, deps) {
    const kind = pick(args.kind, ["photo", "clip", "reel", "set"] as const) ?? "photo";
    const items = await deps.library(kind, { favorites: args.favorites === true, query: text(args.query, 200) });
    return outcome({ items });
  },

  async recent_posts(args, _ctx, deps) {
    return outcome({ posts: await deps.recentPosts(whole(args.n, 1, 10, 5)) });
  },

  async write_post(args, _ctx, deps) {
    const brief = [text(args.brief), text(args.goal, 200) ? `Goal: ${text(args.goal, 200)}` : ""].filter(Boolean).join("\n");
    if (!brief) throw new ToolRefusal("Say what the post is about.");
    const [knowledge, memory] = await Promise.all([deps.reference(brief), deps.memory()]);
    const hook = text(args.hook, 400) || undefined;
    const post = await deps.writePost({ brief, hook, talking: args.format === "talking", knowledge, memory });
    return outcome({ saved: true, ...post });
  },

  async write_hooks(args, ctx, deps) {
    const count = whole(args.count, 1, 10, 5);
    const topic = text(args.topic, 600);
    const query = [topic || ctx.profile.niche, ctx.profile.audience, "hooks"].filter(Boolean).join(". ");
    const [knowledge, memory] = await Promise.all([deps.reference(query), deps.memory()]);
    const written = await deps.writeHooks({ count, topic, knowledge, memory });
    return outcome({ savedToHooksPage: written.hooks, alreadyHad: written.dropped });
  },

  async make_photos(args, ctx, deps, n) {
    /* A recreate is worded by her: the model's own rewrite of the screenshot invented a sofa and a sweater the
       picture never had, and the image model followed that over the picture. Her words alone worked. */
    const idea = args.recreate === true && ctx.message.trim() ? text(ctx.message, 600) : text(args.idea, 600);
    if (!idea) throw new ToolRefusal("Say what the photo shows.");
    // A picture to recreate makes one photo: the screenshot is that photo's brief.
    const recreate = args.recreate === true;
    const shots = (ctx.screenshots ?? []).slice(0, MAX_LOOKS);
    if (recreate && !shots.length) throw new ToolRefusal("There is no screenshot in this message. Ask her to paste it again.");
    const count = recreate ? 1 : whole(args.count, 1, MAX_PHOTOS, 1);
    const mode = pick<PhotoMode>(args.mode, ["one", "set", "related", "various"]) ?? (count === 1 ? "one" : "various");
    const sources = ids(args.sourceMediaIds);
    const material = sources.length ? await deps.ownMaterial({ photos: sources }) : undefined;
    const lookMode = recreate ? (pick(args.recreateHow, ["match", "swap"] as const) ?? DEFAULT_LOOK_MODE) : undefined;
    /* A swap only holds the picture together on Pro (Nano Banana 2 zoomed in and changed the set), so Pro unless she named a model. */
    const model = pick<ImageModel>(args.model, Object.keys(IMAGE_MODELS) as ImageModel[]) ?? (lookMode === "swap" ? "pro" : undefined);
    // The quote rides with the photo: the run draws it on a copy once the photo exists, which a second tool call could not do.
    const words = count === 1 ? text(args.words, 400) : "";
    const style = pick<TextStyle>(args.style, TEXT_STYLE_IDS);
    const lookMediaIds = recreate ? await deps.saveLooks(shots, callRequestId(ctx.threadId, ctx.turn, n)) : [];
    const request: AgentRequest = {
      kind: "photos",
      brief: idea,
      scene: idea,
      count,
      mode: count === 1 ? "one" : mode,
      ...(model ? { model } : {}),
      ...(material ? { material } : {}),
      ...(lookMediaIds.length ? { lookMediaIds, lookMode: lookMode ?? DEFAULT_LOOK_MODE } : {}),
      ...(words ? { words, ...(style ? { style } : {}) } : {}),
    };
    return startOrOffer(ctx, deps, request, n);
  },

  async make_reel(args, ctx, deps, n) {
    const brief = text(args.brief, 600);
    if (!brief) throw new ToolRefusal("Say what the reel is about.");
    const clip = text(args.clipMediaId, 64);
    const photo = text(args.photoMediaId, 64);
    const material = clip || photo ? await deps.ownMaterial({ photos: photo ? [photo] : [], ...(clip ? { clip } : {}) }) : undefined;
    const hook = text(args.hook, 400);
    const scene = text(args.scene, 400);
    const style = pick<TextStyle>(args.style, TEXT_STYLE_IDS);
    const request: AgentRequest = {
      kind: "reel",
      brief,
      footage: "auto",
      cue: "auto",
      talking: args.talking === true,
      ...(hook ? { hook } : {}),
      ...(scene ? { scene } : {}),
      ...(style ? { style } : {}),
      ...(material ? { material } : {}),
    };
    return startOrOffer(ctx, deps, request, n);
  },

  async make_carousel(args, ctx, deps, n) {
    const topic = text(args.topic, 600);
    if (!topic) throw new ToolRefusal("Say what the carousel is about.");
    const photos = ids(args.photoMediaIds);
    const material = photos.length ? await deps.ownMaterial({ photos }) : undefined;
    const layout = pick<Layout>(args.layout, LAYOUTS);
    const slides = args.slides === undefined ? undefined : whole(args.slides, 3, 10, 7);
    const request: AgentRequest = { kind: "carousel", brief: topic, format: "carousel", ...(slides ? { slides } : {}), ...(layout ? { layout } : {}), ...(material ? { material } : {}) };
    return startOrOffer(ctx, deps, request, n);
  },

  async words_on_photo(args, ctx, deps, n) {
    const photo = text(args.photoMediaId, 64);
    const words = text(args.text, 400);
    if (!photo || !words) throw new ToolRefusal("Pick one of her photos and give the words.");
    const material = await deps.ownMaterial({ photos: [photo] });
    const style = pick<TextStyle>(args.style, TEXT_STYLE_IDS);
    const request: AgentRequest = { kind: "text_photo", brief: words, words, material, ...(style ? { style } : {}) };
    return startOrOffer(ctx, deps, request, n);
  },

  async remember(args, _ctx, deps) {
    const fact = text(args.fact, 300);
    if (!fact) throw new ToolRefusal("A fact needs some words.");
    const saved = await deps.addFact(fact);
    return outcome({ remembered: saved }, { events: [{ type: "fact", text: `Remembered: ${saved}` }] });
  },

  async set_budget(args, ctx) {
    const credits = whole(args.credits, 0, 500, 0);
    if (!statesNumber(ctx.message, credits)) throw new ToolRefusal("A budget is only set from a number she wrote in this message.");
    return outcome({ budget: credits, note: `This chat may spend ${credits} credits without asking.` }, { budget: credits });
  },
};

/**
 * Run one call. Never throws: a refusal or a failure becomes an answer the
 * model reads ({ error }), so one bad call does not end the turn. Errors not
 * written for a person are reported in general words and logged by `report`.
 */
export async function runTool(call: FunctionCall, ctx: ToolContext, deps: ToolDeps, n: number, report: (error: unknown) => void = () => {}): Promise<ToolOutcome & { label: string }> {
  const label = toolLabel(call.name);
  const handler = HANDLERS[call.name];
  if (!handler) return { label, ...outcome({ error: `There is no tool called ${call.name}.` }) };
  try {
    return { label, ...(await handler(call.args ?? {}, ctx, deps, n)) };
  } catch (error) {
    if (error instanceof ToolRefusal || isUserFacing(error)) return { label, ...outcome({ error: (error as Error).message }) };
    report(error);
    return { label, ...outcome({ error: "That did not work this time. Say so to her and suggest trying again." }) };
  }
}

import { creditsFor } from "@/billing/pricing";
import type { ClipModel } from "@/content/clip-options";
import type { StartClaim } from "@/jobs/claim";
import type { Layout } from "@/carousel/spec";
import type { PostIdea } from "@/content/hooks";
import { DEFAULT_IMAGE_MODEL, type ImageAspect, type ImageModel } from "@/content/image-options";
import { maxTalkingSecondsFor } from "@/content/motion";
import type { TextSize, TextStyle } from "@/content/text-styles";
import { MAX_SECONDS } from "@/reel/timing";
import type { ShotType } from "@/style/house-style";

/* The agent's plan, as plain data.
 *
 * An agent run is one `jobs` row of kind "agent". It costs no credits itself:
 * every paid thing it does is a child job (a photo, a clip, a reel, a set)
 * started through `startJob` with its own price, its own reservation and its
 * own refund, so a run that dies halfway leaves the finished children paid
 * for and the unfinished ones refunded, exactly as if she had pressed the
 * buttons herself. The run's own state lives in `jobs.input.state` and is
 * written after every step, so a poll can pick it up where the last one left
 * it. Nothing in this file touches a network or a database. */

export type PhotoMode = "one" | "set" | "related" | "various";

/**
 * Library items she attached with + to use as they are, owner-checked when
 * the run was asked for. A reel uses the clip (free, no photo or clip made)
 * or else the first photo (animated, no photo made); a set uses the photos in
 * this order and no others; new photos use the first few as references.
 */
export type Material = { photos: string[]; clip?: string };

/** The most photos one message may carry as material. */
export const MAX_MATERIAL_PHOTOS = 10;
/** The most attached photos a new photo is drawn from, beside her own references. */
export const MAX_SOURCE_PHOTOS = 3;
/** Pictures to recreate in one photo: one is the brief, a second would be an argument. */
export const MAX_LOOKS = 1;

export type AgentRequest =
  | {
      kind: "reel";
      /** What the reel is about, in the creator's words, ready for the writer. */
      brief: string;
      /** A scene she asked for under the hook, if she named one. */
      scene?: string;
      /** "new" when she asked for fresh footage; otherwise a fitting library clip is reused. */
      footage: "auto" | "new";
      /** Whether she asked for, or refused, a second on-screen line. */
      cue: "auto" | "yes" | "no";
      /** She talks to camera with sound rather than b-roll under a hook. */
      talking: boolean;
      /** One of the five text looks. Absent means the boxed look. */
      style?: TextStyle;
      /** "small": the words smaller, in a narrow column, broken at the pauses. Absent means large. */
      size?: TextSize;
      /** Every on-screen word lowercased. Absent keeps her case. */
      lowercase?: boolean;
      /** A hook she wrote herself, used word for word; the writer works around it. */
      hook?: string;
      /** A post's hook she pointed at, rewritten for her line by line: same lines, her details. */
      template?: string;
      /** A post she admires, read off a screenshot or pasted: followed for its shape, never its words. */
      reference?: string;
      /** The image model for the photo under the hook. Absent means Nano Banana 2. */
      model?: ImageModel;
      /** The video model she picked. Absent means Omni. */
      clipModel?: ClipModel;
      /** The comment keyword she named ("Comment CASH"), asked for in place of her brand's. */
      keyword?: string;
      material?: Material;
    }
  | {
      kind: "photos";
      brief: string;
      /** 1 to MAX_PHOTOS. */
      count: number;
      /** one photo; a set (one shoot, different poses); related scenes (a sequence); various (unrelated scenes). */
      mode: PhotoMode;
      scene?: string;
      /** The photo shape. Absent means 4:5, the feed's portrait. */
      aspect?: ImageAspect;
      /** The image model. Absent means Nano Banana 2. */
      model?: ImageModel;
      /** Her attached photos: the new photos are drawn from the first few, as well as from her references. */
      material?: Material;
      /** A screenshot's camera angle, distance, crop and pose, carried into every scene. Never the person in it. */
      framing?: string;
      /** Screenshots she pasted to recreate, saved to her library for this run: the picture is copied, never the person in it. One photo only. */
      lookMediaIds?: string[];
      /** "swap" edits the screenshot itself with her in it; absent means "match", a new photo that follows its shot. */
      lookMode?: "match" | "swap";
      /** Words drawn on a copy of the new photo, exactly, once it is made (one photo only). Free. */
      words?: string;
      /** A quote she pointed at: a line of about its length and shape is written in her voice and drawn instead. */
      wordsLike?: string;
      /** A quote post with no quote given: what the line should be about. It is written in her voice and drawn on a copy. */
      wordsBrief?: string;
      /** The look of the words, when there are words. Absent means the boxed look. */
      style?: TextStyle;
      size?: TextSize;
      lowercase?: boolean;
    }
  | {
      kind: "carousel";
      brief: string;
      format: "carousel" | "story";
      /** A style kit id from src/carousel/kits.ts, one of the five text-style ids. Absent means the house look, "signal". */
      kit?: string;
      /** "small": the words smaller, in a narrow column, broken at the pauses. Absent means large. */
      size?: TextSize;
      /** Every on-screen word lowercased. Absent keeps her case. */
      lowercase?: boolean;
      /** The cover's words, hers, used exactly. */
      cover?: string;
      /** A post's cover she pointed at, rewritten for her line by line before the set is drawn. */
      coverTemplate?: string;
      /** A set she admires, read off screenshots: followed for its shape and slide count, never its words. */
      reference?: string;
      /** How many slides, when the reference or her words say. */
      slides?: number;
      /** "photos": every slide on a photo, no plain paper slides. "split" and
          "grid": the half-and-half and four-photo-cover sets. Absent means mixed. */
      layout?: Layout;
      /** Her attached photos: the set uses exactly these, in order, and paper for any slide past them. */
      material?: Material;
      /** Her own slides, in order, labels stripped (src/agent/given-words.ts): drawn word for word, with no keyword slide added after them. */
      slideTexts?: string[];
      /** The comment keyword she named ("Comment CASH"), asked for in place of her brand's. */
      keyword?: string;
    }
  | {
      /** Her words drawn on her own attached photo. Free: no image model is called and no new photo is made. */
      kind: "text_photo";
      /** What she asked, for the log and a follow-up. */
      brief: string;
      /** The words, exactly as given: quoted, typed after the ask, or read off her screenshot. Empty when `wordsBrief` asks for them to be written. */
      words: string;
      /** What she asked the words to be when she gave none ("a relatable, slightly unhinged life quote"): the run writes them first. */
      wordsBrief?: string;
      /** One of the five text looks. Absent means the boxed look. */
      style?: TextStyle;
      /** "small": the words smaller, in a narrow column, broken at the pauses. Absent means large. */
      size?: TextSize;
      /** Every on-screen word lowercased. Absent keeps her case. */
      lowercase?: boolean;
      /** A shape she picked, cut from the photo's centre. Absent means the photo's own shape. */
      aspect?: ImageAspect;
      /** The photo is the first attached one; a run without one is never started. */
      material?: Material;
    };

export const MAX_PHOTOS = 6;

/** The longest message the chat takes. */
export const MAX_MESSAGE_CHARS = 1000;
/** How many screenshots one message may carry. */
export const MAX_ATTACHMENTS = 3;

/** A short second line that pops in once the hook has been read. */
export type Cue = { text: string; why: string };

/** The director's production choices for one reel. */
export type Direction = {
  cue: Cue | null;
  /** Why no cue, when there is none. */
  noCueWhy: string | null;
  /** A library clip that already shows the scene, or null to make a new one. */
  clip: { mediaId: string; why: string } | null;
};

export type SceneIdea = { idea: string; shot: ShotType; why: string };

export const STEP_NAMES = ["write", "direct", "photo", "clip", "reel", "plan", "photos", "render", "words"] as const;
export type StepName = (typeof STEP_NAMES)[number];
export type StepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type Step = { name: StepName; status: StepStatus; note?: string; startedAt?: string; finishedAt?: string };

export const STEPS_FOR: Record<AgentRequest["kind"], readonly StepName[]> = {
  reel: ["write", "direct", "photo", "clip", "reel"],
  photos: ["plan", "photos"],
  carousel: ["plan", "render"],
  text_photo: ["words"],
};

/** The steps of this request: a photo with words on it gets the words step after the photo. */
export function stepsFor(request: AgentRequest): readonly StepName[] {
  if (request.kind === "photos" && drawsWords(request)) return [...STEPS_FOR.photos, "words"];
  return STEPS_FOR[request.kind];
}

/** A photos request that ends with words on a copy of its photo: given, shaped like a screenshot's, or to be written. */
export function drawsWords(request: Extract<AgentRequest, { kind: "photos" }>): boolean {
  return Boolean(request.words?.trim() || request.wordsLike?.trim() || request.wordsBrief?.trim());
}

export const STEP_LABEL: Record<StepName, string> = {
  write: "Write the hook and caption",
  direct: "Pick the clip and the second line",
  photo: "Make the photo",
  clip: "Animate the clip",
  reel: "Build the reel",
  plan: "Plan the scenes",
  photos: "Make the photos",
  render: "Write and draw the slides",
  words: "Put the words on the photo",
};

export type AgentState = {
  steps: Step[];
  post?: PostIdea;
  direction?: Direction;
  /** The reel's draft, once the post is written; the set's draft for a carousel. */
  draftId?: string;
  scenes?: SceneIdea[];
  /** The library folder a set of photos is filed in. */
  folderId?: string | null;
  /** Child job ids by step, so a poll can find what it is waiting on. */
  children: Partial<Record<StepName, string[]>>;
  photoMediaId?: string;
  clipMediaId?: string;
  /** The photos a set's covers are built from. */
  photoIds?: string[];
  /** A set's cover adapted from the one she pointed at, used exactly once written. */
  cover?: string;
  /** The words drawn on a photo run's photo, once written in her voice, so a retry does not write them again. */
  words?: string;
  /** Everything the run produced, for the chat to show. */
  mediaIds: string[];
  /** Credits the children took from the balance. */
  creditsSpent: number;
  /** Which child the run is waiting on right now, or null between steps. */
  waitingOn: string | null;
  /**
   * A step in flight, and until when. A poll that lands while the background
   * run is still writing the hook must not write it again: the machine's
   * claim keeps two polls apart, but not a poll and a step already running.
   */
  lease?: { step: StepName; until: string };
  summary?: string;
};

export type AgentJobInput = {
  kind: "agent";
  /** What she typed. */
  message: string;
  request: AgentRequest;
  /** The agent's one-line acknowledgment, shown as soon as the run starts. */
  reply: string;
  state?: AgentState;
  /** The failed run this one continues, with its finished steps carried over. */
  resumedFrom?: string;
  /** On a failed run: the request that is continuing it (src/jobs/claim.ts), so it is continued once. Never copied into the continuation. */
  retry?: StartClaim;
  /** How many screenshots came with the message. They were read once and not kept. */
  attachments?: number;
  /** False: every writer in this run works without her brand (src/content/brand-scope.ts). Absent means on. */
  brand?: boolean;
};

export function initialState(request: AgentRequest, carried?: Partial<AgentState>): AgentState {
  const steps = stepsFor(request).map((name): Step => ({ name, status: "pending" }));
  const fresh = withMaterial(request, { steps, children: {}, mediaIds: [], creditsSpent: 0, waitingOn: null });
  return {
    ...fresh,
    ...carried,
    /* Carried steps keep their notes and their done marks; a failed one is
       taken again, and anything after it is still to do. */
    ...(carried?.steps
      ? { steps: carried.steps.map((step) => (step.status === "failed" || step.status === "running" ? { ...step, status: "pending" as const, note: undefined } : step)) }
      : {}),
  };
}

/** A reel's footage she attached: the clip or the first photo, if any. */
export function reelMaterial(request: AgentRequest): { clip?: string; photo?: string } {
  if (request.kind !== "reel" || !request.material) return {};
  if (request.material.clip) return { clip: request.material.clip };
  const photo = request.material.photos[0];
  return photo ? { photo } : {};
}

/** A reel with footage attached starts with the steps that footage replaces already skipped. */
function withMaterial(request: AgentRequest, state: AgentState): AgentState {
  const { clip, photo } = reelMaterial(request);
  if (clip) {
    const next = markStep({ ...state, clipMediaId: clip }, "photo", "skipped", "Using the clip you attached.");
    return markStep(next, "clip", "skipped", "Using the clip you attached.");
  }
  if (photo) return markStep({ ...state, photoMediaId: photo }, "photo", "skipped", "Using the photo you attached.");
  return state;
}

export const isFinished = (state: AgentState): boolean => state.steps.every((step) => step.status === "done" || step.status === "skipped");

/** The step a poll should work on: the first that is not finished. Every
    agent step can be entered again while it waits on a child job. */
export function nextStep(state: AgentState): Step | null {
  return state.steps.find((step) => step.status !== "done" && step.status !== "skipped") ?? null;
}

export function stepOf(state: AgentState, name: StepName): Step {
  const step = state.steps.find((item) => item.name === name);
  if (!step) throw new Error(`This run has no step ${name}`);
  return step;
}

export function markStep(state: AgentState, name: StepName, status: StepStatus, note?: string, now = new Date().toISOString()): AgentState {
  return {
    ...state,
    steps: state.steps.map((step) =>
      step.name === name
        ? {
            ...step,
            status,
            note: note ?? step.note,
            startedAt: step.startedAt ?? now,
            finishedAt: status === "done" || status === "skipped" || status === "failed" ? now : undefined,
          }
        : step,
    ),
  };
}

/** A library clip already shows the scene: the paid photo and clip are skipped. */
export function applyDirection(state: AgentState, direction: Direction): AgentState {
  let next: AgentState = { ...state, direction, clipMediaId: direction.clip?.mediaId ?? state.clipMediaId };
  if (direction.clip) {
    next = markStep(next, "photo", "skipped", "Using a clip from your library.");
    next = markStep(next, "clip", "skipped", "Using a clip from your library.");
  }
  return next;
}

/** How many of a photo run's children have been started. */
function photosStarted(state: AgentState): number {
  return state.children.photos?.length ?? 0;
}

/** True when a photo run's `photos` step stopped part-way through starting its
    children: some scenes have a paid child and the rest have none. */
function photosPartlyStarted(state: AgentState): boolean {
  const scenes = state.scenes?.length ?? 0;
  const started = photosStarted(state);
  return started > 0 && started < scenes;
}

/** What a retry keeps from a failed run: every finished step and what it made.
    The failed step's child is dropped, so it is started again as a new child
    rather than found again as the one that failed — except the photos a
    `photos` step had already started when a later start threw: those are paid
    for, so the retry keeps them and starts only the scenes without one. A
    `photos` step that started every child and then failed keeps none, or the
    retry would find the same failed photos again and make nothing new. */
export function carryOver(state: AgentState): Partial<AgentState> {
  const finished = new Set(state.steps.filter((step) => step.status === "done" || step.status === "skipped").map((step) => step.name));
  const children: AgentState["children"] = {};
  for (const [name, ids] of Object.entries(state.children)) {
    if (!ids) continue;
    if (finished.has(name as StepName) || (name === "photos" && photosPartlyStarted(state))) children[name as StepName] = ids;
  }
  return {
    steps: state.steps,
    post: state.post,
    direction: state.direction,
    draftId: state.draftId,
    scenes: state.scenes,
    folderId: state.folderId,
    photoIds: state.photoIds,
    cover: state.cover,
    words: state.words,
    children,
    // A skipped photo or clip step is attached footage (or a library clip): it is carried too.
    // A photo run's photo is what its words go on.
    photoMediaId: finished.has("photo") || finished.has("photos") ? state.photoMediaId : undefined,
    clipMediaId: finished.has("clip") || finished.has("direct") ? state.clipMediaId : undefined,
    mediaIds: state.mediaIds,
    creditsSpent: state.creditsSpent,
    waitingOn: null,
  };
}

/** What a run may charge, before it starts: the price of every child it could
    start, so an account that cannot afford the last step never pays for the
    first. A clip is priced at the longest reel we make; the real length follows
    the hook and is usually shorter. */
export function agentCredits(request: AgentRequest): number {
  const photo = creditsFor({ kind: "image", model: photoModelOf(request) });
  switch (request.kind) {
    case "reel": {
      const parts = reelParts(request);
      return parts.photo + parts.clip;
    }
    case "photos":
      // Words on the photo are canvas work and free: a photo with words costs the photo.
      return photo * Math.min(MAX_PHOTOS, Math.max(1, request.count));
    case "carousel":
    case "text_photo":
      return 0;
  }
}

/** A reel's two paid parts. Attached footage takes its part off: a clip makes the reel free, a photo leaves only the clip. */
export function reelParts(request: Extract<AgentRequest, { kind: "reel" }>): { photo: number; clip: number } {
  const { clip, photo } = reelMaterial(request);
  if (clip) return { photo: 0, clip: 0 };
  const clipCredits = request.talking
    ? creditsFor({ kind: "clip", model: reelClipModel(request), seconds: maxTalkingSecondsFor(reelClipModel(request)) })
    : creditsFor({ kind: "clip", model: reelClipModel(request), seconds: MAX_SECONDS });
  return { photo: photo ? 0 : creditsFor({ kind: "image", model: photoModelOf(request) }), clip: clipCredits };
}

/** The image model a run's photos are made with. */
export function photoModelOf(request: AgentRequest): ImageModel {
  return request.kind === "reel" || request.kind === "photos" ? request.model ?? DEFAULT_IMAGE_MODEL : DEFAULT_IMAGE_MODEL;
}

/** The video model a reel's clip is made with: Gemini Omni, the one video model, for talking and b-roll alike. */
export function reelClipModel(request: Extract<AgentRequest, { kind: "reel" }>): ClipModel {
  return request.clipModel ?? "omni";
}

/** What a retry of this run could still charge: the paid steps not yet done. */
export function remainingCredits(request: AgentRequest, state: AgentState): number {
  const photo = creditsFor({ kind: "image", model: photoModelOf(request) });
  const todo = (name: StepName) => state.steps.some((step) => step.name === name && step.status !== "done" && step.status !== "skipped");
  if (request.kind === "reel") {
    const parts = reelParts(request);
    return (todo("photo") ? parts.photo : 0) + (todo("clip") ? parts.clip : 0);
  }
  // Only the scenes still without a child: the ones carried over are paid for.
  if (request.kind === "photos") return todo("photos") ? Math.max(0, agentCredits(request) - photo * photosStarted(state)) : 0;
  return 0;
}

/** The noun a gate message uses for this run. */
export function agentNoun(request: AgentRequest): string {
  if (request.kind === "reel") return request.talking ? "talking reel" : "reel";
  if (request.kind === "photos") return drawsWords(request) ? "photo with words" : request.count === 1 ? "photo" : "set of photos";
  if (request.kind === "text_photo") return "photo with words";
  return request.format === "story" ? "story sequence" : "carousel";
}

/** A child job's request id: the run's id plus the step, so a retried poll finds the same child. */
export function childRequestId(runId: string, step: StepName, index = 0): string {
  return `${runId}:${step}:${index}`;
}

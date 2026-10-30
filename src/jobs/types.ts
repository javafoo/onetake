import type { AgentJobInput } from "@/agent/plan";
import type { WeekJobInput } from "@/week/plan";
import type { Action } from "@/billing/pricing";
import type { Layout } from "@/carousel/spec";
import { DEFAULT_CLIP_MODEL, type ClipAspectRatio, type ClipModel } from "@/content/clip-options";
import { DEFAULT_IMAGE_MODEL, normalizeImageAspect, type ImageAspect, type ImageModel } from "@/content/image-options";
import type { TextSize, TextStyle } from "@/content/text-styles";
import type { ShotType } from "@/style/house-style";

/* What a job is, in one place. `src/db/schema.ts` owns the columns; this owns
   the shape of the two jsonb blobs (`input`, `output`) and the view the API
   returns, because neither is typed by the schema. */

export type JobKind = "image" | "clip" | "reel" | "carousel" | "agent" | "text_photo" | "week";
export type JobStatus = "queued" | "running" | "completed" | "failed";

/** The one free photo an account gets. The only value the marker may hold. */
export const ONBOARDING_FREEBIE = "onboarding_photo";

/** A new photo of the avatar in the house style. */
export interface ImageJobInput {
  kind: "image";
  idea: string;
  shot: ShotType;
  /** The shape the photo comes out. Absent means 4:5, the feed's portrait. */
  aspect?: ImageAspect;
  /**
   * What jobs recorded before `aspect` existed carry: 3:4 from the Library
   * page, 9:16 from a reel. Never written any more; `imageAspectOf` reads it.
   */
  aspectRatio?: "3:4" | "4:5" | "9:16";
  /** Which image model. Absent means Nano Banana 2; "pro" is picked on purpose and priced as such. */
  model?: ImageModel;
  /**
   * Photos of hers from the library the new one is drawn from ("same outfit
   * at a café", "extend to 16:9"), with `idea` as the instruction. Sent after
   * her identity references, so her face still comes from those. Re-checked
   * against her own kept photos inside the job; at most three are used.
   */
  sourceMediaIds?: string[];
  /**
   * Pictures to recreate, saved from the screenshots she pasted: their shot,
   * pose and light are copied, the person in them never is. Re-checked as hers
   * inside the job.
   */
  lookMediaIds?: string[];
  /** "swap" edits the picture itself with her in it; absent means "match", a new photo that follows its shot. */
  lookMode?: "match" | "swap";
  /**
   * Paid takes this job may use. A rejected take is normally reworded and
   * redone, which is a second paid image, so the default is `MAX_TAKES` and
   * that is what gets reserved against the budget. Set 1 for a run that must
   * not spend twice.
   */
  maxTakes?: number;
  /**
   * Set when this photo is the account's one free one.
   *
   * It is a marker, not a permission. `startJob` prices the job at zero and
   * skips the entitlement check when it sees it, and the caller must already
   * have claimed the freebie off the `users` row (`src/data/freebie.ts`). A
   * server action is a public endpoint, so this marker arriving on its own
   * buys nothing: the claim is the thing that is spent, and there is exactly
   * one of it per account.
   */
  freebie?: typeof ONBOARDING_FREEBIE;
  /**
   * When the freebie this job spends was claimed, as an ISO string.
   *
   * It is the claim's identity, so the poll that finds this job failed can
   * hand exactly that claim back and nothing else. Written by the server when
   * the input is built — never read off a form — so it cannot be supplied by
   * whoever pressed the button.
   */
  freebieClaimedAt?: string;
  /**
   * The library folder the photo lands in: the one that was open when the
   * button was pressed. Checked to be the user's own before it gets here.
   * Absent or null is "not in a folder".
   */
  folderId?: string | null;
}

/** One image animated into a short clip by Higgsfield. */
export interface ClipJobInput {
  kind: "clip";
  imageMediaId: string;
  /** The final motion line. `clipPrompt` appends MOTION_RULES to it. */
  motion: string;
  /**
   * What the creator tapped or typed, before the polish step rewrote it.
   *
   * Kept beside the prompt it produced so a clip that came out wrong can be
   * traced back to the idea, not only to the sentence we wrote from it. Absent
   * on every job recorded before the prompt builder existed, and on a motion
   * the creator wrote that needed no changing.
   */
  idea?: string;
  seconds: number;
  /**
   * The folder the clip lands in. Absent means "the same folder as the photo
   * it was made from", which is what someone filing a shoot expects; null
   * means "not in a folder" on purpose.
   */
  folderId?: string | null;
  /**
   * Which video model to use. Optional, and the two defaults below are what
   * make it so: every clip job recorded before these fields existed is still a
   * Kling clip at the photo's own shape, which is exactly what it was, and it
   * keeps being priced at three credits when a poll reads it back.
   */
  model?: ClipModel;
  /** The shape the clip comes out. Applied to the photo, not to the request. */
  aspectRatio?: ClipAspectRatio;
  /**
   * A talking clip: `motion` is the line she says, the model generates the
   * sound, and the b-roll motion rules do not apply. Seedance is the model
   * for it; the caller chooses it.
   */
  speech?: boolean;
  /**
   * The language she speaks in a talking clip, as a code from
   * src/content/languages.ts. Absent is English, as every older job was; the
   * talking prompt names any other so the model speaks it.
   */
  language?: string;
  /**
   * The whole prompt, written by a storyboard (a talking segment with its
   * delivery and framing, or a multi-shot story scene), sent as it is. When
   * absent the prompt is built from `motion` as before.
   */
  prompt?: string;
}

/** The model a clip job runs on, with the default an older job implies. */
export function clipModelOf(input: ClipJobInput): ClipModel {
  return input.model ?? DEFAULT_CLIP_MODEL;
}

/** The model an image job runs on, with the default an older job implies. */
export function imageModelOf(input: ImageJobInput): ImageModel {
  return input.model ?? DEFAULT_IMAGE_MODEL;
}

/** The shape an image job comes out, reading an older job's 3:4 as the feed portrait. */
export function imageAspectOf(input: ImageJobInput): ImageAspect {
  return normalizeImageAspect(input.aspect ?? input.aspectRatio);
}

/** A hook rendered over a clip with ffmpeg. */
export interface ReelJobInput {
  kind: "reel";
  draftId: string;
  clipMediaId: string;
  /** A short second line that pops in once the hook has been read. */
  cue?: string;
  /** "talking" keeps the clip's own length and sound; the default loops a silent clip under the hook. */
  mode?: "loop" | "talking";
  /** One of the five text looks (src/content/text-styles.ts). The default is the boxed look; a legacy "box" or "elegant" is mapped when the reel is assembled. */
  style?: TextStyle;
  /** "small" sets the words smaller in a narrow column, broken at the pauses. Absent means large, as every older row was. */
  size?: TextSize;
  /** Every on-screen word lowercased at render time. Absent keeps her case. */
  lowercase?: boolean;
}

/**
 * A carousel or story sequence: one model call writes the spec, code checks it,
 * and the renderer draws the PNGs. The draft row is created before the job, so
 * `draftId` is where the finished set lands and also the page the creator is
 * already looking at while this runs.
 *
 * Everything here is what she chose in the form. The photos are media ids,
 * re-checked against her own rows inside the job.
 */
export interface CarouselJobInput {
  kind: "carousel";
  draftId: string;
  format: "carousel" | "story";
  topic: string;
  /** A key of SKELETONS in src/carousel/write.ts. */
  skeleton: string;
  /** A style kit id. Whether this account may use it is decided in the job. */
  kit: string;
  /** Palette keys the creator retuned, as #rrggbb. */
  palette?: Record<string, string>;
  /** Photos for the photo slides, in the order they should be used. */
  photoMediaIds: string[];
  /**
   * Each photo once: the photos she attached, and no more. A cover past the
   * last one becomes a paper slide instead of repeating a photo. Mixed sets
   * only; an all-photo set has no paper to fall back on.
   */
  photosOnce?: boolean;
  /** How many slides to write. The format's own limits win. */
  slides?: number;
  /** "photos": every slide on a photo, no paper slides. Absent means mixed. */
  layout?: Layout;
  /** The cover's words, the creator's own, used exactly: the writer works around them and the checks leave them alone. */
  coverTitle?: string;
  /** A set she admires, slide by slide, for its shape. */
  reference?: string;
  /** False: written without her brand (no niche, offer, story, proof or keyword; the last slide asks to save, share or follow). Absent means on. */
  brand?: boolean;
  /** Applies to the covers on photos; lowercase applies to every slide's words. */
  /** "small" sets the words smaller in a narrow column, broken at the pauses. Absent means large, as every older row was. */
  size?: TextSize;
  /** Every on-screen word lowercased at render time. Absent keeps her case. */
  lowercase?: boolean;
  /** Which of her offers the set sells (src/content/offers.ts), picked from her message. Absent: picked from the topic. */
  offer?: number;
  /** Her own slides, in order, used word for word (src/carousel/given.ts): nothing is written and no keyword slide is added. */
  slideTexts?: string[];
  /** The comment keyword she named for this set ("Comment CASH"), in place of her brand's. */
  keyword?: string;
}

/**
 * Her words drawn on one of her own photos, in one of the five text looks,
 * the way a carousel cover draws its title. Free: no image model, only the
 * canvas and, once per photo, the face finder. The result is a new photo in
 * the same folder as the one it was drawn on.
 */
export interface TextPhotoJobInput {
  kind: "text_photo";
  /** Her photo. Re-checked against her own kept photos inside the job. */
  photoMediaId: string;
  /** The words, exactly as she gave them, line breaks and case included. */
  text: string;
  style: TextStyle;
  /** "small" sets the words smaller in a narrow column, broken at the pauses. Absent means large, as every older row was. */
  size?: TextSize;
  /** Every on-screen word lowercased at render time. Absent keeps her case. */
  lowercase?: boolean;
  /** A shape she picked, cut from the photo's centre. Absent means the photo's own shape. */
  aspect?: ImageAspect;
  /** The language the words are in, for lowercasing by its rules. Absent is English. */
  language?: string;
}

/**
 * The agent: one chat message carried out as a run of child jobs. It is free
 * itself (writing and deciding are in the plan) and every paid thing it does
 * is a child job with its own price. The shape lives in `src/agent/plan.ts`.
 */
export type { AgentJobInput, WeekJobInput };

export type JobInput = ImageJobInput | ClipJobInput | ReelJobInput | CarouselJobInput | AgentJobInput | TextPhotoJobInput | WeekJobInput;

/**
 * What is actually stored in `jobs.input`.
 *
 * `providerStatusUrl` is the one thing added after the job starts: Higgsfield
 * hands back a status URL at submit time and there is no column for it, and
 * `src/db/schema.ts` is a contract other branches build on. It is written once,
 * beside the request it belongs to, and never read as user input.
 */
export type StoredJobInput = JobInput & { providerStatusUrl?: string };

export interface JobOutput {
  /** Media rows this job produced, newest work last. Usually one. */
  mediaIds: string[];
  /** One plain sentence for the person who started it. */
  message: string;
  meta?: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  userId: string;
  avatarId: string | null;
  kind: JobKind;
  status: JobStatus;
  requestId: string;
  provider: string | null;
  providerRequestId: string | null;
  input: StoredJobInput;
  output: JobOutput | null;
  error: string | null;
  /** What the action was priced at. The ledger is the record of what moved. */
  credits: number;
  createdAt: Date;
  updatedAt: Date;
}

/** What `/api/jobs/[id]` returns and `<JobStatus>` renders. Plain JSON. */
export interface JobView {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Plain English, already safe to show. Null unless the job failed. */
  error: string | null;
  /** Media rows to render. Empty until the job completes. */
  mediaIds: string[];
  /** What to say about the result. Null until the job completes. */
  message: string | null;
  /** The price of the action in credits. */
  credits: number;
  /** Credits actually taken from the balance: the reservation less any refund. */
  creditsCharged: number;
  /** Credits given back. Non-zero exactly when the job failed after reserving. */
  creditsRefunded: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * True for the one job an account may run without paying for it.
 *
 * Narrow on purpose: only an image job, and only carrying the one marker value
 * this module defines. Anything else — a clip with a `freebie` field bolted
 * on, a marker with a different string in it — is priced normally.
 */
export function isFreebie(input: JobInput): boolean {
  return input.kind === "image" && input.freebie === ONBOARDING_FREEBIE;
}

/**
 * The claim a failed freebie job should hand back, or null.
 *
 * Null for every job that is not a freebie, and for a freebie whose stored
 * timestamp is missing or unparseable — in which case the freebie stays spent,
 * which is the direction that cannot give away two photos.
 */
export function freebieClaim(input: JobInput): Date | null {
  if (!isFreebie(input) || input.kind !== "image" || !input.freebieClaimedAt) return null;
  const at = new Date(input.freebieClaimedAt);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** How each kind is priced. The numbers come from `src/billing/pricing.ts`. */
export function pricingAction(input: JobInput): Action {
  switch (input.kind) {
    case "image":
      return { kind: "image", model: imageModelOf(input) };
    case "clip":
      return { kind: "clip", model: clipModelOf(input), seconds: input.seconds };
    case "reel":
      return { kind: "reel" };
    case "carousel":
    // Drawn on our own canvas like a set's slides, and free like them.
    case "text_photo":
      return { kind: "carousel" };
    case "agent":
    // The week's own calls are words; the posts it makes are agent runs that pay their own way.
    case "week":
      return { kind: "text" };
  }
}

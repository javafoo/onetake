import type { ClipAspectRatio } from "../content/clip-options";
import { isOrigin, looksLikeMp4 } from "../lib/net";

import { framedImage } from "./clip-still";
import type { ClipState } from "./clips";
import { providerFailure } from "./provider-error";

/* Gemini Omni Flash, called on Google directly rather than through Higgsfield,
   because Google's own price is the lower one.

   Omni runs on the Interactions API, not `generateContent`, and it answers
   differently from Higgsfield in two ways that shape this file. The still goes
   in the request as base64, so nothing is uploaded first. And the finished
   video comes back inside the interaction, as base64, when it is read after
   the fact (ai.google.dev/gemini-api/docs/omni: "calling GET
   /v1beta/interactions/{id} returns the video as inline base64 data ... even
   if the interaction was originally created with delivery: uri"). So a status
   check that finds it done has already fetched the file; `downloadOmniClip`
   reads it again rather than carry megabytes through the job row.

   The split is the same as Higgsfield's: submit and return, one question per
   poll, download once done. No ledger here; the cost is returned. */

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export const OMNI_MODEL = "gemini-omni-1.1-flash";

/* The Interactions API is versioned by header. This is the revision the docs
   were written against, and the one the live test on 2026-09-25 used. */
const API_REVISION = "2026-05-20";

/** 720p is the tier `src/billing/pricing.ts` charges for. */
export const OMNI_RESOLUTION = "720p";

/** The API refuses anything over ten seconds ("exceeds the maximum allowed 10s"); three is Higgsfield's floor for it. */
export const OMNI_SECONDS = { min: 3, max: 10 } as const;

/* Per-million-token prices (ai.google.dev/gemini-api/docs/pricing, read
   2026-09-25). Video output is 5,792 tokens a second at 720p, which is
   $0.1014 a second; the live 4-second test on 2026-09-25 billed 23,168 video
   tokens, exactly that. It also spent 1,140 input tokens and about 700 text
   and thought tokens, $0.008 in all, so the whole clip was $0.413.

   The price we reserve is $0.104 a second: the video rate with that prompt
   and thinking spread over the seconds. From three seconds up it is at or
   above what the test cost. The same figure is in `src/billing/pricing.ts`. */
const PRICE_PER_MTOK_USD = { input: 1.5, text: 9, video: 17.5 } as const;
export const OMNI_PRICE_PER_SECOND_USD = 0.104;

/** The list price, reserved before the call. */
export function omniPriceUsd(seconds: number): number {
  return OMNI_PRICE_PER_SECOND_USD * seconds;
}

type ModalityTokens = { modality?: string; tokens?: number };
export interface OmniUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_thought_tokens?: number;
  output_tokens_by_modality?: ModalityTokens[];
}

/**
 * What a finished interaction actually cost, from Google's own counts.
 *
 * Video output tokens at the video rate; every other output token, and the
 * thinking, at the text rate. Undefined when there are no counts to read, so
 * the caller keeps the price it reserved.
 */
export function omniCostUsd(usage: OmniUsage | undefined): number | undefined {
  if (!usage?.total_output_tokens) return undefined;
  const video = (usage.output_tokens_by_modality ?? [])
    .filter((entry) => entry.modality === "video")
    .reduce((sum, entry) => sum + (entry.tokens ?? 0), 0);
  const text = Math.max(0, usage.total_output_tokens - video) + (usage.total_thought_tokens ?? 0);
  const input = usage.total_input_tokens ?? 0;
  return (input * PRICE_PER_MTOK_USD.input + text * PRICE_PER_MTOK_USD.text + video * PRICE_PER_MTOK_USD.video) / 1_000_000;
}

type Content = { type?: string; data?: string; uri?: string; mime_type?: string; text?: string };
type Interaction = {
  id?: string;
  status?: string;
  steps?: { type?: string; content?: Content[] }[];
  usage?: OmniUsage;
  error?: { message?: string };
};

export const API_TIMEOUT_MS = 60_000;
/** The finished interaction carries the video, so reading it is a download. */
export const DOWNLOAD_TIMEOUT_MS = 180_000;
/** Ten seconds of 720p was about 7MB in the test's proportions; base64 adds a third. */
export const MAX_INTERACTION_BYTES = 60 * 1024 * 1024;

function key(): string {
  const value = process.env.GEMINI_API_KEY;
  if (!value) throw new Error("Missing GEMINI_API_KEY");
  return value;
}

/* The key goes to Google and nowhere else, for the reason set out above
   `api()` in higgsfield.ts: every URL here is built from our own constant and
   an id, but the check costs nothing and holds if that ever changes. */
async function api(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, timeoutMs = API_TIMEOUT_MS): Promise<Interaction> {
  const target = `${BASE}${path}`;
  if (!isOrigin(target, BASE)) throw new Error(`Refusing to send the Gemini key to ${new URL(target).origin}`);
  const response = await fetch(target, {
    method,
    headers: {
      "x-goog-api-key": key(),
      "Api-Revision": API_REVISION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    redirect: "error",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_INTERACTION_BYTES) throw new Error(`Omni answered with ${length} bytes, over the ceiling`);
  const text = await response.text();
  let json: Interaction | null = null;
  try {
    json = text ? (JSON.parse(text) as Interaction) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw providerFailure("Omni", OMNI_MODEL, response.status, json?.error?.message ?? text.slice(0, 300));
  }
  return json ?? {};
}

/** The request, apart from the still. Pure, so what we ask for can be tested. */
export function omniRequestBody(fields: {
  prompt: string;
  imageBase64: string;
  seconds: number;
  aspectRatio: ClipAspectRatio;
}): Record<string, unknown> {
  return {
    model: OMNI_MODEL,
    // Runs on Google's side; we come back and ask. Requires the interaction to be stored.
    background: true,
    input: [
      { type: "image", data: fields.imageBase64, mime_type: "image/jpeg" },
      // The tag binds the photo to the first frame, so she starts exactly as she is in it.
      { type: "text", text: `<FIRST_FRAME> ${fields.prompt}` },
    ],
    generation_config: { video_config: { task: "image_to_video" } },
    response_format: {
      type: "video",
      duration: `${fields.seconds}s`,
      resolution: OMNI_RESOLUTION,
      aspect_ratio: fields.aspectRatio,
    },
  };
}

export function omniSeconds(requested: number | undefined): number {
  return Math.min(OMNI_SECONDS.max, Math.max(OMNI_SECONDS.min, Math.round(requested ?? 5)));
}

export interface OmniSubmission {
  interactionId: string;
  seconds: number;
  costUsd: number;
}

/** Hand the work over and return. Nothing here waits for the video. */
export async function submitOmniClip(options: {
  imagePath: string;
  prompt: string;
  seconds?: number;
  aspectRatio?: ClipAspectRatio;
}): Promise<OmniSubmission> {
  const seconds = omniSeconds(options.seconds);
  const aspectRatio = options.aspectRatio ?? "9:16";
  if (aspectRatio !== "9:16" && aspectRatio !== "16:9") throw new Error(`Omni cannot make ${aspectRatio} clips`);
  const still = await framedImage(options.imagePath, aspectRatio, 2048);
  const created = await api("POST", "/interactions", omniRequestBody({
    prompt: options.prompt,
    imageBase64: still.data.toString("base64"),
    seconds,
    aspectRatio,
  }));
  if (!created.id) throw new Error("Omni accepted the clip but returned no interaction id");
  return { interactionId: created.id, seconds, costUsd: omniPriceUsd(seconds) };
}

function path(interactionId: string): string {
  return `/interactions/${encodeURIComponent(interactionId)}`;
}

/** The video in a finished interaction, as Google returned it. */
export function videoContent(interaction: Interaction): Content | undefined {
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    const video = step.content?.find((content) => content.type === "video");
    if (video) return video;
  }
  return undefined;
}

/* Google's statuses mapped onto the words `clipFailure` in the job runner
   already knows. A finished interaction with no video in it is a failure:
   the safety filter answers that way. */
export function omniState(interaction: Interaction): ClipState {
  const status = interaction.status ?? "unknown";
  if (status === "in_progress" || status === "queued") return { state: "pending", status };
  if (status === "completed" && videoContent(interaction)) {
    // Not a URL anyone fetches: storeClip reads the interaction again by id.
    return { state: "completed", status, videoUrl: `${BASE}${path(interaction.id ?? "")}` };
  }
  const reason = interaction.error?.message ?? (status === "completed" ? "finished with no video (likely blocked by the safety filter)" : "");
  return {
    state: "failed",
    status: status === "cancelled" ? "canceled" : status,
    message: `Generation ${status}${reason ? `: ${reason}` : ""}`,
  };
}

/** One question to Google. Never loops, never sleeps. */
export async function omniClipStatus(interactionId: string): Promise<ClipState> {
  return omniState(await api("GET", path(interactionId), undefined, DOWNLOAD_TIMEOUT_MS));
}

/** The finished file and what it actually cost. */
export async function downloadOmniClip(interactionId: string): Promise<{ data: Buffer; costUsd: number | undefined }> {
  const interaction = await api("GET", path(interactionId), undefined, DOWNLOAD_TIMEOUT_MS);
  const video = videoContent(interaction);
  if (!video?.data) throw new Error("The Omni interaction has no video in it");
  const data = Buffer.from(video.data, "base64");
  if (!looksLikeMp4(data)) throw new Error("Omni returned something that is not an MP4 video");
  return { data, costUsd: omniCostUsd(interaction.usage) };
}

/* Google keeps a stored interaction, and this one holds her photo and her
   clip. Once the clip is ours, theirs is deleted. Best effort: a failure here
   costs nothing and must not fail a clip that is already saved. */
export async function forgetOmniClip(interactionId: string): Promise<void> {
  await api("DELETE", path(interactionId)).catch((error: unknown) => {
    console.warn(`omni ${interactionId}: could not delete the stored interaction: ${error instanceof Error ? error.message : String(error)}`);
  });
}

import { DEFAULT_IMAGE_ASPECT, type ImageAspect, type ImageModel } from "../content/image-options";
import { ffmpeg, IMAGE_FFMPEG_TIMEOUT_MS, MAX_IMAGE_OUTPUT_BYTES } from "../lib/binaries";
import { MAX_PIXELS } from "../lib/image-bytes";

import { textCallCostUsd, type TokenUsage } from "./estimates";
import { providerFailure } from "./provider-error";
import { reportUsage } from "./usage";

/* The Gemini client and nothing else: no ledger, no daily cap, no refunds.
   What a call cost us is returned with the result; `src/jobs` is what reserves
   it against the global budget and records it in `provider_costs`. */

const BASE = "https://generativelanguage.googleapis.com/v1beta";


/** The finish or block reasons that mean Google's safety filter refused the input, not a fault. */
const BLOCKED_REASONS = new Set(["PROHIBITED_CONTENT", "SAFETY", "BLOCKLIST", "SPII", "IMAGE_SAFETY", "OTHER_SAFETY"]);

/** Google refused to read what it was sent. `hadImages` says whether a picture was part of it. */
export class ContentBlockedError extends Error {
  readonly reason: string;
  readonly hadImages: boolean;
  constructor(reason: string, hadImages: boolean) {
    super(`Gemini refused the input (finish: ${reason})`);
    this.name = "ContentBlockedError";
    this.reason = reason;
    this.hadImages = hadImages;
  }
}

export const TEXT_MODEL = () => process.env.GEMINI_TEXT_MODEL ?? "gemini-3.8-flash";
export const IMAGE_MODEL_PRO = () => process.env.GEMINI_IMAGE_MODEL_PRO ?? "gemini-3-pro-image";
export const IMAGE_MODEL_DAILY = () => process.env.GEMINI_IMAGE_MODEL_DAILY ?? "gemini-nano-banana-2.1";

/** The Gemini model behind each option the product sells. "daily" is Nano Banana 2.1, "pro" Nano Banana Pro. */
export function imageModelId(model: ImageModel): string {
  return model === "pro" ? IMAGE_MODEL_PRO() : IMAGE_MODEL_DAILY();
}

/* Published per-image prices (ai.google.dev/gemini-api/docs/pricing, read 2026-09-21).
   A model missing from this table is refused rather than billed blind. */
const IMAGE_PRICE_USD: Record<string, Record<string, number>> = {
  "gemini-3-pro-image": { "1K": 0.134, "2K": 0.134, "4K": 0.24 },
  "gemini-3.1-flash-image": { "1K": 0.067, "2K": 0.101, "4K": 0.151 },
  "gemini-nano-banana-2.1": { "1K": 0.0336, "2K": 0.0504, "4K": 0.113 },
};

export type ImageSize = "1K" | "2K" | "4K";
export type InlineImage = { mimeType: string; data: Buffer };
/** An image plus what the call cost us, so the caller can record it. */
export type GeneratedImage = InlineImage & { model: string; size: ImageSize; costUsd: number };

/* One piece of a turn, in Gemini's REST shape. `thoughtSignature` is Gemini 3's
   record of its own reasoning: it arrives on a model part (always on the
   first function call of a step) and must go back on that same part when the
   history is sent again, or the next request is refused. */
export type Part = (
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: unknown } }
  | { inlineData: { mimeType: string; data: string } }
  /* Google Search's own call and answer, run on Google's side when search and
     functions are on together. Kept only so they can be sent back as they came. */
  | { toolCall: unknown }
  | { toolResponse: unknown }
) & { thoughtSignature?: string };

type ResponsePart = { text?: string; inlineData?: { mimeType?: string; data: string } };
type GeminiResponse = {
  candidates?: { content?: { parts?: ResponsePart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  /** Gemini's own token counts. Present on most responses, guaranteed on none. */
  usageMetadata?: TokenUsage;
  error?: { message?: string };
};

/* Every call is bounded. A job with nothing to poll is written off after
   STUCK_AFTER_MS (ten minutes) and its credits refunded, so a request that can
   hang for longer than that lets "completed but still running" and "written
   off" be true at once. Two takes of an image is the longest chain, so the
   image budget is a third of the stuck threshold. */
export const TEXT_TIMEOUT_MS = 90_000;
export const IMAGE_TIMEOUT_MS = 180_000;

async function call(model: string, body: unknown, timeoutMs: number): Promise<GeminiResponse> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  let response: Response;
  try {
    response = await fetch(`${BASE}/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error(`Gemini ${model} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }
  const json = (await response.json().catch(() => null)) as GeminiResponse | null;
  if (!response.ok || !json) {
    throw providerFailure("Gemini", model, response.status, json?.error?.message ?? "request failed");
  }
  return json;
}

function toParts(prompt: string, images: InlineImage[]): Part[] {
  return [
    ...images.map((image) => ({
      inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") },
    })),
    { text: prompt },
  ];
}

/** Text or vision-to-text. With a schema the reply is parsed JSON. */
export async function generateText<T = string>(options: {
  prompt: string;
  images?: InlineImage[];
  schema?: Record<string, unknown>;
  system?: string;
  /* The model deliberates before answering unless told not to, and that is
     most of the wait: a five-hook write took 53 seconds with it and a few
     without. Writing that a second pass checks anyway runs "low"; the coach,
     the judge and the safety screens keep the default. */
  thinking?: "default" | "low";
}): Promise<T> {
  const json = await call(TEXT_MODEL(), {
    ...(options.system ? { systemInstruction: { parts: [{ text: options.system }] } } : {}),
    contents: [{ role: "user", parts: toParts(options.prompt, options.images ?? []) }],
    generationConfig: {
      ...(options.schema ? { responseMimeType: "application/json", responseSchema: options.schema } : {}),
      ...(options.thinking === "low" ? { thinkingConfig: { thinkingLevel: "LOW" } } : {}),
    },
  }, TEXT_TIMEOUT_MS);
  /* Reported before the answer is parsed, so a malformed reply we paid for is
     still counted. `kind` distinguishes a vision call from a plain text one,
     because they cost very different amounts for the same token count. */
  reportUsage({
    provider: "gemini",
    model: TEXT_MODEL(),
    kind: options.images?.length ? "vision" : "text",
    costUsd: textCallCostUsd(TEXT_MODEL(), json.usageMetadata),
    tokens: json.usageMetadata,
  });

  const text = (json.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  if (!text) {
    const reason = json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "unknown";
    if (BLOCKED_REASONS.has(reason)) throw new ContentBlockedError(reason, Boolean(options.images?.length));
    throw new Error(`Gemini returned no text (finish: ${reason})`);
  }
  return (options.schema ? JSON.parse(text) : text) as T;
}

/* ---- Agent turns: streamed, with tools ---------------------------------- */

export type Content = { role: "user" | "model"; parts: Part[] };
export type ToolDecl = { name: string; description: string; parameters: Record<string, unknown> };
/** A tool the model asked for. `thoughtSignature` is set on the call that carried one. */
export type FunctionCall = { name: string; args: Record<string, unknown>; thoughtSignature?: string };

export type TurnResult = {
  text: string;
  calls: FunctionCall[];
  /** Google Search's sources, when `search` was on and it searched. Passed through unread. */
  grounding?: unknown;
  /** The model's turn as it should be appended to `contents` for the next round, signatures kept. */
  content: Content;
};

export const AGENT_MODEL = () => process.env.GEMINI_AGENT_MODEL ?? TEXT_MODEL();

/* Google's documented stand-in for a signature we do not have: a function call
   written into the history by us (a thread folded from storage, a test) rather
   than echoed from the model. Without one Gemini 3 refuses the request. */
const UNSIGNED_CALL = "skip_thought_signature_validator";

type StreamPart = ResponsePart & {
  functionCall?: { name?: string; args?: Record<string, unknown> };
  toolCall?: unknown;
  toolResponse?: unknown;
  thought?: boolean;
  thoughtSignature?: string;
};
type StreamChunk = {
  candidates?: { content?: { parts?: StreamPart[] }; finishReason?: string; groundingMetadata?: unknown }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: TokenUsage & { thoughtsTokenCount?: number };
  error?: { code?: number; message?: string };
};

/** The request body for one turn. Pure, so its shape can be checked without a network. */
export function turnRequestBody(options: {
  system: string;
  contents: Content[];
  tools?: ToolDecl[];
  search?: boolean;
  thinking?: "default" | "low";
}): Record<string, unknown> {
  const tools: Record<string, unknown>[] = [];
  if (options.tools?.length) tools.push({ functionDeclarations: options.tools });
  if (options.search) tools.push({ google_search: {} });
  return {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: options.contents.map(signCalls),
    ...(tools.length ? { tools } : {}),
    // Gemini 3 refuses Google Search alongside our own functions unless this is set.
    ...(options.search && options.tools?.length ? { toolConfig: { includeServerSideToolInvocations: true } } : {}),
    ...(options.thinking === "low" ? { generationConfig: { thinkingConfig: { thinkingLevel: "LOW" } } } : {}),
  };
}

/** Only the first call of a model step needs a signature; give it the stand-in if it has none. */
function signCalls(content: Content): Content {
  if (content.role !== "model") return content;
  const first = content.parts.findIndex((part) => "functionCall" in part);
  if (first < 0 || content.parts.some((part) => "functionCall" in part && part.thoughtSignature)) return content;
  return {
    ...content,
    parts: content.parts.map((part, index) => (index === first ? { ...part, thoughtSignature: UNSIGNED_CALL } : part)),
  };
}

/**
 * The JSON payloads of a server-sent-event stream, as they complete. Pure.
 * Returns the parsed events and whatever is left over for the next read.
 */
export function sseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) events.push(data);
  }
  return { events, rest };
}

/**
 * One model turn with tools, streamed. Text deltas reach `onText` as they
 * arrive; function calls come back whole. The caller runs the calls and sends
 * the next round: this does one request and nothing else.
 */
export async function generateTurn(options: {
  model?: string;
  system: string;
  contents: Content[];
  tools?: ToolDecl[];
  search?: boolean;
  thinking?: "default" | "low";
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Missing GEMINI_API_KEY");
  const model = options.model ?? AGENT_MODEL();
  const timeoutMs = options.timeoutMs ?? TEXT_TIMEOUT_MS;
  const doFetch = options.fetch ?? fetch;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const hadImages = options.contents.some((content) => content.parts.some((part) => "inlineData" in part));

  let text = "";
  const calls: FunctionCall[] = [];
  const parts: Part[] = [];
  let finishReason: string | undefined;
  let blockReason: string | undefined;
  let usage: StreamChunk["usageMetadata"];
  let grounding: unknown;

  const take = (chunk: StreamChunk) => {
    if (chunk.error) throw providerFailure("Gemini", model, chunk.error.code ?? 500, chunk.error.message ?? "stream failed");
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
    if (chunk.promptFeedback?.blockReason) blockReason = chunk.promptFeedback.blockReason;
    const candidate = chunk.candidates?.[0];
    if (!candidate) return;
    if (candidate.finishReason) finishReason = candidate.finishReason;
    if (candidate.groundingMetadata) grounding = candidate.groundingMetadata;
    for (const part of candidate.content?.parts ?? []) {
      const signature = part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {};
      if (part.functionCall?.name) {
        const call = { name: part.functionCall.name, args: part.functionCall.args ?? {} };
        calls.push({ ...call, ...signature });
        parts.push({ functionCall: call, ...signature });
      } else if (part.toolCall !== undefined) {
        parts.push({ toolCall: part.toolCall, ...signature });
      } else if (part.toolResponse !== undefined) {
        parts.push({ toolResponse: part.toolResponse, ...signature });
      } else if (part.text && !part.thought) {
        text += part.text;
        options.onText?.(part.text);
        // Streamed text arrives in many small pieces; the history wants it as one part.
        const last = parts.at(-1);
        if (last && "text" in last && !last.thoughtSignature && !part.thoughtSignature) last.text += part.text;
        else parts.push({ text: part.text, ...signature });
      } else if (part.thoughtSignature) {
        // A part with nothing to show can still carry the step's signature; the history needs it.
        parts.push({ text: "", ...signature });
      }
    }
  };

  try {
    const response = await doFetch(`${BASE}/models/${model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify(turnRequestBody(options)),
      signal,
    });
    if (!response.ok || !response.body) {
      const json = (await response.json().catch(() => null)) as StreamChunk | null;
      throw providerFailure("Gemini", model, response.status, json?.error?.message ?? "request failed");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const { events, rest } = sseEvents(buffer);
      buffer = rest;
      for (const event of events) take(JSON.parse(event) as StreamChunk);
    }
    // A stream that ends without a blank line still holds its last event.
    for (const event of sseEvents(`${buffer}${decoder.decode()}\n\n`).events) take(JSON.parse(event) as StreamChunk);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      if (options.signal?.aborted) throw error;
      throw new Error(`Gemini ${model} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }

  /* Thinking is billed as output but counted apart from `candidatesTokenCount`,
     and an agent turn thinks before nearly every tool call, so it is added in
     here rather than left out of the cost. */
  const tokens: TokenUsage | undefined = usage && {
    promptTokenCount: usage.promptTokenCount,
    candidatesTokenCount: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
    totalTokenCount: usage.totalTokenCount,
  };
  reportUsage({
    provider: "gemini",
    model,
    kind: hadImages ? "vision" : "text",
    costUsd: textCallCostUsd(model, tokens),
    tokens,
  });

  if (!text && !calls.length) {
    const reason = blockReason ?? finishReason ?? "unknown";
    if (BLOCKED_REASONS.has(reason)) throw new ContentBlockedError(reason, hadImages);
    throw new Error(`Gemini returned no text (finish: ${reason})`);
  }
  return { text, calls, ...(grounding === undefined ? {} : { grounding }), content: { role: "model", parts } };
}

/** The provider's list price for one image, or undefined if we have none on file. */
export function imagePriceUsd(model: string, size: ImageSize): number | undefined {
  return IMAGE_PRICE_USD[model]?.[size];
}

/* Explicit safety settings on every image call.
 *
 * Gemini's defaults are a moving target and they were never stated here, so
 * what the image model would and would not draw was whatever the provider had
 * decided that month. These are stated, and they are stricter than the
 * defaults in the one place that matters for this product: sexually explicit
 * content is blocked at the lowest threshold rather than the medium one,
 * because "borderline" is not a category this product has any use for.
 *
 * This is the provider's own filter, and it is the outer of two. The inner one
 * is ours: src/safety/screen.ts looks at the photographs and at the scene idea
 * before either reaches here. Neither is sufficient alone. */
const IMAGE_SAFETY_SETTINGS = [
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
] as const;

/** One image out, with what it cost us. Google does not bill a request that produced no image. */
export async function generateImage(options: {
  prompt: string;
  references?: InlineImage[];
  model?: string;
  /* The five shapes the product sells, plus 3:4, which the identity views are
     drawn at. Gemini's `imageConfig.aspectRatio` takes these as strings. */
  aspectRatio?: ImageAspect | "3:4";
  size?: ImageSize;
  label?: string;
}): Promise<GeneratedImage> {
  const model = options.model ?? IMAGE_MODEL_DAILY();
  const size = options.size ?? "2K";
  const costUsd = imagePriceUsd(model, size);
  if (costUsd === undefined) throw new Error(`No price on file for ${model} at ${size}; refusing to bill blind`);

  const json = await call(model, {
    contents: [{ role: "user", parts: toParts(options.prompt, options.references ?? []) }],
    safetySettings: IMAGE_SAFETY_SETTINGS,
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: options.aspectRatio ?? DEFAULT_IMAGE_ASPECT, imageSize: size },
    },
  }, IMAGE_TIMEOUT_MS);
  const inline = (json.candidates?.[0]?.content?.parts ?? []).find((part) => part.inlineData?.data)?.inlineData;
  // Google does not bill a request that produced no image, so this is only
  // reported once there is one.
  if (inline) reportUsage({ provider: "gemini", model, kind: "image", costUsd });
  if (!inline) {
    const reason = json.candidates?.[0]?.finishReason ?? json.promptFeedback?.blockReason ?? "no image part";
    throw new Error(`Gemini returned no image (${reason})`);
  }
  return { mimeType: inline.mimeType ?? "image/png", data: Buffer.from(inline.data, "base64"), model, size, costUsd };
}

/* Source photos arrive as 5-10 MB PNGs; references only need ~1536px JPEGs.

   The path is a temp file written from storage, so the bytes were ours before
   they were on disk — but a row written before the upload path re-encoded
   everything may still point at an original, so the same ceilings apply: a
   pixel limit the decoder enforces itself, a timeout, and a cap on what may
   come back. */
export async function toReference(path: string, maxSide = 1536): Promise<InlineImage> {
  const data = await ffmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-max_pixels", String(MAX_PIXELS), "-i", path,
      "-vf", `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`,
      "-frames:v", "1", "-map_metadata", "-1", "-q:v", "3", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
    ],
    `read ${path}`,
    { timeoutMs: IMAGE_FFMPEG_TIMEOUT_MS, maxOutputBytes: MAX_IMAGE_OUTPUT_BYTES },
  );
  return { mimeType: "image/jpeg", data };
}

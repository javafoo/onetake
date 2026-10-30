import type { Content, FunctionCall, Part, ToolDecl, TurnResult } from "./gemini";
import { sseEvents } from "./gemini";
import { textCallCostUsd, type TokenUsage } from "./estimates";
import { providerFailure } from "./provider-error";
import { reportUsage } from "./usage";

/* NVIDIA Nemotron on Nebius Token Factory, and nothing else: no ledger, no cap.
   Token Factory speaks the OpenAI chat API, so a call here is one POST to
   /chat/completions. Three sizes, each for the job it is best at:
   Nano for quick writing that a second pass checks anyway, Super for the
   agent's decisions and the critic, Ultra for the few calls where the depth
   of the reasoning is the product (reading her week, planning it). */

const BASE = () => (process.env.NEBIUS_BASE_URL ?? "https://api.tokenfactory.nebius.com/v1").replace(/\/$/, "");

export type Tier = "nano" | "super" | "ultra";

export const NEMOTRON_MODELS: Record<Tier, () => string> = {
  nano: () => process.env.NEMOTRON_NANO_MODEL ?? "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  super: () => process.env.NEMOTRON_SUPER_MODEL ?? "nvidia/nemotron-3-super-120b-a12b",
  ultra: () => process.env.NEMOTRON_ULTRA_MODEL ?? "nvidia/Nemotron-3-Ultra-550b-a55b",
};

export const NEMOTRON_TEXT_TIMEOUT_MS = 90_000;
/* Room for the answer and any reasoning before it. Reasoning counts against
   the limit: live runs hit 8192 mid-thought ("finish: length") and returned
   nothing, which sent the call to the fallback model. */
export const NEMOTRON_MAX_TOKENS = 16384;

/* How hard Nemotron thinks before it answers. By default Super reasons for
   hundreds of tokens even before a one-line hook; "low" answers in a quarter
   of the time with almost no reasoning. Low is for calls a later step checks
   (the writer, the fact-check, the agent's choice of tool); the planner and
   the critic, where judgement is the product, keep the default. */
export type Reasoning = "default" | "low";
/** Ultra reasons at length before it answers; a week plan is worth the wait, a hook is not. */
export const NEMOTRON_ULTRA_TIMEOUT_MS = 180_000;

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

type ChatResponse = {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string };
};

type StreamChunk = {
  choices?: {
    delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
    finish_reason?: string | null;
  }[];
  usage?: ChatResponse["usage"];
  error?: { message?: string; code?: number };
};

/* Nemotron can think out loud inside <think> tags before it answers. The
   thinking is not the answer: it is dropped from what is shown and parsed. */
const THINK = /<think>[\s\S]*?(<\/think>|$)/g;

/* Nemotron likes typographic characters the reel and slide fonts cannot
   draw: a non-breaking hyphen came out as a box in "one-day" on a live photo.
   They are swapped for the plain ones, both as characters and as JSON escapes. */
const GLYPHS: [RegExp, string][] = [
  [/[\u2010\u2011\u2012]|\\u201[012]/g, "-"],
  [/[\u00a0\u202f\u2007]|\\u00a0|\\u202f|\\u2007/gi, " "],
];

/** Text with the characters the fonts cannot draw made plain. Pure. */
export function plainGlyphs(text: string): string {
  return GLYPHS.reduce((out, [pattern, plain]) => out.replace(pattern, plain), text);
}

/** The answer with any thinking removed and its glyphs made plain. Pure. */
export function withoutThinking(text: string): string {
  return plainGlyphs(text.replace(THINK, "")).trim();
}

/** A reply that should be JSON, read leniently: fences and thinking dropped, the outermost object taken. Pure. */
export function parseJsonReply<T>(text: string): T {
  const cleaned = withoutThinking(text).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.search(/[[{]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("Nemotron did not answer in JSON");
  }
}

function tokensOf(usage: ChatResponse["usage"]): TokenUsage | undefined {
  return usage && { promptTokenCount: usage.prompt_tokens, candidatesTokenCount: usage.completion_tokens, totalTokenCount: usage.total_tokens };
}

/** The request body for a plain text call. Pure, so its shape can be checked without a network. */
export function chatRequestBody(options: {
  model: string;
  prompt: string;
  system?: string;
  schema?: Record<string, unknown>;
  reasoning?: Reasoning;
}): Record<string, unknown> {
  const messages: ChatMessage[] = [];
  if (options.system) messages.push({ role: "system", content: options.system });
  messages.push({ role: "user", content: options.prompt });
  return {
    model: options.model,
    messages,
    max_tokens: NEMOTRON_MAX_TOKENS,
    ...(options.reasoning === "low" ? { reasoning_effort: "low" } : {}),
    ...(options.schema
      ? { response_format: { type: "json_schema", json_schema: { name: "answer", schema: options.schema, strict: false } } }
      : {}),
  };
}

async function post(path: string, body: unknown, model: string, timeoutMs: number, doFetch: typeof fetch, signal?: AbortSignal): Promise<Response> {
  const key = process.env.NEBIUS_API_KEY;
  if (!key) throw new Error("Missing NEBIUS_API_KEY");
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    return await doFetch(`${BASE()}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      if (signal?.aborted) throw error;
      throw new Error(`Nemotron ${model} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }
}

/** One text call. With a schema the reply is parsed JSON. */
export async function nemotronText<T = string>(options: {
  prompt: string;
  system?: string;
  schema?: Record<string, unknown>;
  tier?: Tier;
  reasoning?: Reasoning;
  /** For tests. */
  fetch?: typeof fetch;
}): Promise<T> {
  const tier = options.tier ?? "super";
  const model = NEMOTRON_MODELS[tier]();
  const timeoutMs = tier === "ultra" ? NEMOTRON_ULTRA_TIMEOUT_MS : NEMOTRON_TEXT_TIMEOUT_MS;
  const response = await post("/chat/completions", chatRequestBody({ ...options, model }), model, timeoutMs, options.fetch ?? fetch);
  const json = (await response.json().catch(() => null)) as ChatResponse | null;
  if (!response.ok || !json) throw providerFailure("Nemotron", model, response.status, json?.error?.message ?? "request failed");
  const tokens = tokensOf(json.usage);
  reportUsage({ provider: "nebius", model, kind: "text", costUsd: textCallCostUsd(model, tokens), tokens });

  const text = withoutThinking(json.choices?.[0]?.message?.content ?? "");
  if (!text) throw new Error(`Nemotron returned no text (finish: ${json.choices?.[0]?.finish_reason ?? "unknown"})`);
  return (options.schema ? parseJsonReply<T>(text) : text) as T;
}

/* ---- Agent turns: the same contract as Gemini's generateTurn ------------- */

/* The thread is stored in Gemini's shape (role user/model, parts). Token
   Factory wants OpenAI messages, where every tool result names the call it
   answers. Our history has no call ids, so they are made from position: the
   n-th call of a model step and the n-th response that follows it share one. */
const callId = (step: number, index: number) => `call_${step}_${index}`;

/** A Gemini-shaped thread as OpenAI chat messages. Pure. Images are left out: such turns go to Gemini. */
export function toChatMessages(system: string, contents: Content[]): ChatMessage[] {
  const messages: ChatMessage[] = [{ role: "system", content: system }];
  let step = -1;
  for (const content of contents) {
    if (content.role === "model") {
      step += 1;
      const text = content.parts.map((part) => ("text" in part ? part.text : "")).join("");
      const calls = content.parts.flatMap((part) => ("functionCall" in part ? [part.functionCall] : []));
      messages.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? { tool_calls: calls.map((call, index) => ({ id: callId(step, index), type: "function" as const, function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } })) }
          : {}),
      });
      continue;
    }
    let answered = 0;
    const text: string[] = [];
    for (const part of content.parts) {
      if ("functionResponse" in part) {
        messages.push({ role: "tool", tool_call_id: callId(Math.max(step, 0), answered), content: JSON.stringify(part.functionResponse.response ?? {}) });
        answered += 1;
      } else if ("text" in part && part.text) {
        text.push(part.text);
      }
    }
    if (text.length) messages.push({ role: "user", content: text.join("\n\n") });
  }
  return messages;
}

/** The request body for one agent turn. Pure. */
export function nemotronTurnBody(options: { model: string; system: string; contents: Content[]; tools?: ToolDecl[]; reasoning?: Reasoning }): Record<string, unknown> {
  return {
    model: options.model,
    messages: toChatMessages(options.system, options.contents),
    max_tokens: NEMOTRON_MAX_TOKENS,
    ...(options.reasoning === "low" ? { reasoning_effort: "low" } : {}),
    stream: true,
    stream_options: { include_usage: true },
    ...(options.tools?.length
      ? { tools: options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" }
      : {}),
  };
}

/** Whether a thread carries a picture, which Nemotron's text models cannot read. */
export function hasImages(contents: Content[]): boolean {
  return contents.some((content) => content.parts.some((part) => "inlineData" in part));
}

/* Text streams in small pieces, and a reply may open with <think>. What is
   shown starts only after the thinking closes, so the browser never sees it.
   Only a reply that opens with thinking is filtered live; `withoutThinking`
   cleans the stored answer of anything later. */
export function thinkingFilter(): (delta: string) => string {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let mode: "start" | "thinking" | "answer" = "start";
  let buffer = "";
  return (delta) => {
    buffer += delta;
    for (;;) {
      if (mode === "start") {
        const trimmed = buffer.trimStart();
        if (trimmed.startsWith(OPEN)) {
          mode = "thinking";
          buffer = trimmed.slice(OPEN.length);
          continue;
        }
        // Too little has arrived to know whether thinking is coming.
        if (OPEN.startsWith(trimmed)) return "";
        mode = "answer";
        buffer = trimmed;
        continue;
      }
      if (mode === "thinking") {
        const close = buffer.indexOf(CLOSE);
        if (close < 0) {
          // Keep only enough to catch a closing tag split across pieces.
          buffer = buffer.slice(-(CLOSE.length - 1));
          return "";
        }
        mode = "start";
        buffer = buffer.slice(close + CLOSE.length);
        continue;
      }
      const out = buffer;
      buffer = "";
      return out;
    }
  };
}

/** One agent turn with tools, streamed, in the same shape as Gemini's `generateTurn`. */
export async function nemotronTurn(options: {
  tier?: Tier;
  reasoning?: Reasoning;
  system: string;
  contents: Content[];
  tools?: ToolDecl[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
  /** For tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<TurnResult> {
  const model = NEMOTRON_MODELS[options.tier ?? "super"]();
  const timeoutMs = options.timeoutMs ?? NEMOTRON_TEXT_TIMEOUT_MS;
  const response = await post("/chat/completions", nemotronTurnBody({ ...options, model }), model, timeoutMs, options.fetch ?? fetch, options.signal);
  if (!response.ok || !response.body) {
    const json = (await response.json().catch(() => null)) as ChatResponse | null;
    throw providerFailure("Nemotron", model, response.status, json?.error?.message ?? "request failed");
  }

  let raw = "";
  let usage: ChatResponse["usage"];
  let finish: string | undefined;
  const pending = new Map<number, { name: string; args: string }>();
  const show = thinkingFilter();

  const take = (chunk: StreamChunk) => {
    if (chunk.error) throw providerFailure("Nemotron", model, chunk.error.code ?? 500, chunk.error.message ?? "stream failed");
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const delta = choice.delta;
    if (delta?.content) {
      raw += delta.content;
      const visible = show(delta.content);
      if (visible) options.onText?.(visible);
    }
    for (const call of delta?.tool_calls ?? []) {
      const entry = pending.get(call.index) ?? { name: "", args: "" };
      if (call.function?.name) entry.name += call.function.name;
      if (call.function?.arguments) entry.args += call.function.arguments;
      pending.set(call.index, entry);
    }
  };

  try {
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      const { events, rest } = sseEvents(buffer);
      buffer = rest;
      for (const event of events) if (event !== "[DONE]") take(JSON.parse(event) as StreamChunk);
    }
    for (const event of sseEvents(`${buffer}${decoder.decode()}\n\n`).events) if (event !== "[DONE]") take(JSON.parse(event) as StreamChunk);
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      if (options.signal?.aborted) throw error;
      throw new Error(`Nemotron ${model} did not answer within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  }

  const tokens = tokensOf(usage);
  reportUsage({ provider: "nebius", model, kind: "text", costUsd: textCallCostUsd(model, tokens), tokens });

  const text = withoutThinking(raw);
  const calls: FunctionCall[] = [...pending.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, call]) => call.name)
    .map(([, call]) => ({ name: call.name, args: safeArgs(call.args) }));
  if (!text && !calls.length) throw new Error(`Nemotron returned no text (finish: ${finish ?? "unknown"})`);

  const parts: Part[] = [];
  if (text) parts.push({ text });
  for (const call of calls) parts.push({ functionCall: { name: call.name, args: call.args } });
  return { text, calls, content: { role: "model", parts } };
}

/** Tool arguments as an object; a model that sends broken JSON gets an empty one, which the tool refuses in words. */
function safeArgs(args: string): Record<string, unknown> {
  if (!args.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(args);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

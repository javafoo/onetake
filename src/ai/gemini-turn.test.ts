import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { ContentBlockedError, generateTurn, sseEvents, turnRequestBody, type Content, type ToolDecl } from "./gemini";
import { ProviderUnavailableError } from "./provider-error";
import { setUsageSink, type ObservedCall } from "./usage";

/* generateTurn against a fake fetch that streams server-sent events. Nothing
   here reaches Google; the key is only checked to be present, never compared,
   so a failing assertion cannot print it. */

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** A response whose body arrives in the pieces given, split wherever they are split. */
function streamed(pieces: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/event-stream" } });
}

function fakeFetch(answer: () => Response | Promise<Response>): { sent: Sent[]; fetch: typeof fetch } {
  const sent: Sent[] = [];
  const doFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body)) });
    return answer();
  }) as unknown as typeof fetch;
  return { sent, fetch: doFetch };
}

const event = (chunk: unknown) => `data: ${JSON.stringify(chunk)}\r\n\r\n`;

const WEATHER: ToolDecl = {
  name: "get_weather",
  description: "Weather for one city",
  parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
};
const ASK: Content[] = [{ role: "user", parts: [{ text: "Weather in Lisbon?" }] }];

let reported: ObservedCall[] = [];
const savedKey = process.env.GEMINI_API_KEY;
beforeEach(() => {
  reported = [];
  setUsageSink((call) => reported.push(call));
  process.env.GEMINI_API_KEY ??= "test-key";
});
afterEach(() => {
  setUsageSink(undefined);
  if (savedKey === undefined) delete process.env.GEMINI_API_KEY;
});

test("text streams in order, then the function call comes back whole with its signature", async () => {
  const whole =
    event({ candidates: [{ content: { role: "model", parts: [{ text: "Let me " }] } }], usageMetadata: { promptTokenCount: 50 } }) +
    event({ candidates: [{ content: { role: "model", parts: [{ text: "check." }] } }], usageMetadata: { promptTokenCount: 50 } }) +
    event({
      candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Lisbon" } }, thoughtSignature: "sig-1" }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30, totalTokenCount: 150 },
    });
  // Split mid-event, so the parser has to carry a partial line between reads.
  const { sent, fetch } = fakeFetch(() => streamed([whole.slice(0, 37), whole.slice(37, 160), whole.slice(160)]));
  const deltas: string[] = [];

  const turn = await generateTurn({ model: "gemini-3.8-flash", system: "Be brief.", contents: ASK, tools: [WEATHER], onText: (d) => deltas.push(d), fetch });

  assert.deepEqual(deltas, ["Let me ", "check."]);
  assert.equal(turn.text, "Let me check.");
  assert.deepEqual(turn.calls, [{ name: "get_weather", args: { city: "Lisbon" }, thoughtSignature: "sig-1" }]);
  assert.deepEqual(turn.content, {
    role: "model",
    parts: [{ text: "Let me check." }, { functionCall: { name: "get_weather", args: { city: "Lisbon" } }, thoughtSignature: "sig-1" }],
  });
  assert.equal(turn.grounding, undefined);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert.ok(sent[0].headers["x-goog-api-key"], "the key goes in Google's header");
  assert.deepEqual(sent[0].body.systemInstruction, { parts: [{ text: "Be brief." }] });
  assert.deepEqual(sent[0].body.tools, [{ functionDeclarations: [WEATHER] }]);
  assert.equal(sent[0].body.toolConfig, undefined);

  // One report per turn, from the last chunk's counts, thinking billed as output.
  assert.equal(reported.length, 1);
  assert.equal(reported[0].kind, "text");
  const expected = (100 * 0.3 + 50 * 2.5) / 1_000_000;
  assert.ok(Math.abs((reported[0].costUsd ?? 0) - expected) < 1e-12, `cost ${reported[0].costUsd}`);
});

test("a call with no args gets an empty object, and the last event needs no trailing blank line", async () => {
  const { fetch } = fakeFetch(() => streamed([`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "read_brand" } }] }, finishReason: "STOP" }] })}`]));
  const turn = await generateTurn({ system: "s", contents: ASK, tools: [WEATHER], fetch });
  assert.deepEqual(turn.calls, [{ name: "read_brand", args: {} }]);
  assert.equal(reported.length, 1);
  assert.equal(reported[0].costUsd, undefined, "no counts, no invented cost");
});

test("the request body: functions, search, both, and low thinking", () => {
  assert.deepEqual(turnRequestBody({ system: "s", contents: ASK }).tools, undefined);

  const searchOnly = turnRequestBody({ system: "s", contents: ASK, search: true });
  assert.deepEqual(searchOnly.tools, [{ google_search: {} }]);
  assert.equal(searchOnly.toolConfig, undefined);

  const both = turnRequestBody({ system: "s", contents: ASK, tools: [WEATHER], search: true, thinking: "low" });
  assert.deepEqual(both.tools, [{ functionDeclarations: [WEATHER] }, { google_search: {} }]);
  assert.deepEqual(both.toolConfig, { includeServerSideToolInvocations: true });
  assert.deepEqual(both.generationConfig, { thinkingConfig: { thinkingLevel: "LOW" } });
});

test("a function call written into the history without a signature is given Google's stand-in", () => {
  const history: Content[] = [
    ...ASK,
    { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Lisbon" } } }, { functionCall: { name: "get_weather", args: { city: "Porto" } } }] },
    { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { sky: "sunny" } } }] },
    { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Faro" } }, thoughtSignature: "real" }] },
  ];
  const sent = turnRequestBody({ system: "s", contents: history }).contents as Content[];
  assert.equal(sent[1].parts[0].thoughtSignature, "skip_thought_signature_validator");
  assert.equal(sent[1].parts[1].thoughtSignature, undefined, "only the first call of a step");
  assert.deepEqual(sent[2], history[2]);
  assert.deepEqual(sent[3], history[3], "a real signature is left alone");
  assert.equal(history[1].parts[0].thoughtSignature, undefined, "the caller's history is not changed");
});

test("Google Search's own call and answer are kept in the history, grounding passed through", async () => {
  const { fetch } = fakeFetch(() =>
    streamed([
      event({ candidates: [{ content: { parts: [{ toolCall: { id: "t1" }, thoughtSignature: "a" }] } }] }),
      event({ candidates: [{ content: { parts: [{ toolResponse: { id: "t1" }, thoughtSignature: "b" }] } }] }),
      event({ candidates: [{ content: { parts: [{ text: "Messi." }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["ballon d'or"] } }] }),
    ]),
  );
  const turn = await generateTurn({ system: "s", contents: ASK, tools: [WEATHER], search: true, fetch });
  assert.equal(turn.text, "Messi.");
  assert.deepEqual(turn.content.parts, [{ toolCall: { id: "t1" }, thoughtSignature: "a" }, { toolResponse: { id: "t1" }, thoughtSignature: "b" }, { text: "Messi." }]);
  assert.deepEqual(turn.grounding, { webSearchQueries: ["ballon d'or"] });
});

test("a blocked prompt throws ContentBlockedError, after the usage is reported", async () => {
  const { fetch } = fakeFetch(() => streamed([event({ promptFeedback: { blockReason: "PROHIBITED_CONTENT" }, usageMetadata: { promptTokenCount: 40 } })]));
  await assert.rejects(generateTurn({ system: "s", contents: ASK, fetch }), (error: unknown) => {
    assert.ok(error instanceof ContentBlockedError);
    assert.equal(error.reason, "PROHIBITED_CONTENT");
    assert.equal(error.hadImages, false);
    return true;
  });
  assert.equal(reported.length, 1);
});

test("an empty answer that is not a block is a plain error naming the finish reason", async () => {
  const { fetch } = fakeFetch(() => streamed([event({ candidates: [{ content: { parts: [] }, finishReason: "MALFORMED_FUNCTION_CALL" }] })]));
  await assert.rejects(generateTurn({ system: "s", contents: ASK, fetch }), /no text \(finish: MALFORMED_FUNCTION_CALL\)/);
});

test("a refused request keeps the provider's error shape", async () => {
  const { fetch } = fakeFetch(() => new Response(JSON.stringify({ error: { message: "bad schema" } }), { status: 400 }));
  await assert.rejects(generateTurn({ system: "s", contents: ASK, fetch }), (error: unknown) => {
    assert.ok(error instanceof Error && !(error instanceof ProviderUnavailableError));
    assert.match(error.message, /^Gemini .* 400: bad schema$/);
    return true;
  });
  assert.equal(reported.length, 0, "nothing billed, nothing reported");
});

test("an error sent inside the stream is thrown", async () => {
  const { fetch } = fakeFetch(() => streamed([event({ candidates: [{ content: { parts: [{ text: "Hel" }] } }] }), event({ error: { code: 400, message: "stream broke" } })]));
  await assert.rejects(generateTurn({ system: "s", contents: ASK, fetch }), /400: stream broke/);
});

/** A fetch that never answers until its signal fires, as a hung connection would. */
const hanging = (async (_url: string | URL | Request, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  })) as unknown as typeof fetch;

/* AbortSignal.timeout does not hold the process open, so without a timer of
   our own the runner would see nothing pending and cancel the test. */
async function keptAlive<T>(work: Promise<T>): Promise<T> {
  const timer = setTimeout(() => undefined, 5_000);
  try {
    return await work;
  } finally {
    clearTimeout(timer);
  }
}

test("a turn that does not answer in time says so", async () => {
  await keptAlive(assert.rejects(generateTurn({ model: "m", system: "s", contents: ASK, fetch: hanging, timeoutMs: 20 }), /Gemini m did not answer within 0s/));
});

test("a turn the caller cancels throws the caller's abort, not a timeout", async () => {
  const controller = new AbortController();
  const turn = generateTurn({ system: "s", contents: ASK, fetch: hanging, signal: controller.signal });
  controller.abort();
  await keptAlive(assert.rejects(turn, (error: unknown) => error instanceof Error && error.name === "AbortError"));
});

test("sseEvents keeps an unfinished event for the next read", () => {
  assert.deepEqual(sseEvents('data: {"a":1}\n\ndata: {"b"'), { events: ['{"a":1}'], rest: 'data: {"b"' });
  assert.deepEqual(sseEvents('data: {"a":1}\r\n\r\n: comment\n\n'), { events: ['{"a":1}'], rest: "" });
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { Content } from "./gemini";
import { chatRequestBody, nemotronText, nemotronTurn, parseJsonReply, thinkingFilter, toChatMessages, withoutThinking } from "./nemotron";
import { readSearch, searchRequestBody } from "./tavily";
import { routeText } from "./text";

function sse(events: unknown[]): Response {
  const body = events.map((event) => `data: ${typeof event === "string" ? event : JSON.stringify(event)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("routeText", () => {
  test("words go to Nemotron, sized by the call", () => {
    assert.deepEqual(routeText({}, true), { provider: "nemotron", tier: "super" });
    assert.deepEqual(routeText({ thinking: "low" }, true), { provider: "nemotron", tier: "nano" });
    assert.deepEqual(routeText({ tier: "ultra", thinking: "low" }, true), { provider: "nemotron", tier: "ultra" });
  });

  test("pictures, or no Nemotron key, go to Gemini", () => {
    assert.deepEqual(routeText({ images: [{ mimeType: "image/png", data: Buffer.from("x") }] }, true), { provider: "gemini" });
    assert.deepEqual(routeText({}, false), { provider: "gemini" });
  });
});

describe("thinking", () => {
  test("is dropped from a finished answer", () => {
    assert.equal(withoutThinking("<think>let me see</think>\n\nThe hook."), "The hook.");
    assert.equal(withoutThinking("<think>never closed"), "");
  });

  test("is held back while streaming, even split across pieces", () => {
    const show = thinkingFilter();
    const out = ["<thi", "nk>plan the ", "week</th", "ink>\n", "Here is ", "your week."].map(show).join("");
    assert.equal(out, "Here is your week.");
  });

  test("a reply with no thinking streams as it comes", () => {
    const show = thinkingFilter();
    assert.equal(["Hello", " there"].map(show).join(""), "Hello there");
  });

  test("non-breaking hyphens and spaces become plain ones, raw or escaped", () => {
    assert.equal(withoutThinking("one\u2011day\u00a0sprint"), "one-day sprint");
    assert.deepEqual(parseJsonReply('{"hook":"one\\u2011day"}'), { hook: "one-day" });
  });

  test("JSON replies are read through fences and thinking", () => {
    assert.deepEqual(parseJsonReply('<think>hm</think>```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJsonReply('Sure: {"posts":[1,2]} done'), { posts: [1, 2] });
    assert.throws(() => parseJsonReply("no json here"));
  });
});

describe("chat requests", () => {
  test("a schema asks for JSON", () => {
    const body = chatRequestBody({ model: "m", prompt: "p", system: "s", schema: { type: "object" } });
    assert.deepEqual(body.messages, [{ role: "system", content: "s" }, { role: "user", content: "p" }]);
    assert.equal((body.response_format as { type: string }).type, "json_schema");
    assert.equal(body.reasoning_effort, undefined);
    assert.equal(chatRequestBody({ model: "m", prompt: "p", reasoning: "low" }).reasoning_effort, "low");
  });

  test("a Gemini-shaped thread becomes paired tool calls and results", () => {
    const contents: Content[] = [
      { role: "user", parts: [{ text: "make me a photo" }] },
      { role: "model", parts: [{ text: "On it." }, { functionCall: { name: "make_photos", args: { brief: "coffee" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "make_photos", response: { ok: true } } }] },
    ];
    const messages = toChatMessages("sys", contents);
    assert.equal(messages.length, 4);
    const assistant = messages[2] as { tool_calls: { id: string; function: { name: string; arguments: string } }[] };
    const tool = messages[3] as { role: string; tool_call_id: string };
    assert.equal(assistant.tool_calls[0].function.name, "make_photos");
    assert.equal(tool.role, "tool");
    assert.equal(tool.tool_call_id, assistant.tool_calls[0].id);
  });
});

describe("calls", () => {
  test("a text call parses JSON and drops thinking", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const fake = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))) as unknown as typeof fetch;
    assert.deepEqual(await nemotronText({ prompt: "p", schema: { type: "object" }, fetch: fake }), { ok: true });
  });

  test("a streamed turn returns text and whole tool calls", async () => {
    process.env.NEBIUS_API_KEY = "test";
    const fake = (async () =>
      sse([
        { choices: [{ delta: { content: "<think>which tool</think>Making " } }] },
        { choices: [{ delta: { content: "it now." } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "make_", arguments: '{"brief":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "photos", arguments: '"coffee"}' } }] }, finish_reason: "tool_calls" }] },
        { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } },
        "[DONE]",
      ])) as unknown as typeof fetch;
    const shown: string[] = [];
    const result = await nemotronTurn({ system: "s", contents: [{ role: "user", parts: [{ text: "hi" }] }], onText: (d) => shown.push(d), fetch: fake });
    assert.equal(result.text, "Making it now.");
    assert.equal(shown.join(""), "Making it now.");
    assert.deepEqual(result.calls, [{ name: "make_photos", args: { brief: "coffee" } }]);
    assert.equal(result.content.role, "model");
  });
});

describe("tavily", () => {
  test("asks for this week's news with a short answer", () => {
    const body = searchRequestBody({ query: "solo founders instagram" });
    assert.equal(body.topic, "news");
    assert.equal(body.time_range, "week");
    assert.equal(body.max_results, 5);
  });

  test("keeps only results with a link", () => {
    const read = readSearch({ answer: " A summary ", results: [{ title: "T", url: "https://a.com", content: "c" }, { title: "no link" }] });
    assert.equal(read.answer, "A summary");
    assert.deepEqual(read.results, [{ title: "T", url: "https://a.com", content: "c" }]);
  });
});

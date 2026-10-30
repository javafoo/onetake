import assert from "node:assert/strict";
import { test } from "node:test";

import type { Content } from "@/ai/gemini";

import { applyDelta, budgetLeft, forBrowser, mergeAdjacent, openOffers, settleOffer, threadTitle, toContents, turnsSoFar, type ThreadState } from "./thread";
import type { Offer, ThreadMessage } from "./types";

const AT = "2026-10-06T09:00:00.000Z";
const her = (text: string, requestId = text): ThreadMessage => ({ role: "her", text, at: AT, requestId });
const agent = (text: string): ThreadMessage => ({ role: "agent", text, at: AT });
const tool = (name: string, result: unknown, thoughtSignature?: string): ThreadMessage => ({
  role: "tool",
  name,
  label: name,
  args: { q: name },
  result,
  at: AT,
  ...(thoughtSignature ? { thoughtSignature } : {}),
});
const OFFER: Offer = {
  id: "offer-1",
  label: "A photo: at a café",
  credits: 1,
  status: "open",
  request: { kind: "agent", requestId: "t:offer:offer-1", input: { kind: "agent", message: "x", request: { kind: "photos", brief: "café", count: 1, mode: "one" }, reply: "x" } },
};

const thread = (over: Partial<ThreadState> = {}): ThreadState => ({
  id: "t",
  avatarId: "a",
  title: null,
  messages: [],
  budgetCredits: 0,
  spentCredits: 0,
  offers: [],
  lastRequestId: null,
  ...over,
});

test("her words, the agent's words, and a tool call with its answer, in Gemini's shape", () => {
  const contents = toContents([her("hooks please"), agent("Looking."), tool("search_knowledge", { found: 2 }, "SIG"), agent("Here they are.")]);
  assert.deepEqual(contents, [
    { role: "user", parts: [{ text: "hooks please" }] },
    { role: "model", parts: [{ text: "Looking." }, { functionCall: { name: "search_knowledge", args: { q: "search_knowledge" } }, thoughtSignature: "SIG" }] },
    { role: "user", parts: [{ functionResponse: { name: "search_knowledge", response: { found: 2 } } }] },
    { role: "model", parts: [{ text: "Here they are." }] },
  ] satisfies Content[]);
});

test("two calls of one step come back as both calls, then both answers", () => {
  const contents = toContents([her("go"), tool("read_brand", { a: 1 }, "SIG"), tool("search_library", [1, 2])]);
  assert.equal(contents.length, 3);
  assert.deepEqual(contents[1].parts.map((part) => ("functionCall" in part ? part.functionCall.name : "?")), ["read_brand", "search_library"]);
  assert.deepEqual(contents[2].parts.map((part) => ("functionResponse" in part ? part.functionResponse.name : "?")), ["read_brand", "search_library"]);
  // A list answer is wrapped: Gemini wants an object.
  assert.deepEqual(contents[2].parts[1], { functionResponse: { name: "search_library", response: { result: [1, 2] } } });
});

test("a signed call starts a new step", () => {
  const contents = toContents([her("go"), tool("read_brand", {}, "S1"), tool("search_knowledge", {}, "S2")]);
  assert.deepEqual(contents.map((content) => content.role), ["user", "model", "user", "model", "user"]);
});

test("offers and jobs are short model notes", () => {
  const job: ThreadMessage = { role: "job", jobId: "j1", kind: "image", credits: 1, at: AT };
  const [, note, jobNote] = toContents([her("photo"), { role: "offer", offer: OFFER, at: AT }, job]).flatMap((content) => content.parts);
  assert.match(JSON.stringify(note), /Offered: A photo: at a café, 1 credits\. waiting for her tap/);
  assert.match(JSON.stringify(jobNote), /Started: image, 1 credits, job j1/);
});

test("attached library items reach the model by id", () => {
  const [content] = toContents([{ role: "her", text: "use these", at: AT, requestId: "r", material: { photos: ["p1", "p2"], clip: "c1" } }]);
  assert.match(JSON.stringify(content.parts), /photo ids p1, p2; clip id c1/);
});

test("past 60 messages the oldest fold into one note, and a step is never split", () => {
  const long: ThreadMessage[] = [];
  for (let i = 0; i < 40; i++) long.push(her(`ask ${i}`), agent(`answer ${i}`));
  const contents = toContents(long);
  assert.equal(contents[0].role, "model");
  assert.match(JSON.stringify(contents[0].parts), /Earlier in this chat, folded:[\s\S]*She said: ask 0[\s\S]*You said: answer 9/);
  assert.ok(!JSON.stringify(contents.slice(1)).includes("ask 9\""), "folded messages are not repeated");

  const withTools = [...long.slice(0, 19), tool("read_brand", {}, "S"), ...long.slice(19)];
  const folded = toContents(withTools, 60);
  const calls = folded.flatMap((content) => content.parts).filter((part) => "functionCall" in part).length;
  const answers = folded.flatMap((content) => content.parts).filter((part) => "functionResponse" in part).length;
  assert.equal(calls, answers);
});

test("mergeAdjacent never joins her words to tool answers", () => {
  const merged = mergeAdjacent([
    { role: "user", parts: [{ functionResponse: { name: "x", response: {} } }] },
    { role: "user", parts: [{ text: "next" }] },
  ]);
  assert.equal(merged.length, 2);
});

test("budget left, open offers, turns, titles", () => {
  assert.equal(budgetLeft({ budgetCredits: 10, spentCredits: 3 }), 7);
  assert.equal(budgetLeft({ budgetCredits: 2, spentCredits: 3 }), 0);
  assert.deepEqual(openOffers({ offers: [OFFER, { ...OFFER, id: "o2", status: "declined" }] }).map((offer) => offer.id), ["offer-1"]);
  assert.equal(turnsSoFar([her("a"), agent("b"), her("c")]), 2);
  assert.equal(threadTitle("Write me three hooks about slow mornings using the gap"), "Write me three hooks about slow…");
});

test("a delta lands on the newest thread: messages appended, offers once, spend added, budget set", () => {
  const base = thread({ messages: [her("a")], offers: [OFFER], spentCredits: 2 });
  const next = applyDelta(base, { messages: [agent("b")], offers: [OFFER, { ...OFFER, id: "o2" }], spent: 3, budget: 10, title: "a" });
  assert.equal(next.messages.length, 2);
  assert.deepEqual(next.offers.map((offer) => offer.id), ["offer-1", "o2"]);
  assert.equal(next.spentCredits, 5);
  assert.equal(next.budgetCredits, 10);
  assert.equal(next.title, "a");
  assert.equal(applyDelta({ ...base, title: "kept" }, { messages: [], offers: [], spent: 0, title: "new" }).title, "kept");
});

test("settling an offer marks both copies and places its job once, right after it", () => {
  const base = thread({ messages: [her("a"), { role: "offer", offer: OFFER, at: AT }, agent("tap it")], offers: [OFFER] });
  const job: Extract<ThreadMessage, { role: "job" }> = { role: "job", jobId: "j1", kind: "image", credits: 1, at: AT };
  const once = settleOffer(base, "offer-1", "accepted", job);
  const twice = settleOffer(once, "offer-1", "accepted", job);
  assert.equal(twice.offers[0].status, "accepted");
  assert.deepEqual(twice.messages.map((message) => message.role), ["her", "offer", "job", "agent"]);
  assert.equal((twice.messages[1] as Extract<ThreadMessage, { role: "offer" }>).offer.status, "accepted");
});

test("the browser gets tool labels only, and no stored job request", () => {
  const shown = forBrowser([tool("search_knowledge", { chunks: ["SECRET PLAYBOOK"] }, "SIG"), { role: "offer", offer: OFFER, at: AT }]);
  const text = JSON.stringify(shown);
  assert.ok(!text.includes("SECRET PLAYBOOK"));
  assert.ok(!text.includes("SIG"));
  assert.ok(!text.includes("requestId"));
  assert.equal((shown[0] as Extract<ThreadMessage, { role: "tool" }>).label, "search_knowledge");
});

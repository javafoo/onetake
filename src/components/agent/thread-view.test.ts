import assert from "node:assert/strict";
import { test } from "node:test";

import type { ThreadMessage } from "@/agent/v2/types";

import type { AgentView } from "@/agent/view";

import { agentJobStatus, applyEvent, jobPollUrl, settleOffer, threadCards, threadTitle, waitingForWords, withHerMessage, type ThreadCard } from "./thread-view";

const at = "2026-10-06T10:00:00.000Z";
const request = { kind: "image" as const, requestId: "r", input: { kind: "image" } } as unknown as Extract<ThreadMessage, { role: "offer" }>["offer"]["request"];

test("a stored thread groups everything after her message into one card, in order", () => {
  const messages: ThreadMessage[] = [
    { role: "her", text: "Make me a photo at a café", at, requestId: "q1", material: { photos: ["p1", "p2"] } },
    { role: "tool", name: "search_knowledge", label: "Searching the playbooks", args: {}, result: {}, at },
    { role: "tool", name: "search_library", label: "Reading your library", args: {}, result: {}, at },
    { role: "agent", text: "Here is the idea.", at },
    { role: "offer", offer: { id: "o1", label: "A photo at a café", credits: 1, request, status: "accepted" }, at },
    { role: "job", jobId: "j1", kind: "image", credits: 1, at },
    { role: "agent", text: "Started.", at },
    { role: "her", text: "Thanks", at, requestId: "q2" },
    { role: "agent", text: "Any time.", at },
  ];
  const cards = threadCards(messages);
  assert.equal(cards.length, 4);
  assert.deepEqual(cards[0], { kind: "her", key: "q1", text: "Make me a photo at a café", photos: 2, clip: false, screenshots: 0 });
  assert.equal(cards[1].kind, "turn");
  assert.deepEqual(cards[1].kind === "turn" && cards[1].parts, [
    { kind: "tools", labels: ["Searching the playbooks", "Reading your library"] },
    { kind: "text", text: "Here is the idea." },
    { kind: "offer", offer: { id: "o1", label: "A photo at a café", credits: 1, status: "accepted" } },
    { kind: "job", job: { jobId: "j1", kind: "image", credits: 1 } },
    { kind: "text", text: "Started." },
  ]);
  assert.deepEqual(cards[3].kind === "turn" && cards[3].parts, [{ kind: "text", text: "Any time." }]);
});

test("the offer's job request never reaches the cards", () => {
  const cards = threadCards([{ role: "offer", offer: { id: "o", label: "x", credits: 2, request, status: "open" }, at }]);
  const part = cards[0].kind === "turn" ? cards[0].parts[0] : null;
  assert.ok(part && part.kind === "offer");
  assert.equal("request" in part.offer, false);
});

test("two stored replies in a row read as two paragraphs", () => {
  const cards = threadCards([
    { role: "agent", text: "One.", at },
    { role: "agent", text: "Two.", at },
  ]);
  assert.deepEqual(cards[0].kind === "turn" && cards[0].parts, [{ kind: "text", text: "One.\n\nTwo." }]);
});

test("a streamed turn builds the same card as it arrives", () => {
  let cards: ThreadCard[] = withHerMessage([], "q", "Hooks please", { photos: 0, clip: false, screenshots: 0 });
  assert.equal(waitingForWords(cards), true);
  cards = applyEvent(cards, { type: "tool", label: "Searching the playbooks" }, "t");
  cards = applyEvent(cards, { type: "tool", label: "Reading your brand" }, "t");
  assert.equal(waitingForWords(cards), true);
  cards = applyEvent(cards, { type: "text", delta: "Here " }, "t");
  cards = applyEvent(cards, { type: "text", delta: "are three." }, "t");
  assert.equal(waitingForWords(cards), false);
  cards = applyEvent(cards, { type: "offer", offer: { id: "o", label: "A reel", credits: 7, status: "open" } }, "t");
  cards = applyEvent(cards, { type: "fact", text: "Remembered: she posts at 7am" }, "t");
  cards = applyEvent(cards, { type: "error", message: "Stopped." }, "t");
  cards = applyEvent(cards, { type: "done", threadId: "th" }, "t");
  assert.equal(cards.length, 2);
  assert.deepEqual(cards[1], {
    kind: "turn",
    key: "t",
    parts: [
      { kind: "tools", labels: ["Searching the playbooks", "Reading your brand"] },
      { kind: "text", text: "Here are three." },
      { kind: "offer", offer: { id: "o", label: "A reel", credits: 7, status: "open" } },
      { kind: "fact", text: "she posts at 7am" },
      { kind: "error", message: "Stopped." },
    ],
  });
});

test("an accepted offer gets its job right after it, once", () => {
  let cards: ThreadCard[] = applyEvent([], { type: "offer", offer: { id: "o", label: "A photo", credits: 1, status: "open" } }, "t");
  cards = applyEvent(cards, { type: "text", delta: "Tap to make it." }, "t");
  const job = { jobId: "j", kind: "image", credits: 1 };
  cards = settleOffer(cards, "o", "accepted", job);
  cards = settleOffer(cards, "o", "accepted", job);
  assert.deepEqual(cards[0].kind === "turn" && cards[0].parts, [
    { kind: "offer", offer: { id: "o", label: "A photo", credits: 1, status: "accepted" } },
    { kind: "job", job },
    { kind: "text", text: "Tap to make it." },
  ]);
  const declined = settleOffer(applyEvent([], { type: "offer", offer: { id: "x", label: "A clip", credits: 5, status: "open" } }, "t"), "x", "declined");
  assert.deepEqual(declined[0].kind === "turn" && declined[0].parts, [{ kind: "offer", offer: { id: "x", label: "A clip", credits: 5, status: "declined" } }]);
});

test("a thread title is her first message on one line, at most 40 characters", () => {
  assert.equal(threadTitle("  Short one\n"), "Short one");
  assert.equal(threadTitle(""), "New chat");
  const long = threadTitle("Write me three hooks about slow mornings using the curiosity gap");
  assert.ok(long.length <= 40, long);
  assert.equal(long, "Write me three hooks about slow…");
  const noSpaces = threadTitle("x".repeat(60));
  assert.equal(noSpaces.length, 40);
});

test("a job card asks an agent run through the agent poll and a day of stories through the job poll", () => {
  assert.equal(jobPollUrl({ jobId: "j1", kind: "image" }), "/api/agent/j1");
  assert.equal(jobPollUrl({ jobId: "j2", kind: "carousel" }), "/api/agent/j2");
  assert.equal(jobPollUrl({ jobId: "j3", kind: "stories" }), "/api/jobs/j3");
});

test("a job's draft rides on its card, from a stored thread and from the stream", () => {
  const stored = threadCards([{ role: "job", jobId: "j1", kind: "stories", credits: 0, at, draftId: "d1" }]);
  assert.deepEqual(stored[0].kind === "turn" && stored[0].parts[0], { kind: "job", job: { jobId: "j1", kind: "stories", credits: 0, draftId: "d1" } });
  const streamed = applyEvent([], { type: "job", jobId: "j2", kind: "carousel", credits: 0 }, "k");
  assert.deepEqual(streamed[0].kind === "turn" && streamed[0].parts[0], { kind: "job", job: { jobId: "j2", kind: "carousel", credits: 0 } });
});

test("a finished agent run reads as a job status with its draft, so the set can be hearted", () => {
  const view = {
    id: "run1",
    status: "completed",
    error: null,
    createdAt: at,
    updatedAt: at,
    mediaIds: ["s1", "s2"],
    creditsSpent: 0,
    estimatedCredits: 0,
    summary: "Your set is ready.",
    draftId: "d9",
  } as unknown as AgentView;
  const status = agentJobStatus(view, "carousel");
  assert.equal(status.kind, "carousel");
  assert.equal(status.draftId, "d9");
  assert.deepEqual(status.mediaIds, ["s1", "s2"]);
  assert.equal(status.message, "Your set is ready.");
  assert.equal(agentJobStatus({ ...view, status: "running", summary: null } as AgentView, "carousel").message, null);
});

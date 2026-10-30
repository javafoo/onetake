import assert from "node:assert/strict";
import { test } from "node:test";

import type { TurnEvent } from "@/agent/v2/types";

import { createTurnParser, parseTurnEvent, readTurnStream } from "./turn-stream";

const line = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`;

test("each well-formed event type is read back as it was sent", () => {
  const events: TurnEvent[] = [
    { type: "tool", label: "Searching the playbooks" },
    { type: "text", delta: "Here is one " },
    { type: "offer", offer: { id: "o1", label: "A photo at a café", credits: 1, status: "open" } },
    { type: "job", jobId: "j1", kind: "image", credits: 1 },
    { type: "fact", text: "Remembered: she films on Sundays" },
    { type: "error", message: "That did not work." },
    { type: "done", threadId: "t1" },
  ];
  const parser = createTurnParser();
  assert.deepEqual(parser.push(events.map(line).join("")), events);
  assert.deepEqual(parser.end(), []);
});

test("an event split across chunks waits for its newline", () => {
  const parser = createTurnParser();
  const whole = line({ type: "text", delta: "café, ünïcode" });
  assert.deepEqual(parser.push(whole.slice(0, 9)), []);
  assert.deepEqual(parser.push(whole.slice(9, 20)), []);
  assert.deepEqual(parser.push(whole.slice(20)), [{ type: "text", delta: "café, ünïcode" }]);
});

test("CRLF line ends, comments, other fields and blank lines are handled", () => {
  const parser = createTurnParser();
  const text = `: keep-alive\r\nevent: turn\r\nid: 4\r\ndata:{"type":"tool","label":"Reading your library"}\r\n\r\n`;
  assert.deepEqual(parser.push(text), [{ type: "tool", label: "Reading your library" }]);
});

test("a last line with no newline is read when the stream ends", () => {
  const parser = createTurnParser();
  assert.deepEqual(parser.push(`data: {"type":"done","threadId":"t9"}`), []);
  assert.deepEqual(parser.end(), [{ type: "done", threadId: "t9" }]);
  assert.deepEqual(parser.end(), []);
});

test("malformed and unknown payloads are dropped, never shown", () => {
  assert.equal(parseTurnEvent("{not json"), null);
  assert.equal(parseTurnEvent("null"), null);
  assert.equal(parseTurnEvent(`"text"`), null);
  assert.equal(parseTurnEvent(`{"type":"shout","text":"hi"}`), null);
  assert.equal(parseTurnEvent(`{"type":"text"}`), null);
  assert.equal(parseTurnEvent(`{"type":"text","delta":5}`), null);
  assert.equal(parseTurnEvent(`{"type":"job","jobId":"j","kind":"image","credits":-1}`), null);
  assert.equal(parseTurnEvent(`{"type":"offer","offer":{"id":"o","label":"x"}}`), null);
  assert.equal(parseTurnEvent(`{"type":"done"}`), null);
});

test("an offer keeps only what the button needs", () => {
  const event = parseTurnEvent(JSON.stringify({ type: "offer", offer: { id: "o", label: "A reel", credits: 7, status: "weird", request: { kind: "reel" } } }));
  assert.deepEqual(event, { type: "offer", offer: { id: "o", label: "A reel", credits: 7, status: "open" } });
});

test("readTurnStream decodes bytes split inside a character and reports done", async () => {
  const bytes = new TextEncoder().encode(line({ type: "text", delta: "naïve" }) + line({ type: "done", threadId: "t" }));
  const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "ï"
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, cut));
      controller.enqueue(bytes.slice(cut));
      controller.close();
    },
  });
  const seen: TurnEvent[] = [];
  const done = await readTurnStream(body, (event) => seen.push(event));
  assert.equal(done, true);
  assert.deepEqual(seen, [
    { type: "text", delta: "naïve" },
    { type: "done", threadId: "t" },
  ]);
});

test("readTurnStream says so when the stream stopped before done", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(line({ type: "text", delta: "Half" })));
      controller.close();
    },
  });
  assert.equal(await readTurnStream(body, () => {}), false);
});

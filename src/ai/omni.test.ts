import assert from "node:assert/strict";
import { test } from "node:test";

import { creditsFor } from "../billing/pricing";

import { CLIP_ENDPOINT, clipPriceUsd, clipProviderOf, clipSeconds } from "./clips";
import { OMNI_MODEL, omniCostUsd, omniPriceUsd, omniRequestBody, omniState } from "./omni";

/* The usage block of the live 4-second, 720p test clip on 2026-09-25, trimmed
   to the fields we read. */
const MEASURED = {
  total_input_tokens: 1140,
  total_output_tokens: 23657,
  total_thought_tokens: 210,
  output_tokens_by_modality: [{ modality: "video", tokens: 23168 }],
};

test("Omni's reserved price covers what the live clip actually cost", () => {
  const actual = omniCostUsd(MEASURED);
  assert.ok(actual !== undefined && Math.abs(actual - 0.4135) < 0.001, `measured $${actual}`);
  assert.ok(omniPriceUsd(4) >= actual, `reserved $${omniPriceUsd(4)} under the measured $${actual}`);
  assert.equal(omniCostUsd(undefined), undefined, "no counts keeps the reservation");
});

test("the pricing table and the client charge Omni the same", () => {
  for (const seconds of [3, 5, 8, 10]) {
    const held = clipPriceUsd(CLIP_ENDPOINT.omni, seconds);
    assert.ok(held !== undefined && Math.abs(held - omniPriceUsd(seconds)) < 1e-9);
  }
  // Four credits for five seconds, six for the eight a talking reel runs to, seven for Omni's ten.
  assert.equal(creditsFor({ kind: "clip", model: "omni", seconds: 5 }), 4);
  assert.equal(creditsFor({ kind: "clip", model: "omni", seconds: 8 }), 6);
  assert.equal(creditsFor({ kind: "clip", model: "omni", seconds: 10 }), 7);
});

test("Omni is Google's, clamped to three to ten seconds", () => {
  assert.equal(CLIP_ENDPOINT.omni, OMNI_MODEL);
  assert.equal(clipProviderOf("omni"), "google");
  assert.equal(clipSeconds(12, "omni"), 10);
  assert.equal(clipSeconds(1, "omni"), 3);
});

/* The shape the live test was accepted in: duration as "<n>s" (the API reads
   a protobuf duration and refuses "abc"), the photo tagged as the first frame. */
test("the request asks for 720p at the given shape and length, from the photo", () => {
  const body = omniRequestBody({ prompt: "She says hello.", imageBase64: "AAAA", seconds: 8, aspectRatio: "9:16" });
  assert.equal(body.model, "gemini-omni-1.1-flash");
  assert.equal(body.background, true);
  assert.deepEqual(body.response_format, { type: "video", duration: "8s", resolution: "720p", aspect_ratio: "9:16" });
  const [image, text] = body.input as { type: string; data?: string; text?: string }[];
  assert.equal(image.type, "image");
  assert.equal(image.data, "AAAA");
  assert.equal(text.text, "<FIRST_FRAME> She says hello.");
});

test("Google's statuses read as the job runner's", () => {
  assert.deepEqual(omniState({ id: "v1_a", status: "in_progress" }), { state: "pending", status: "in_progress" });
  const done = omniState({
    id: "v1_a",
    status: "completed",
    steps: [{ type: "model_output", content: [{ type: "video", mime_type: "video/mp4", data: "AAAA" }] }],
  });
  assert.equal(done.state, "completed");

  // Finished with nothing in it is how a blocked prompt comes back: a failure, not a clip.
  const empty = omniState({ id: "v1_a", status: "completed", steps: [] });
  assert.equal(empty.state, "failed");
  const cancelled = omniState({ id: "v1_a", status: "cancelled" });
  assert.equal(cancelled.state === "failed" ? cancelled.status : null, "canceled");
});

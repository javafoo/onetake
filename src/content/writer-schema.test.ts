import assert from "node:assert/strict";
import { test } from "node:test";

import { schemaFor } from "./hooks";

const required = (schema: ReturnType<typeof schemaFor>) => (schema.properties.posts.items as { required: string[] }).required;

test("a talking reel asks for its spoken line, with or without a scene", () => {
  assert.ok(required(schemaFor({ format: "talking" })).includes("spoken"));
  assert.ok(required(schemaFor({ format: "talking", visual: true })).includes("spoken"));
  assert.ok(required(schemaFor({ format: "talking", visual: true })).includes("visual"));
  assert.ok(!required(schemaFor({ format: "talking" })).includes("visual"));
});

test("a plain post asks for neither", () => {
  assert.ok(!required(schemaFor({})).includes("spoken"));
  assert.ok(!required(schemaFor({})).includes("visual"));
});

test("a cut spoken line ends on its last full sentence", async () => {
  const { toSentenceEnd } = await import("./hooks");
  assert.equal(toSentenceEnd("I doubled her calls. Here is how. It costs"), "I doubled her calls. Here is how.");
  assert.equal(toSentenceEnd("Short. and then a very long run of words with no end at all here"), "Short. and then a very long run of words with no end at all here");
});

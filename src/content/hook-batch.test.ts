import assert from "node:assert/strict";
import { test } from "node:test";

import { writerProfile } from "./brand-scope";
import { batchOptions, hookCount } from "./hook-batch";
import { writerPrompt, type BrandProfile } from "./hooks";
import type { WriterContextDeps } from "./writer-context";

/* How many hooks one press writes: one to ten, and five when the form sends
   nothing usable, as the Hooks page always did. */

test("a batch is between one and ten hooks, five by default", () => {
  assert.equal(hookCount(3), 3);
  assert.equal(hookCount("7"), 7);
  assert.equal(hookCount(0), 5, "zero is nothing usable");
  assert.equal(hookCount(""), 5);
  assert.equal(hookCount("many"), 5);
  assert.equal(hookCount(undefined), 5);
  assert.equal(hookCount(-4), 1);
  assert.equal(hookCount(50), 10);
});

/* The batch's writer sees what the agent remembers about her. Memory is
   injected, so this needs no network or database. */

const PROFILE: BrandProfile = {
  personaName: "Mia",
  story: "I posted for a year to nobody.",
  niche: "Faceless Instagram",
  audience: "Women who hate being on camera",
  offer: "The 7-day starter kit",
  keyword: "AVATAR",
  voice: "Warm, direct",
  proofPoints: [],
};

function fakes(overrides: Partial<WriterContextDeps> = {}) {
  const logged: string[] = [];
  const deps: WriterContextDeps = {
    facts: async () => ["She lives in Lisbon."],
    log: (where) => void logged.push(where),
    ...overrides,
  };
  return { deps, logged };
}

test("the batch's writer prompt carries her memory after the profile lines", async () => {
  const { deps } = fakes();
  const options = await batchOptions("user_1", "avatar_1", PROFILE, { brand: true, brief: "" }, deps);
  const { prompt } = writerPrompt(PROFILE, 5, options);
  assert.ok(prompt.includes("Remembered: She lives in Lisbon."));
  assert.ok(prompt.indexOf("Voice: Warm, direct") < prompt.indexOf("Remembered:"), "after the profile lines");
});

test("a topic is still the brief", async () => {
  const { deps } = fakes();
  const options = await batchOptions("user_1", "avatar_1", PROFILE, { brand: true, brief: "slow mornings" }, deps);
  assert.equal(options.brief, "slow mornings");
});

test("brand off: no memory", async () => {
  let factsAsked = false;
  const { deps } = fakes({ facts: async () => ((factsAsked = true), ["She lives in Lisbon."]) });
  const off = writerProfile(PROFILE, false);
  const options = await batchOptions("user_1", "avatar_1", off, { brand: false, brief: "" }, deps);
  const { prompt } = writerPrompt(off, 5, options);
  assert.ok(!prompt.includes("Lisbon"));
  assert.equal(factsAsked, false);
});

test("a memory read that fails is logged and the hooks are written without it", async () => {
  const { deps, logged } = fakes({ facts: async () => { throw new Error("db down"); } });
  const options = await batchOptions("user_1", "avatar_1", PROFILE, { brand: true, brief: "" }, deps);
  assert.deepEqual(options, {});
  assert.equal(writerPrompt(PROFILE, 5, options).prompt, writerPrompt(PROFILE, 5).prompt);
  assert.deepEqual(logged, ["writerContext.memory"]);
});

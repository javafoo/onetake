import assert from "node:assert/strict";
import { test } from "node:test";

import { setupComplete, setupSteps } from "./setup";

const nothing = { profileComplete: false, references: 0, clips: 0, drafts: 0, assembled: 0 };
const everything = { profileComplete: true, keyword: "KIT", references: 3, clips: 2, images: 9, drafts: 4, assembled: 2 };

test("a new account has four steps to do, in the order she meets them", () => {
  const steps = setupSteps(nothing);
  assert.deepEqual(
    steps.map((step) => step.href),
    ["/brand", "/avatar", "/library", "/create"],
  );
  assert.ok(steps.every((step) => !step.done));
  assert.equal(setupComplete(steps), false);
});

test("setup is complete only when every step is done", () => {
  assert.equal(setupComplete(setupSteps(everything)), true);
  assert.equal(setupComplete(setupSteps({ ...everything, assembled: 0 })), false, "a first finished post is the last step");
});

test("the status lines use her own numbers", () => {
  const steps = setupSteps(everything);
  assert.equal(steps[0].status, "Keyword KIT");
  assert.equal(steps[2].status, "2 clips · 9 photos");
  assert.equal(setupSteps({ ...everything, images: undefined })[2].status, "2 clips", "photos are only counted where they were loaded");
  assert.equal(steps[3].status, "4 drafts · 2 reels");
});

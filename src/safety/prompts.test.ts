import assert from "node:assert/strict";
import { test } from "node:test";

/* The screening rubric must not reach a browser: somebody who can read
   "answer true if you are unsure" can write a photograph that answers false.
   `server-only` is what enforces that, and this is the test that it is still
   there — an import outside a server bundle has to fail. */
test("the screening prompts cannot be imported outside a server bundle", async () => {
  await assert.rejects(
    () => import("./screen"),
    /only be used from a Server Component/,
    "src/safety/screen.ts must keep its `import \"server-only\"`",
  );
});

test("the decisions can be imported anywhere, because they are not the rubric", async () => {
  const decisions = await import("./verdict");
  assert.equal(typeof decisions.verdictFromPhoto, "function");
});

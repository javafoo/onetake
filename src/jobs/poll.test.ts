import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { memoryStore, type MemoryBillingStore } from "@/billing/store.memory";

import { startJob, type JobDeps, type JobUser } from ".";
import { pollAgent, pollJob } from "./poll";
import type { JobProviders } from "./providers";
import { memoryJobStore, type MemoryJobStore } from "./store.memory";

/* The polls, apart from the routes: scoped to the account asking, so another
   account's id is not found, and the agent poll answers only for a run. */

const USER_ID = "user_poll_test";
const user: JobUser = { id: USER_ID };

let billing: MemoryBillingStore;
let jobs: MemoryJobStore;

function deps(): Partial<JobDeps> {
  return { store: jobs, credits: billing.credits, providers: {} as JobProviders, schedule: () => undefined, budgetUsd: () => 25, limits: async () => {} };
}

beforeEach(() => {
  billing = memoryStore();
  jobs = memoryJobStore(() => billing.rows);
});

async function textPhoto(): Promise<string> {
  const job = await startJob(user, { kind: "text_photo", requestId: "req_poll", input: { kind: "text_photo", photoMediaId: "p1", text: "Hello", style: "bold" } }, deps());
  return job.id;
}

test("pollJob answers with the job for its owner and null for anyone else", async () => {
  const id = await textPhoto();
  const view = await pollJob(USER_ID, id, deps());
  assert.equal(view?.id, id);
  assert.equal(await pollJob("user_someone_else", id, deps()), null);
  assert.equal(await pollJob(USER_ID, "00000000-0000-4000-8000-000000000000", deps()), null);
});

test("pollJob hands back a failed job as failed, with nothing to return when it was not the free photo", async () => {
  const id = await textPhoto();
  await jobs.transition({ userId: USER_ID, jobId: id, from: ["queued"], patch: { status: "failed", error: "It broke." } });
  const view = await pollJob(USER_ID, id, deps());
  assert.equal(view?.status, "failed");
});

test("pollAgent answers only for a run", async () => {
  const id = await textPhoto();
  assert.equal(await pollAgent(USER_ID, id, deps()), null);
});

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { childRequestId } from "@/agent/plan";

import { STUCK_AFTER_MS } from ".";
import { POLL_DRIVEN } from "./runner";
import {
  SWEEP_BUDGET_MS,
  SWEEP_IDLE_MS,
  SWEPT_WHEN_IDLE,
  SWEPT_WHEN_STUCK,
  isDue,
  isTopLevel,
  runSweep,
  sweepPoll,
  type SweepRow,
} from "./sweep";
import type { JobKind } from "./types";

/* The sweep's rules and its loop, apart from the database and the route:
   which poll each kind gets, which jobs are top level, when a row is due,
   and that one bad row or the clock running out never costs the others. */

const RUN = "0f0e0d0c-0b0a-4000-8000-000000000001";
const ALL_KINDS: JobKind[] = ["image", "clip", "reel", "carousel", "agent", "text_photo", "week"];

describe("which poll", () => {
  test("each kind gets the poll the app's own screen uses for it", () => {
    assert.equal(sweepPoll("agent"), "agent");
    assert.equal(sweepPoll("week"), "week");
    for (const kind of ["clip", "image", "reel", "carousel", "text_photo"] as const) assert.equal(sweepPoll(kind), "job", kind);
  });

  test("every kind the sweep takes has a poll, and every poll-driven kind is taken as soon as it is idle", () => {
    for (const kind of [...SWEPT_WHEN_IDLE, ...SWEPT_WHEN_STUCK]) assert.notEqual(sweepPoll(kind), null, kind);
    assert.deepEqual([...POLL_DRIVEN].sort(), [...SWEPT_WHEN_IDLE].sort());
    // Every kind is in exactly one list.
    for (const kind of ALL_KINDS) {
      const lists = Number(SWEPT_WHEN_IDLE.includes(kind)) + Number(SWEPT_WHEN_STUCK.includes(kind));
      assert.equal(lists, 1, kind);
    }
  });
});

describe("top level", () => {
  test("a job she started, with the client's own request id, is top level", () => {
    for (const kind of ALL_KINDS) assert.equal(isTopLevel(kind, "6f1f7a4e-9d8b-4a55-8f5c-2c1d6e7f8a9b"), true, kind);
  });

  test("a run's children are not: their parent polls them", () => {
    assert.equal(isTopLevel("image", childRequestId(RUN, "photo")), false);
    assert.equal(isTopLevel("clip", childRequestId(RUN, "clip")), false);
    assert.equal(isTopLevel("reel", childRequestId(RUN, "reel")), false);
    assert.equal(isTopLevel("agent", `${RUN}:make`), false);
  });
});

describe("when a row is due", () => {
  const now = new Date("2026-09-29T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  test("a poll-driven job left for a minute is due, and a fresher one is not", () => {
    for (const kind of SWEPT_WHEN_IDLE) {
      assert.equal(isDue(kind, ago(SWEEP_IDLE_MS + 1), now), true, kind);
      assert.equal(isDue(kind, ago(SWEEP_IDLE_MS - 1_000), now), false, kind);
    }
  });

  test("a job that runs in one go is due only once a poll would write it off", () => {
    for (const kind of SWEPT_WHEN_STUCK) {
      assert.equal(isDue(kind, ago(SWEEP_IDLE_MS * 5), now), false, kind);
      assert.equal(isDue(kind, ago(STUCK_AFTER_MS + 1), now), true, kind);
    }
  });
});

describe("the loop", () => {
  const rows: SweepRow[] = Array.from({ length: 7 }, (_, index) => ({ userId: `user_${index % 3}`, jobId: `job_${index}`, kind: "agent" }));

  test("polls every row once, each as its own user, and counts what it found", async () => {
    const seen: string[] = [];
    const summary = await runSweep(rows, {
      poll: async (row) => {
        seen.push(`${row.userId}/${row.jobId}`);
        return row.jobId !== "job_3";
      },
      failed: () => assert.fail("nothing failed"),
      clock: () => 0,
    });
    assert.deepEqual(seen.sort(), rows.map((row) => `${row.userId}/${row.jobId}`).sort());
    assert.deepEqual(summary, { found: 7, polled: 6, gone: 1, errors: 0, skipped: 0 });
  });

  test("a row that throws is counted and handed on, and the rest are still polled", async () => {
    const failed: string[] = [];
    const polled: string[] = [];
    const summary = await runSweep(rows, {
      poll: async (row) => {
        if (row.jobId === "job_0" || row.jobId === "job_4") throw new Error("the provider is down");
        polled.push(row.jobId);
        return true;
      },
      failed: (row) => failed.push(row.jobId),
      clock: () => 0,
    });
    assert.deepEqual(failed.sort(), ["job_0", "job_4"]);
    assert.equal(polled.length, 5);
    assert.deepEqual(summary, { found: 7, polled: 5, gone: 0, errors: 2, skipped: 0 });
  });

  test("never more than the concurrency at once", async () => {
    let running = 0;
    let most = 0;
    await runSweep(rows, {
      poll: async () => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
        return true;
      },
      failed: () => undefined,
      clock: () => 0,
      concurrency: 3,
    });
    assert.equal(most, 3);
  });

  test("no new row is started once the time is up; those are left for the next run", async () => {
    let now = 0;
    const summary = await runSweep(rows, {
      poll: async () => {
        now += SWEEP_BUDGET_MS / 3;
        return true;
      },
      failed: () => undefined,
      clock: () => now,
      concurrency: 1,
    });
    assert.deepEqual(summary, { found: 7, polled: 3, gone: 0, errors: 0, skipped: 4 });
  });

  test("nothing to do is a quick, empty answer", async () => {
    assert.deepEqual(await runSweep([], { poll: async () => assert.fail("no rows"), failed: () => undefined, clock: () => 0 }), {
      found: 0,
      polled: 0,
      gone: 0,
      errors: 0,
      skipped: 0,
    });
  });
});

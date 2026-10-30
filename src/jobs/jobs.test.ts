/* The job state machine, against fake providers and an in-memory ledger.
 *
 * Everything that would cost money or take minutes is a fake here, so these
 * run offline in milliseconds. What they prove is the list of promises at the
 * top of `src/jobs/index.ts`: charge once, refund on failure, never store two
 * outputs, never leave a job behind that could not be paid for, never let a
 * dead job hold credits, and stop when the day's budget is gone.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { ClipState } from "@/ai/clips";
import { creditsFor } from "@/billing/pricing";
import { DEFAULT_IMAGE_MODEL } from "@/content/image-options";
import { memoryStore, type MemoryBillingStore } from "@/billing/store.memory";

import {
  advanceJob,
  BudgetExceededError,
  getJob,
  NotEnoughCreditsError,
  startJob,
  stopJob,
  STUCK_AFTER_MS,
  type JobDeps,
  type JobUser,
} from ".";
import type { JobProviders, StepOutcome, SubmittedClip } from "./providers";
import { CLIP_DEADLINE_MS, CLIP_PENDING_DEADLINE_MS } from "./runner";
import { jobModelEstimateUsd } from "@/ai/estimates";

import { memoryJobStore, type MemoryJobStore } from "./store.memory";
import { ONBOARDING_FREEBIE, type CarouselJobInput, type JobRecord } from "./types";

/* ------------------------------------------------------------------ */
/* Fake providers                                                      */
/* ------------------------------------------------------------------ */

type StepName = "generateImage" | "submitClip" | "clipStatus" | "storeClip" | "assembleReel" | "renderCarousel" | "renderTextPhoto";

interface Fakes {
  providers: JobProviders;
  calls: Record<StepName, number>;
  discarded: string[];
  /** What the next `clipStatus` answers. Change it to drive the clip forward. */
  clip: ClipState;
  /** Make the next call of a step throw with this message. */
  failNext: Partial<Record<StepName, string>>;
  /** Hold a step open, so a second poll can be let in while the first is inside it. */
  hold?: { step: StepName; promise: Promise<void> };
}

function fakeProviders(): Fakes {
  const state: Fakes = {
    providers: null as unknown as JobProviders,
    calls: { generateImage: 0, submitClip: 0, clipStatus: 0, storeClip: 0, assembleReel: 0, renderCarousel: 0, renderTextPhoto: 0 },
    discarded: [],
    clip: { state: "pending", status: "queued" },
    failNext: {},
  };
  let media = 0;

  async function enter(step: StepName): Promise<void> {
    state.calls[step]++;
    /* The hold comes first so a test can arrange the interesting order: a step
       held open, the world changing underneath it, and only then the failure. */
    if (state.hold?.step === step) await state.hold.promise;
    const message = state.failNext[step];
    if (message) {
      delete state.failNext[step];
      throw new Error(message);
    }
  }

  const outcome = (costUsd: number): StepOutcome => ({ mediaIds: [`media_${++media}`], message: "Done.", costUsd });

  state.providers = {
    async generateImage(): Promise<StepOutcome> {
      await enter("generateImage");
      return outcome(0.134);
    },
    async submitClip(): Promise<SubmittedClip> {
      await enter("submitClip");
      return { provider: "google", requestId: "req_1", statusUrl: "https://example.invalid/req_1", costUsd: 0.42 };
    },
    async clipStatus(): Promise<ClipState> {
      await enter("clipStatus");
      return state.clip;
    },
    async storeClip(): Promise<StepOutcome> {
      await enter("storeClip");
      return outcome(0.42);
    },
    async assembleReel(): Promise<StepOutcome> {
      await enter("assembleReel");
      return outcome(0);
    },
    async renderCarousel(): Promise<StepOutcome> {
      await enter("renderCarousel");
      return outcome(0);
    },
    async renderTextPhoto(): Promise<StepOutcome> {
      await enter("renderTextPhoto");
      return outcome(0);
    },
    async discardMedia(_userId, mediaIds) {
      state.discarded.push(...mediaIds);
    },
  };

  return state;
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

const USER_ID = "user_test";

/* The prices these expect. Read from `pricing.ts` rather than copied out of
   it: this file is about the job machine, and a re-pricing should not be able
   to fail thirty tests that are not about money. What the numbers actually are
   is pinned in `src/billing/pricing.test.ts`, which is the file to change when
   they change.
     image, pro  $0.134      -> ceil(0.134 * 3 / 0.45) = 1 credit
     clip, 5s    $0.084 * 5  -> ceil(0.420 * 3 / 0.45) = 3 credits
     reel                    ->                          0 credits */
const IMAGE_CREDITS = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });
const CLIP_CREDITS = creditsFor({ kind: "clip", model: "omni", seconds: 5 });

let billing: MemoryBillingStore;
let jobs: MemoryJobStore;
let provider: Fakes;
let scheduled: Array<() => Promise<void>>;
let clock: Date;
/** What the rate limiter was asked for, and what it should answer. */
let limited: { asked: string[]; refuse?: Error };

function deps(overrides: Partial<JobDeps> = {}): Partial<JobDeps> {
  return {
    store: jobs,
    credits: billing.credits,
    providers: provider.providers,
    // Nothing runs by itself: a test decides when `after()` would have fired.
    schedule: (task) => void scheduled.push(task),
    now: () => clock,
    budgetUsd: () => 25,
    limits: async (_user, name) => {
      limited.asked.push(name);
      if (limited.refuse) throw limited.refuse;
    },
    ...overrides,
  };
}

/** Run whatever `after()` would have run, the way the platform eventually does. */
async function drain(): Promise<void> {
  while (scheduled.length) await scheduled.shift()!();
}

function user(overrides: Partial<JobUser> = {}): JobUser {
  return { id: USER_ID, ...overrides };
}

function seedCredits(amount: number): void {
  billing.seedLedger({ userId: USER_ID, delta: amount, reason: "adjustment" });
}

const balance = () => billing.credits.balance(USER_ID);
const ledgerRows = (reason: string) => billing.rows.filter((row) => row.reason === reason);

const IMAGE = { kind: "image", idea: "at her kitchen table with coffee", shot: "selfie", aspect: "4:5" } as const;
/** The one free photo. `freebie` is what makes it free; everything else is an ordinary image job. */
const FREE_IMAGE = { ...IMAGE, freebie: ONBOARDING_FREEBIE, maxTakes: 1 } as const;
const CLIP = { kind: "clip", imageMediaId: "11111111-1111-4111-8111-111111111111", motion: "she blinks", seconds: 5 } as const;
const REEL = { kind: "reel", draftId: "22222222-2222-4222-8222-222222222222", clipMediaId: "33333333-3333-4333-8333-333333333333" } as const;
const CAROUSEL: CarouselJobInput = {
  kind: "carousel",
  draftId: "44444444-4444-4444-8444-444444444444",
  format: "carousel",
  topic: "why batching beats posting daily",
  skeleton: "case_study",
  kit: "signal",
  photoMediaIds: ["55555555-5555-4555-8555-555555555555"],
};

beforeEach(() => {
  billing = memoryStore();
  jobs = memoryJobStore(() => billing.rows);
  provider = fakeProviders();
  scheduled = [];
  limited = { asked: [] };
  // The fake store stamps rows with the real clock, so the job machine's clock
  // has to start from the same place for the stuck rule to mean anything.
  clock = new Date();
});

/* ------------------------------------------------------------------ */

describe("startJob", () => {
  test("an image job charges once, runs after the response, and settles what it really cost", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", avatarId: "a1", input: IMAGE }, deps());

    assert.equal(started.status, "queued");
    assert.equal(started.credits, IMAGE_CREDITS);
    assert.equal(started.creditsCharged, IMAGE_CREDITS);
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);
    assert.equal(provider.calls.generateImage, 0, "nothing runs inside the request");

    /* The estimate is the worst case — a rejected take is redone, so two
       Nano Banana 2.1 images at $0.06 (2K) — plus the prompt writer and the
       photo judge either side of them, which are model calls we pay for too. */
    assert.equal(jobs.costs.length, 1);
    assert.equal(jobs.costs[0].status, "reserved");
    assert.ok(
      Math.abs(jobs.costs[0].costUsd - (0.12 + jobModelEstimateUsd("image"))) < 1e-9,
      `reserved ${jobs.costs[0].costUsd}`,
    );

    await drain();
    const done = await advanceJob(USER_ID, started.id, deps());

    assert.equal(done?.status, "completed");
    assert.equal(done?.mediaIds.length, 1);
    assert.equal(done?.message, "Done.");
    assert.equal(done?.creditsCharged, IMAGE_CREDITS);
    assert.equal(done?.creditsRefunded, 0);
    assert.equal(provider.calls.generateImage, 1);
    assert.equal(ledgerRows("job_reserve").length, 1);
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);

    assert.equal(jobs.costs[0].status, "done");
    assert.ok(Math.abs(jobs.costs[0].costUsd - 0.134) < 1e-9, "the estimate is replaced by what really happened");
  });

  test("the free photo costs nothing and is still a real job", async () => {
    /* No credits seeded: this is a brand new account, which is exactly who
       the free photo is for. */
    const started = await startJob(
      user(),
      { kind: "image", requestId: "free", avatarId: "a1", input: FREE_IMAGE },
      deps(),
    );

    assert.equal(started.credits, 0);
    assert.equal(started.creditsCharged, 0);
    assert.equal(ledgerRows("job_reserve").length, 0, "a job priced at zero writes no ledger row");
    assert.equal(await balance(), 0);

    /* Everything else about it is an ordinary image job: it is rate limited
       against the `jobs` allowance, its estimated provider cost is held
       against the global daily cap, and it runs after the response. */
    assert.deepEqual(limited.asked, ["jobs"]);
    assert.equal(jobs.costs.length, 1);
    assert.equal(provider.calls.generateImage, 0);

    await drain();
    const done = await getJob(USER_ID, started.id, deps());
    assert.equal(done?.status, "completed");
    assert.equal(done?.creditsCharged, 0, "still nothing after it finished");
    assert.equal(jobs.costs[0].status, "done", "what it cost us is recorded either way");
  });

  test("a free photo that fails costs nothing and refunds nothing, because nothing was taken", async () => {
    provider.failNext.generateImage = "Gemini is unwell";
    const started = await startJob(
      user(),
      { kind: "image", requestId: "free-fail", input: FREE_IMAGE },
      deps(),
    );
    await drain();

    const failed = await getJob(USER_ID, started.id, deps());
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.creditsCharged, 0);
    assert.equal(failed?.creditsRefunded, 0);
    assert.equal(ledgerRows("job_refund").length, 0);
    assert.equal(jobs.costs[0].status, "refunded");
  });

  test("the freebie marker only frees an image job, and only with the right value", async () => {
    seedCredits(2000);
    /* A clip carrying the marker is still a clip, at the clip price. The
       marker is read by `isFreebie`, which checks the kind as well, so a
       forged input cannot turn a three-credit clip into a free one. */
    const clip = await startJob(
      user(),
      { kind: "clip", requestId: "forged-clip", input: { ...CLIP, freebie: ONBOARDING_FREEBIE } as never },
      deps(),
    );
    assert.equal(clip.credits, CLIP_CREDITS);

    // And a marker with anything else in it is not the marker.
    const image = await startJob(
      user(),
      { kind: "image", requestId: "forged-image", input: { ...IMAGE, freebie: "something_else" } as never },
      deps(),
    );
    assert.equal(image.credits, IMAGE_CREDITS);
  });

  test("a repeated requestId returns the first job and charges nothing", async () => {
    seedCredits(2000);
    const first = await startJob(user(), { kind: "image", requestId: "same", input: IMAGE }, deps());
    const second = await startJob(user(), { kind: "image", requestId: "same", input: IMAGE }, deps());

    assert.equal(second.id, first.id);
    assert.equal(ledgerRows("job_reserve").length, 1);
    assert.equal(jobs.jobs.size, 1);
    assert.equal(jobs.costs.length, 1);
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);
  });

  test("two deliveries of one submission racing each other still reserve once", async () => {
    seedCredits(2000);
    const both = await Promise.all([
      startJob(user(), { kind: "image", requestId: "race", input: IMAGE }, deps()),
      startJob(user(), { kind: "image", requestId: "race", input: IMAGE }, deps()),
    ]);

    assert.equal(both[0].id, both[1].id);
    assert.equal(ledgerRows("job_reserve").length, 1);
    assert.equal(jobs.jobs.size, 1);
  });

  test("not enough credits leaves no job behind, and says what is needed", async () => {
    seedCredits(0);
    await assert.rejects(
      () => startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps()),
      (error: unknown) => {
        assert.ok(error instanceof NotEnoughCreditsError);
        assert.match(error.message, /costs 1 credits? and you have 0 left/);
        assert.match(error.message, /Nothing was charged/);
        return true;
      },
    );

    assert.equal(jobs.jobs.size, 0, "no job is left behind");
    assert.equal(ledgerRows("job_reserve").length, 0);
    assert.equal(await balance(), 0);
    /* The cap reservation is written before the credits are, so it exists —
       and it is written off, which is what keeps it out of the day's total. */
    assert.equal(jobs.costs.length, 1);
    assert.equal(jobs.costs[0].status, "refunded");
    assert.equal(await jobs.spentTodayUsd(clock), 0, "a job nobody could pay for costs the day nothing");
  });

  test("the global daily cap blocks a new job, and costs the user nothing", async () => {
    seedCredits(20000);
    // Somebody else has already spent nearly all of today's budget.
    jobs.costs.push({
      jobId: "other", userId: "someone_else", provider: "gemini", model: "image", kind: "image",
      costUsd: 24.9, status: "done", createdAt: clock, meta: {},
    });

    await assert.rejects(
      () => startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps()),
      (error: unknown) => {
        assert.ok(error instanceof BudgetExceededError);
        assert.match(error.message, /daily limit/);
        return true;
      },
    );
    assert.equal(jobs.jobs.size, 0);
    assert.equal(ledgerRows("job_reserve").length, 0);
    assert.equal(await balance(), 20000);
  });

  test("a job that costs no credits still costs us money, and is recorded", async () => {
    /* A reel charges nothing and takes no credits, but it asks a vision model
       where the face is. That call used to be invisible to `provider_costs`
       and to the daily cap, because the accounting was guarded on the credit
       price rather than on what we spend. */
    const started = await startJob(user(), { kind: "reel", requestId: "r1", input: REEL }, deps());
    assert.equal(started.credits, 0);
    assert.equal(billing.rows.length, 0, "nothing is taken from the balance");
    assert.equal(jobs.costs.length, 1, "what we spend is recorded anyway");
    assert.ok(Math.abs(jobs.costs[0].costUsd - jobModelEstimateUsd("reel")) < 1e-9);

    await drain();
    const done = await advanceJob(USER_ID, started.id, deps());
    assert.equal(done?.status, "completed");
    assert.equal(provider.calls.assembleReel, 1);
  });

  test("the daily cap stops a job that costs no credits at all", async () => {
    jobs.costs.push({
      jobId: "other", userId: "someone_else", provider: "gemini", model: "image", kind: "image",
      costUsd: 25, status: "done", createdAt: clock, meta: {},
    });

    await assert.rejects(
      () => startJob(user(), { kind: "carousel", requestId: "r1", input: CAROUSEL }, deps()),
      BudgetExceededError,
    );
    assert.equal(jobs.jobs.size, 0, "no job is left behind");
    assert.equal(ledgerRows("job_reserve").length, 0);
  });

  test("a carousel is free, runs after the response, and charges nothing", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "carousel", requestId: "r1", input: CAROUSEL }, deps());

    assert.equal(started.credits, 0);
    assert.ok(Math.abs(jobs.costs[0].costUsd - jobModelEstimateUsd("carousel")) < 1e-9, "the writer costs us money");
    assert.equal(provider.calls.renderCarousel, 0, "nothing runs inside the request");

    await drain();
    const done = await advanceJob(USER_ID, started.id, deps());

    assert.equal(done?.status, "completed");
    assert.equal(provider.calls.renderCarousel, 1);
    assert.equal(ledgerRows("job_reserve").length, 0);
    assert.equal(await balance(), 2000);
  });

  test("a carousel runs with no credits at all, on its own allowance", async () => {
    /* A carousel costs no credits, so the rate limiter is what bounds it. */
    const started = await startJob(
      user(),
      { kind: "carousel", requestId: "r1", input: CAROUSEL },
      deps(),
    );
    assert.equal(started.status, "queued");
    assert.deepEqual(limited.asked, ["carousel"], "and it is the carousel allowance it draws on");
  });

  test("a reel draws on the reels allowance, not the carousel one", async () => {
    await startJob(user(), { kind: "reel", requestId: "r1", input: REEL }, deps());
    assert.deepEqual(limited.asked, ["reels"]);
  });

  test("a rate-limited account starts nothing and is charged nothing", async () => {
    seedCredits(2000);
    limited.refuse = new Error("That is 100 sets of hooks today, which is the limit.");
    await assert.rejects(
      () => startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps()),
      /which is the limit/,
    );
    assert.equal(jobs.jobs.size, 0);
    assert.equal(jobs.costs.length, 0);
    assert.equal(await balance(), 2000);
  });

  test("a repeated carousel requestId renders once", async () => {
    const first = await startJob(user(), { kind: "carousel", requestId: "same", input: CAROUSEL }, deps());
    const second = await startJob(user(), { kind: "carousel", requestId: "same", input: CAROUSEL }, deps());
    assert.equal(second.id, first.id);
    await drain();
    assert.equal(provider.calls.renderCarousel, 1);
  });
});

describe("failure", () => {
  test("a failed job refunds, records nothing as charged, and says so plainly", async () => {
    seedCredits(2000);
    provider.failNext.generateImage = "Gemini gemini-3-pro-image 400: bad request";
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    await drain();

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.equal(job?.error, "The image service could not finish this one.");
    assert.equal(job?.creditsRefunded, IMAGE_CREDITS);
    assert.equal(job?.creditsCharged, 0);
    assert.equal(await balance(), 2000, "the balance is whole again");
    assert.equal(jobs.costs[0].status, "refunded");
  });

  test("looking at a failed job again does not refund twice", async () => {
    seedCredits(2000);
    provider.failNext.generateImage = "Gemini 500: boom";
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    await drain();
    await advanceJob(USER_ID, started.id, deps());
    await advanceJob(USER_ID, started.id, deps());

    assert.equal(ledgerRows("job_refund").length, 1);
    assert.equal(await balance(), 2000);
  });

  test("a provider that refuses the clip fails it in plain words and gives the credits back", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain(); // submits
    provider.clip = { state: "failed", status: "nsfw", message: "rejected" };

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /refused this one as unsafe/);
    assert.equal(job?.creditsRefunded, CLIP_CREDITS);
    assert.equal(await balance(), 2000);
  });
});

describe("clip polling", () => {
  test("submits once, polls until ready, then stores the clip", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    assert.equal(started.credits, CLIP_CREDITS);
    assert.equal(provider.calls.submitClip, 0, "nothing is submitted inside the request");

    await drain();
    assert.equal(provider.calls.submitClip, 1);
    const submitted = jobs.jobs.get(started.id) as JobRecord;
    assert.equal(submitted.status, "running");
    assert.equal(submitted.providerRequestId, "req_1");
    assert.equal(submitted.input.providerStatusUrl, "https://example.invalid/req_1");

    const waiting = await advanceJob(USER_ID, started.id, deps());
    assert.equal(waiting?.status, "running");
    assert.equal(provider.calls.submitClip, 1, "a poll never submits a second time");
    assert.equal(provider.calls.storeClip, 0);

    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };
    const done = await advanceJob(USER_ID, started.id, deps());
    assert.equal(done?.status, "completed");
    assert.equal(done?.mediaIds.length, 1);
    assert.equal(done?.creditsCharged, CLIP_CREDITS);
    assert.equal(ledgerRows("job_reserve").length, 1);
    assert.equal(jobs.costs[0].status, "done");
    assert.ok(Math.abs(jobs.costs[0].costUsd - 0.42) < 1e-9);
  });

  test("two polls at once store one output between them", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };

    /* Hold the first poll inside the provider call and let the second one run
       all the way through while it is in there, so the two genuinely overlap. */
    let release = () => {};
    provider.hold = { step: "clipStatus", promise: new Promise<void>((resolve) => (release = resolve)) };
    const both = Promise.all([advanceJob(USER_ID, started.id, deps()), advanceJob(USER_ID, started.id, deps())]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    const [first, second] = await both;

    assert.equal(provider.calls.clipStatus, 1, "only the caller that won the claim asked the provider");
    assert.equal(provider.calls.storeClip, 1, "only one of them stored anything");
    assert.equal(provider.discarded.length, 0, "nothing had to be thrown away");

    const stored = jobs.jobs.get(started.id);
    assert.equal(stored?.status, "completed");
    assert.equal(stored?.output?.mediaIds.length, 1, "exactly one output on the row");

    // The one that lost the claim reports the state it found, and never a second result.
    const answers = [first, second];
    assert.equal(answers.filter((job) => job?.status === "completed").length, 1);
    assert.equal(answers.filter((job) => job?.status === "running").length, 1);
    assert.equal(ledgerRows("job_reserve").length, 1);
    assert.equal(ledgerRows("job_refund").length, 0);

    // And a later poll sees that same single output.
    const later = await advanceJob(USER_ID, started.id, deps());
    assert.deepEqual(later?.mediaIds, stored?.output?.mediaIds);
    assert.equal(provider.calls.storeClip, 1);
  });

  test("a poll that finishes second throws its own output away rather than replacing the first", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };

    // Hold this poll inside `storeClip`, past its claim, and let another
    // instance of the app finish the job underneath it.
    let release = () => {};
    provider.hold = { step: "storeClip", promise: new Promise<void>((resolve) => (release = resolve)) };
    const slow = advanceJob(USER_ID, started.id, deps());
    await Promise.resolve();
    await jobs.transition({
      userId: USER_ID,
      jobId: started.id,
      from: ["running"],
      patch: { status: "completed", output: { mediaIds: ["media_from_elsewhere"], message: "Done." } },
    });
    release();

    const result = await slow;
    assert.deepEqual(result?.mediaIds, ["media_from_elsewhere"], "the stored output is the one that got there first");
    assert.equal(provider.discarded.length, 1, "the loser's bytes are deleted, not orphaned");
    assert.equal(jobs.jobs.get(started.id)?.output?.mediaIds.length, 1);
  });

  test("a completed job is never worked on again", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };

    await advanceJob(USER_ID, started.id, deps());
    await advanceJob(USER_ID, started.id, deps());
    assert.equal(provider.calls.storeClip, 1);
  });

  test("a failure that loses the race to a completion refunds nothing", async () => {
    /* The interleaving that used to hand credits back for delivered work: one
       worker sits inside the provider call, another completes the job with an
       output, and then the first one's call throws. The user keeps the media,
       so the user must not keep the credits as well. */
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };

    let release = () => {};
    provider.hold = { step: "storeClip", promise: new Promise<void>((resolve) => (release = resolve)) };
    const slow = advanceJob(USER_ID, started.id, deps());
    await Promise.resolve();

    // Another instance finishes it, with an output, while this poll is held.
    await jobs.transition({
      userId: USER_ID,
      jobId: started.id,
      from: ["running"],
      patch: { status: "completed", output: { mediaIds: ["media_from_elsewhere"], message: "Done." } },
    });
    // ...and then the held call fails, which is what sends this poll into fail().
    provider.failNext.storeClip = "Higgsfield 500: boom";
    release();

    const result = await slow;
    assert.equal(result?.status, "completed", "the row keeps the verdict that was written first");
    assert.deepEqual(result?.mediaIds, ["media_from_elsewhere"]);
    assert.equal(ledgerRows("job_refund").length, 0, "no refund row for work that was delivered");
    assert.equal(result?.creditsRefunded, 0);
    assert.equal(await balance(), 3000 - CLIP_CREDITS);
    assert.notEqual(jobs.costs[0].status, "refunded", "what we spent still counts against the day");
  });

  test("the stuck sweep does not refund a job that completed under it", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    scheduled.length = 0; // `after()` never ran: this is the invocation that died.
    jobs.age(started.id, STUCK_AFTER_MS + 1000);

    /* The completion lands between this poll reading the row and its attempt to
       write the row off, which is the whole race: the sweep decided on a read
       that was already stale. */
    const racing: MemoryJobStore = {
      ...jobs,
      async transition(input) {
        if (input.patch.status === "failed") {
          await jobs.transition({
            userId: USER_ID,
            jobId: started.id,
            from: ["queued", "running"],
            patch: { status: "completed", output: { mediaIds: ["media_late"], message: "Done." } },
          });
        }
        return jobs.transition(input);
      },
    };

    const job = await advanceJob(USER_ID, started.id, deps({ store: racing }));
    assert.equal(job?.status, "completed", "the delivered output stands");
    assert.equal(ledgerRows("job_refund").length, 0);
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);
  });
});

describe("stuck jobs", () => {
  test("nothing to poll and nothing moving for ten minutes is failed and refunded", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    // `after()` never ran — the invocation died — and the clock moved on.
    jobs.age(started.id, STUCK_AFTER_MS + 1000);

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /took too long/);
    assert.equal(job?.creditsRefunded, IMAGE_CREDITS);
    assert.equal(await balance(), 2000);
    assert.equal(jobs.costs[0].status, "refunded");
    assert.equal(provider.calls.generateImage, 0);
  });

  test("a job that is only nine minutes old is left alone", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    jobs.age(started.id, 9 * 60 * 1000);

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "queued");
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);
  });

  test("a poll that throws is retried, and the clip still lands when the provider answers", async () => {
    /* 2026-09-22: one status call failed during a provider wobble and the job
       was written off 25 seconds in, while the provider finished the clip two
       minutes later. A failed question is not a failed clip. */
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();

    provider.failNext.clipStatus = "Higgsfield 503: upstream unavailable";
    const wobble = await advanceJob(USER_ID, started.id, deps());
    assert.equal(wobble?.status, "running", "one bad answer keeps the job waiting");
    assert.equal(await balance(), 3000 - CLIP_CREDITS, "nothing is refunded for a bad answer");

    provider.failNext.storeClip = "Higgsfield download failed";
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/clip.mp4" };
    const wobble2 = await advanceJob(USER_ID, started.id, deps());
    assert.equal(wobble2?.status, "running", "a failed download is tried again too");

    const done = await advanceJob(USER_ID, started.id, deps());
    assert.equal(done?.status, "completed");
    assert.equal(done?.mediaIds.length, 1);
  });

  test("a poll that keeps throwing past the deadline fails the clip and refunds", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    clock = new Date(clock.getTime() + CLIP_DEADLINE_MS + 1000);

    provider.failNext.clipStatus = "Higgsfield 503: upstream unavailable";
    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /video service could not finish/);
    assert.equal(await balance(), 3000);
    assert.equal(jobs.costs[0].status, "done", "submitted, so the provider bills it whatever we do");
  });

  test("a clip waiting at the provider is not written off by the stuck rule, up to the pending deadline", async () => {
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    // Well past the stuck rule's ten minutes, still inside the provider's half hour.
    jobs.age(started.id, STUCK_AFTER_MS * 2);
    clock = new Date(clock.getTime() + CLIP_PENDING_DEADLINE_MS - 60 * 1000);

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "running", "it has a provider id, so there is something to wait for");
    assert.equal(await balance(), 3000 - CLIP_CREDITS);
  });

  test("a clip the provider still calls pending after the deadline is failed and refunded", async () => {
    /* A request the provider lost, or queued behind an outage, answered
       "pending" for ever, and the credits reserved for it were held for ever. */
    seedCredits(3000);
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    clock = new Date(clock.getTime() + CLIP_PENDING_DEADLINE_MS + 1000);

    const job = await advanceJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /did not finish this clip in half an hour/);
    assert.equal(job?.creditsRefunded, CLIP_CREDITS);
    assert.equal(await balance(), 3000);
    // The provider accepted the request and bills it either way, so it still counts against our day.
    assert.equal(jobs.costs[0].status, "done");
    assert.equal(jobs.costs[0].meta.providerBilled, true);
  });

  test("a clip that fails before it reaches the provider costs us nothing", async () => {
    seedCredits(3000);
    provider.failNext.submitClip = "Higgsfield 500: could not accept the request";
    const started = await startJob(user(), { kind: "clip", requestId: "r1", input: CLIP }, deps());
    await drain();
    const job = await getJob(USER_ID, started.id, deps());
    assert.equal(job?.status, "failed");
    assert.equal(await balance(), 3000);
    assert.equal(jobs.costs[0].status, "refunded", "no submission id, so nothing was billed");
  });
});

describe("a reservation that commits and then throws", () => {
  test("is refunded before the job row is removed, so the ledger row is never orphaned", async () => {
    /* Deleting the job first sets the reserve row's job_id to null (ON DELETE
       SET NULL), and a row with no job can never be refunded: the credits are
       gone with nothing to show for them. */
    seedCredits(2000);
    const flaky = {
      ...billing.credits,
      async tryReserve(input: Parameters<typeof billing.credits.tryReserve>[0]) {
        await billing.credits.tryReserve(input);
        throw new Error("connection reset after the write committed");
      },
    };
    await assert.rejects(
      () => startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps({ credits: flaky })),
      /connection reset/,
    );
    assert.equal(ledgerRows("job_reserve").length, 1, "the reservation did commit");
    assert.equal(ledgerRows("job_refund").length, 1, "and was given back");
    assert.equal(await balance(), 2000);
    assert.equal(jobs.jobs.size, 0, "no job row is left behind");
    assert.equal(jobs.costs[0].status, "refunded");
  });
});

describe("stopJob", () => {
  test("fails and refunds a job still working, and leaves a settled one alone", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    scheduled.length = 0; // nobody will ever run it

    const stopped = await stopJob(USER_ID, started.id, "The run that needed this was stopped.", deps());
    assert.equal(stopped?.status, "failed");
    assert.equal(stopped?.error, "The run that needed this was stopped.");
    assert.equal(await balance(), 2000);
    assert.equal(jobs.costs[0].status, "refunded");

    const again = await stopJob(USER_ID, started.id, "again", deps());
    assert.equal(again?.error, "The run that needed this was stopped.", "a second stop changes nothing");
    assert.equal(ledgerRows("job_refund").length, 1);

    const finished = await startJob(user(), { kind: "image", requestId: "r2", input: IMAGE }, deps());
    await drain();
    const kept = await stopJob(USER_ID, finished.id, "too late", deps());
    assert.equal(kept?.status, "completed", "a delivered output is never taken back");
    assert.equal(await balance(), 2000 - IMAGE_CREDITS);
    assert.equal(await stopJob("user_someone_else", finished.id, "x", deps()), null);
  });
});

describe("tenancy", () => {
  test("another user's job id is not found", async () => {
    seedCredits(2000);
    const started = await startJob(user(), { kind: "image", requestId: "r1", input: IMAGE }, deps());
    assert.equal(await advanceJob("user_someone_else", started.id, deps()), null);
  });
});

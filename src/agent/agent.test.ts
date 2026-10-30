/* A whole agent run through the job machine, with fakes for the models, the
 * providers and the tables. What it proves: the run pays for nothing itself,
 * every paid step is an ordinary child job priced and charged on its own, a
 * library clip skips both paid steps, a photo that fails the judge stops the
 * run before the clip is bought, and a retry continues from the failed step. */

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { ClipState } from "@/ai/clips";
import { creditsFor } from "@/billing/pricing";
import { DEFAULT_IMAGE_MODEL } from "@/content/image-options";
import { memoryStore, type MemoryBillingStore } from "@/billing/store.memory";
import { advanceJob, getJobRecord, startJob, type JobDeps, type JobUser } from "@/jobs";
import { pollAgent } from "@/jobs/poll";
import type { JobProviders, StepOutcome, SubmittedClip } from "@/jobs/providers";
import type { JobInput, JobRecord } from "@/jobs/types";
import { memoryJobStore, type MemoryJobStore } from "@/jobs/store.memory";

import { clipSecondsFor } from "@/reel/timing";

import { agentCredits, carryOver, initialState, remainingCredits, type AgentJobInput, type AgentRequest } from "./plan";
import { AGENT_DEADLINE_MS, type AgentDeps } from "./step";
import { agentView, isAgentRecord } from "./view";

const USER_ID = "user_agent_test";
const AVATAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO_CREDITS = creditsFor({ kind: "image", model: DEFAULT_IMAGE_MODEL });
const HOOK = "I post every day and have never filmed myself.";
const PHOTO_WORDS = "my plan for today is to be unbothered and slightly feral about it";
/* The clip is made as long as the reel: this hook with its cue is a 7-second reel. */
const CLIP_SECONDS = clipSecondsFor(HOOK, "Read the caption");
const CLIP_CREDITS = creditsFor({ kind: "clip", model: "omni", seconds: CLIP_SECONDS });

interface Fakes {
  providers: JobProviders;
  calls: Record<string, number>;
  clip: ClipState;
  inputs: JobInput[];
}

function fakeProviders(): Fakes {
  const state: Fakes = { providers: null as unknown as JobProviders, calls: {}, clip: { state: "pending", status: "queued" }, inputs: [] };
  let media = 0;
  const count = (name: string) => (state.calls[name] = (state.calls[name] ?? 0) + 1);
  const outcome = (costUsd: number): StepOutcome => ({ mediaIds: [`media_${++media}`], message: "Done.", costUsd });
  state.providers = {
    async generateImage(_job, input) { count("generateImage"); state.inputs.push(input); return outcome(0.134); },
    async submitClip(_job, input): Promise<SubmittedClip> { count("submitClip"); state.inputs.push(input); return { provider: "google", requestId: "req_1", statusUrl: "https://example.invalid/req_1", costUsd: 0.42 }; },
    async clipStatus() { count("clipStatus"); return state.clip; },
    async storeClip() { count("storeClip"); return outcome(0.42); },
    async assembleReel(_job, input) { count("assembleReel"); state.inputs.push(input); return outcome(0); },
    async renderCarousel(_job, input) { count("renderCarousel"); state.inputs.push(input); return { mediaIds: ["slide_1", "slide_2", "slide_3"], message: "3 slides rendered.", costUsd: 0 }; },
    async renderTextPhoto(_job, input) { count("renderTextPhoto"); state.inputs.push(input); return { mediaIds: ["worded_1"], message: "Your words are on the photo.", costUsd: 0 }; },
    async discardMedia() {},
  };
  return state;
}

interface AgentFakes extends AgentDeps {
  library: { mediaId: string; description: string }[];
  keep: boolean;
  drafts: string[];
  /** Hold the writer open, so a second poll can be let in while the first is inside it. */
  holdWrite?: Promise<void>;
}

function fakeAgent(): AgentFakes {
  const fakes: AgentFakes = {
    library: [],
    keep: true,
    drafts: [],
    async brand() {
      return {
        avatarId: AVATAR_ID,
        avatarName: "Maya",
        profile: { niche: "avatars", audience: "shy creators", offer: "a guide", keyword: "AVATAR", voice: "plain", proofPoints: [] },
        lock: null,
        brief: null,
      };
    },
    async screenIdea() {},
    async writeWords() {
      return PHOTO_WORDS;
    },
    async write(_profile, options) {
      if (fakes.holdWrite) await fakes.holdWrite;
      return {
        hook: HOOK,
        angle: "privacy",
        caption: "Here is how.",
        cta: "Comment AVATAR.",
        visual: { scene: "At a cafe table with a laptop and an iced latte", shot: "friend", motion: "She sips, then glances up." },
        ...(options.format === "talking" ? { spoken: "I have never once filmed myself, and I post every day." } : {}),
      };
    },
    async direct(input) {
      const clip = input.library[0];
      return { cue: { text: "Read the caption", why: "It asks how." }, noCueWhy: null, clip: clip && input.request.footage !== "new" ? { mediaId: clip.mediaId, why: "Same cafe" } : null };
    },
    async polishMotion(motion) { return `${motion} (polished)`; },
    async planScenes(input) {
      return Array.from({ length: input.count }, (_, index) => ({ idea: `Scene ${index + 1} of ${input.brief}`, shot: "selfie" as const, why: "fits" }));
    },
    async libraryClips() { return fakes.library; },
    async addDraft(_userId, _avatarId, post) { fakes.drafts.push(post.hook); return "dddddddd-dddd-4ddd-8ddd-dddddddddddd"; },
    async photoVerdict() { return { keep: fakes.keep, problems: fakes.keep ? [] : ["hands are malformed"] }; },
    async createFolder() { return "ffffffff-ffff-4fff-8fff-ffffffffffff"; },
    async carouselDraft() { return "cccccccc-cccc-4ccc-8ccc-cccccccccccc"; },
    async carouselPhotos() { return ["p1", "p2", "p3"]; },
  };
  return fakes;
}

let billing: MemoryBillingStore;
let jobs: MemoryJobStore;
let provider: Fakes;
let agent: AgentFakes;
let scheduled: Array<() => Promise<void>>;
/** The machine's clock; undefined means the real one. */
let clock: Date | undefined;
/** Refuse the nth generation start, the way the rate limiter or the daily cap would. */
let refuse: { atStart?: number; starts: number };

function deps(): Partial<JobDeps> {
  return {
    store: jobs,
    credits: billing.credits,
    providers: provider.providers,
    schedule: (task) => void scheduled.push(task),
    now: () => clock ?? new Date(),
    budgetUsd: () => 25,
    limits: async (_user, name) => {
      if (name === "jobs" && ++refuse.starts === refuse.atStart) throw new Error("You have made 30 photos today. Try again tomorrow.");
    },
    users: { find: async (id) => ({ id, email: "x@example.invalid", stripeCustomerId: null, plan: "creator", planStatus: "active", stripeSubscriptionId: null, currentPeriodEnd: null }) },
    agent,
  };
}

async function drain(): Promise<void> {
  while (scheduled.length) await scheduled.shift()!();
}

const user = (): JobUser => ({ id: USER_ID });
const REEL: AgentRequest = { kind: "reel", brief: "why she never films herself", footage: "auto", cue: "auto", talking: false };

async function start(request: AgentRequest, requestId = "req_agent"): Promise<string> {
  const job = await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId, input: { kind: "agent", message: "make me a reel", request, reply: "On it." } }, deps());
  return job.id;
}

/** One poll of the run, then whatever `after()` queued for its children. */
async function poll(id: string) {
  const view = await advanceJob(USER_ID, id, deps());
  await drain();
  return view!;
}

/** Poll, the way the browser does, until `until` holds or the run is over. */
async function pollUntil(id: string, until: () => boolean, max = 20) {
  let view = await poll(id);
  for (let count = 1; !until() && view.status !== "completed" && view.status !== "failed" && count < max; count++) view = await poll(id);
  return view;
}

async function record(id: string): Promise<JobRecord & { input: AgentJobInput }> {
  const row = await getJobRecord(USER_ID, id, deps());
  assert.ok(row && isAgentRecord(row));
  return row;
}

const stepStatus = async (id: string) => Object.fromEntries((await record(id)).input.state!.steps.map((step) => [step.name, step.status]));

beforeEach(() => {
  billing = memoryStore();
  jobs = memoryJobStore(() => billing.rows);
  provider = fakeProviders();
  agent = fakeAgent();
  scheduled = [];
  clock = undefined;
  refuse = { starts: 0 };
  billing.seedLedger({ userId: USER_ID, delta: 20, reason: "adjustment" });
});

describe("a reel run", () => {
  test("costs nothing itself and pays for the photo and the clip as child jobs", async () => {
    const id = await start(REEL);
    const run = await record(id);
    assert.equal(run.credits, 0);
    await drain(); // the first step, the writer, runs after the response
    assert.deepEqual(agent.drafts, ["I post every day and have never filmed myself."]);

    await poll(id); // direct: no library clip, so a photo is needed
    assert.equal((await stepStatus(id)).direct, "done");
    await pollUntil(id, () => provider.calls.generateImage === 1); // the photo child, started and drained
    assert.equal(provider.calls.generateImage, 1);
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS);

    await pollUntil(id, () => provider.calls.submitClip === 1); // photo done, clip child submitted
    assert.equal(provider.calls.submitClip, 1);
    const clipInput = provider.inputs.find((input) => input.kind === "clip") as { motion: string; model: string; speech?: boolean; seconds: number };
    assert.equal(clipInput.motion, "She sips, then glances up. (polished)");
    assert.equal(clipInput.model, "omni");
    assert.equal(clipInput.seconds, CLIP_SECONDS, "the clip is as long as the reel, so nothing loops");
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS - CLIP_CREDITS);

    await poll(id); // clip still rendering
    assert.equal((await stepStatus(id)).clip, "running");
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/v.mp4" };
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(provider.calls.assembleReel, 1);
    const reelInput = provider.inputs.find((input) => input.kind === "reel") as { cue?: string; mode?: string };
    assert.equal(reelInput.cue, "Read the caption");
    assert.equal(reelInput.mode, "loop");

    const finished = agentView(await record(id));
    assert.equal(finished.creditsSpent, PHOTO_CREDITS + CLIP_CREDITS);
    assert.equal(finished.mediaIds.length, 3, "photo, clip and reel");
    assert.match(finished.summary ?? "", /Your reel is ready/);
    // The run's own row never reserved a credit.
    assert.equal(billing.rows.filter((row) => row.jobId === id).length, 0);
  });

  test("a library clip skips the paid steps and the reel costs nothing", async () => {
    agent.library = [{ mediaId: "clip_lib", description: "At a cafe with a latte" }];
    const id = await start(REEL);
    await drain();
    await poll(id); // direct: reuse
    const status = await stepStatus(id);
    assert.equal(status.photo, "skipped");
    assert.equal(status.clip, "skipped");
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(provider.calls.generateImage ?? 0, 0);
    assert.equal(await billing.credits.balance(USER_ID), 20);
    const reelInput = provider.inputs.find((input) => input.kind === "reel") as { clipMediaId: string };
    assert.equal(reelInput.clipMediaId, "clip_lib");
  });

  test("a photo that fails the judge stops the run before the clip is bought", async () => {
    agent.keep = false;
    const id = await start(REEL);
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "failed");
    assert.match(view.error ?? "", /failed the check/);
    assert.equal(provider.calls.submitClip ?? 0, 0);
    // The photo was paid for (it exists, hidden); the clip never was.
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS);
  });

  test("a retry carries the finished steps and prices only what is left", async () => {
    agent.keep = false;
    const id = await start(REEL);
    await drain();
    await pollUntil(id, () => false);
    const failed = await record(id);
    const carried = carryOver(failed.input.state!);
    const state = initialState(REEL, carried);
    assert.equal(state.steps.find((step) => step.name === "write")?.status, "done");
    assert.equal(state.steps.find((step) => step.name === "photo")?.status, "pending");
    assert.equal(state.children.photo, undefined, "the failed photo is not found again");
    assert.equal(remainingCredits(REEL, state), agentCredits(REEL), "nothing paid was carried, so the whole run is still to pay");

    agent.keep = true;
    const retry = await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId: "req_retry", input: { ...failed.input, state, resumedFrom: id } }, deps());
    await drain();
    assert.equal(agent.drafts.length, 1, "the hook is not written twice");
    await pollUntil(retry.id, () => provider.calls.generateImage === 2);
    assert.equal(provider.calls.generateImage, 2, "a new photo is made");
  });

  test("a talking reel uses Omni with sound, eight seconds at most", async () => {
    const id = await start({ ...REEL, talking: true });
    await drain();
    await pollUntil(id, () => provider.calls.submitClip === 1);
    const clipInput = provider.inputs.find((input) => input.kind === "clip") as { motion: string; model: string; speech?: boolean; seconds: number };
    assert.equal(clipInput.model, "omni");
    assert.equal(clipInput.speech, true);
    assert.equal(clipInput.motion, "I have never once filmed myself, and I post every day.");
    assert.ok(clipInput.seconds >= 4 && clipInput.seconds <= 8, `asked for ${clipInput.seconds}s`);
  });
});

describe("two callers on one step", () => {
  test("a poll that lands while the hook is being written does not write it again", async () => {
    let release!: () => void;
    agent.holdWrite = new Promise<void>((resolve) => (release = resolve));
    const id = await start(REEL);
    // The background run takes the write step and is held inside the writer.
    const background = scheduled.shift()!();
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The browser polls in the meantime, sees a running job, and claims it.
    const view = await advanceJob(USER_ID, id, deps());
    assert.equal(view?.status, "running");
    release();
    await background;
    await drain();
    assert.equal(agent.drafts.length, 1, "the hook is written once, whoever polls");
    await pollUntil(id, () => provider.calls.generateImage === 1);
    assert.equal((await record(id)).input.state?.lease, undefined, "the lease is released after the step");
  });

  /* Her open page, Claude's check_post and the every-minute sweep all call
     the same poll, and nothing stops two of them landing together. */
  test("two polls at once, every time, start each paid child once and charge it once", async () => {
    const id = await start(REEL);
    await drain();
    const both = async () => {
      await Promise.all([pollAgent(USER_ID, id, deps()), pollAgent(USER_ID, id, deps())]);
      await drain();
    };
    for (let round = 0; round < 12 && provider.calls.submitClip !== 1; round++) await both();
    assert.equal(provider.calls.generateImage, 1, "one photo");
    assert.equal(provider.calls.submitClip, 1, "one clip");
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/v.mp4" };
    for (let round = 0; round < 12 && (await record(id)).status !== "completed"; round++) await both();

    assert.equal((await record(id)).status, "completed");
    assert.equal(provider.calls.storeClip, 1, "the clip is stored once");
    assert.equal(provider.calls.assembleReel, 1, "the reel is made once");
    const children = [...jobs.jobs.values()].filter((job) => job.requestId.startsWith(`${id}:`));
    assert.deepEqual(children.map((job) => job.kind).sort(), ["clip", "image", "reel"]);
    assert.equal(billing.rows.filter((row) => row.reason === "job_reserve").length, 2, "one reservation each for the photo and the clip");
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS - CLIP_CREDITS);
  });
});

describe("a photo run", () => {
  test("plans the scenes, starts one child per photo and files them together", async () => {
    const id = await start({ kind: "photos", brief: "a coffee shop set", count: 3, mode: "set" });
    await drain(); // plan
    const planned = await record(id);
    assert.equal(planned.input.state?.scenes?.length, 3);
    assert.equal(planned.input.state?.folderId, undefined, "no folder until the photos are actually made");
    await pollUntil(id, () => provider.calls.generateImage === 3); // three children started and drained
    assert.equal(provider.calls.generateImage, 3);
    assert.equal((await record(id)).input.state?.folderId, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(view.mediaIds.length, 3);
    assert.equal(await billing.credits.balance(USER_ID), 20 - 3 * PHOTO_CREDITS);
    const inputs = provider.inputs.filter((input) => input.kind === "image") as { folderId: string | null }[];
    assert.ok(inputs.every((input) => input.folderId === "ffffffff-ffff-4fff-8fff-ffffffffffff"));
  });
});

describe("a photo run that stops part-way through starting", () => {
  test("keeps the photos it paid for, and a retry starts and prices only the missing ones", async () => {
    /* The third of four starts is refused (a rate limit, the daily cap). The
       two already started are paid for; before this fix the failure wrote the
       pre-loop state back, orphaned them, and "Try again from here" priced and
       bought all four again. */
    const request: AgentRequest = { kind: "photos", brief: "a coffee shop set", count: 4, mode: "set" };
    refuse.atStart = 3;
    const id = await start(request);
    await drain(); // plan
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "failed");
    assert.match(view.error ?? "", /30 photos today/);

    const failed = await record(id);
    assert.deepEqual(failed.input.state?.children.photos?.length, 2, "the two started children are on the row");
    assert.equal(provider.calls.generateImage, 2);
    assert.equal(await billing.credits.balance(USER_ID), 20 - 2 * PHOTO_CREDITS, "two photos paid for, nothing else");
    assert.equal(failed.input.state?.creditsSpent, 2 * PHOTO_CREDITS, "the failed run says what its children took");
    assert.equal(agentView(failed).creditsSpent, 2 * PHOTO_CREDITS);

    const state = initialState(request, carryOver(failed.input.state!));
    assert.equal(state.children.photos?.length, 2, "the retry keeps the paid children");
    assert.equal(remainingCredits(request, state), 2 * PHOTO_CREDITS, "and is priced for the two still to make");

    refuse.atStart = undefined;
    const retry = await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId: "req_retry", input: { ...failed.input, state, resumedFrom: id } }, deps());
    await drain();
    const done = await pollUntil(retry.id, () => false);
    assert.equal(done.status, "completed");
    assert.equal(provider.calls.generateImage, 4, "only the two missing photos were made");
    assert.equal(done.mediaIds.length, 4, "all four are in the library");
    assert.equal(await billing.credits.balance(USER_ID), 20 - 4 * PHOTO_CREDITS);
  });

  test("a photo step that started every child and then failed does not carry them into the retry", async () => {
    const request: AgentRequest = { kind: "photos", brief: "a coffee shop set", count: 2, mode: "set" };
    const full = initialState(request, { scenes: [{ idea: "a", shot: "selfie", why: "" }, { idea: "b", shot: "selfie", why: "" }], children: { photos: ["j1", "j2"] } });
    const failedState = { ...full, steps: full.steps.map((step) => ({ ...step, status: step.name === "plan" ? ("done" as const) : ("failed" as const) })) };
    assert.equal(carryOver(failedState).children?.photos, undefined, "found again, they would fail again");
    assert.equal(remainingCredits(request, initialState(request, carryOver(failedState))), 2 * PHOTO_CREDITS);
  });
});

describe("the deadline", () => {
  test("fails the child the run was waiting on, so its credits come back", async () => {
    const id = await start(REEL);
    await drain();
    await poll(id); // direct
    await pollUntil(id, () => provider.calls.submitClip === 1);
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS - CLIP_CREDITS);

    // Half an hour later the provider still says pending and the run gives up.
    clock = new Date(Date.now() + AGENT_DEADLINE_MS + 1000);
    const view = await poll(id);
    assert.equal(view.status, "failed");
    assert.match(view.error ?? "", /took too long/);

    const run = await record(id);
    const clipId = run.input.state?.children.clip?.[0];
    assert.ok(clipId);
    assert.equal(run.input.state?.waitingOn, null);
    const child = await getJobRecord(USER_ID, clipId, deps());
    assert.equal(child?.status, "failed", "the child is not left running for good");
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS, "the clip is refunded; the finished photo is kept and paid");
    assert.equal(run.input.state?.creditsSpent, PHOTO_CREDITS);
    // The provider had accepted the clip and bills it whether or not we collect it: it still counts against our day.
    assert.equal(jobs.costs.find((cost) => cost.jobId === clipId)?.status, "done");
  });
});

describe("a carousel run", () => {
  test("picks a shape and photos, then renders the set as a child job for free", async () => {
    const id = await start({ kind: "carousel", brief: "three mistakes new creators make", format: "carousel" });
    await drain();
    const planned = await record(id);
    assert.equal(planned.input.state?.photoIds?.length, 3);
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    const input = provider.inputs.find((item) => item.kind === "carousel") as { skeleton: string; kit: string };
    assert.equal(input.skeleton, "list");
    assert.equal(input.kit, "signal");
    assert.equal(await billing.credits.balance(USER_ID), 20);
  });
});

describe("words on her photo", () => {
  test("draws her words on the attached photo as one free child job, and makes no photo", async () => {
    const words = "this era is called: moving like i should have been a long time ago & never looking back.";
    const request: AgentRequest = { kind: "text_photo", brief: "the quote on her photo", words, style: "serif", material: { photos: ["photo_mine"] } };
    const id = await start(request);
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.deepEqual(view.mediaIds, ["worded_1"]);
    assert.equal(provider.calls.generateImage ?? 0, 0, "never a new photo");
    const input = provider.inputs.find((item) => item.kind === "text_photo") as { photoMediaId: string; text: string; style: string };
    assert.equal(input.photoMediaId, "photo_mine");
    assert.equal(input.text, words, "her words, untouched");
    assert.equal(input.style, "serif");
    assert.equal(await billing.credits.balance(USER_ID), 20);
    assert.equal(agentView(await record(id)).creditsSpent, 0);
  });
});

describe("words on her photo, written for her", () => {
  test("words she described are written once, drawn on her photo, and the card says them", async () => {
    const request: AgentRequest = { kind: "text_photo", brief: "a relatable life quote", words: "", wordsBrief: "a relatable, slightly unhinged life quote", style: "serif", material: { photos: ["photo_mine"] } };
    const id = await start(request);
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    const input = provider.inputs.find((item) => item.kind === "text_photo") as { photoMediaId: string; text: string };
    assert.equal(input.photoMediaId, "photo_mine");
    assert.equal(input.text, PHOTO_WORDS, "the photo-words writer's line, not a reel hook");
    assert.equal((await record(id)).input.state?.words, PHOTO_WORDS, "written down, so a retry draws the same words");
    assert.ok((agentView(await record(id)).summary ?? "").includes(PHOTO_WORDS), "the card says which words were written");
    assert.equal(provider.calls.generateImage ?? 0, 0, "never a new photo");
    assert.equal(agentView(await record(id)).creditsSpent, 0);
  });
});

describe("a run with library items attached", () => {
  test("a reel on an attached clip skips the photo and the clip, and costs nothing", async () => {
    agent.library = [{ mediaId: "clip_lib", description: "At a cafe with a latte" }];
    const request: AgentRequest = { ...REEL, material: { photos: [], clip: "clip_mine" } };
    assert.equal(agentCredits(request), 0);
    const id = await start(request);
    await drain();
    const status = await stepStatus(id);
    assert.equal(status.photo, "skipped");
    assert.equal(status.clip, "skipped");
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(provider.calls.generateImage ?? 0, 0);
    assert.equal(provider.calls.submitClip ?? 0, 0);
    const reelInput = provider.inputs.find((input) => input.kind === "reel") as { clipMediaId: string; cue?: string };
    assert.equal(reelInput.clipMediaId, "clip_mine", "her clip, not the library's best match");
    assert.equal(reelInput.cue, "Read the caption", "the director still decides the second line");
    assert.equal(await billing.credits.balance(USER_ID), 20);
  });

  test("a reel on an attached photo skips the photo step and animates that photo, paying for the clip only", async () => {
    const request: AgentRequest = { ...REEL, material: { photos: ["photo_mine", "photo_other"] } };
    assert.equal(agentCredits(request), agentCredits(REEL) - PHOTO_CREDITS);
    const id = await start(request);
    await drain();
    assert.equal((await stepStatus(id)).photo, "skipped");
    await pollUntil(id, () => provider.calls.submitClip === 1);
    assert.equal(provider.calls.generateImage ?? 0, 0);
    const clipInput = provider.inputs.find((input) => input.kind === "clip") as { imageMediaId: string };
    assert.equal(clipInput.imageMediaId, "photo_mine", "the first photo attached");
    assert.equal(await billing.credits.balance(USER_ID), 20 - CLIP_CREDITS);
    provider.clip = { state: "completed", status: "completed", videoUrl: "https://example.invalid/v.mp4" };
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(agentView(await record(id)).creditsSpent, CLIP_CREDITS);
  });

  test("a carousel with attached photos uses exactly those, in order, each once", async () => {
    const request: AgentRequest = { kind: "carousel", brief: "three mistakes new creators make", format: "carousel", material: { photos: ["p_b", "p_a"] } };
    const id = await start(request);
    await drain();
    assert.deepEqual((await record(id)).input.state?.photoIds, ["p_b", "p_a"], "nothing picked for her");
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    const input = provider.inputs.find((item) => item.kind === "carousel") as { photoMediaIds: string[]; photosOnce?: boolean };
    assert.deepEqual(input.photoMediaIds, ["p_b", "p_a"]);
    assert.equal(input.photosOnce, true);
    assert.equal(await billing.credits.balance(USER_ID), 20);
  });

  test("new photos with attached photos draw on the first three of them, at the usual price", async () => {
    const request: AgentRequest = { kind: "photos", brief: "same outfit at a cafe", count: 2, mode: "set", material: { photos: ["s1", "s2", "s3", "s4"] } };
    assert.equal(agentCredits(request), 2 * PHOTO_CREDITS);
    const id = await start(request);
    await drain();
    await pollUntil(id, () => provider.calls.generateImage === 2);
    const inputs = provider.inputs.filter((input) => input.kind === "image") as { sourceMediaIds?: string[] }[];
    assert.ok(inputs.every((input) => JSON.stringify(input.sourceMediaIds) === JSON.stringify(["s1", "s2", "s3"])));
  });

  test("a retry of a reel on an attached photo keeps the photo and prices the clip only", () => {
    const request: AgentRequest = { ...REEL, material: { photos: ["photo_mine"] } };
    const failed = initialState(request);
    const state = initialState(request, carryOver(failed));
    assert.equal(state.photoMediaId, "photo_mine");
    assert.equal(remainingCredits(request, state), agentCredits(request));
  });
});

describe("a photo with words", () => {
  const QUOTE = "this era is called: moving like i should have been a long time ago & never looking back.";
  const request: AgentRequest = {
    kind: "photos",
    brief: "Maya working out in active wear, sweaty, a close crop of her face and upper chest",
    count: 1,
    mode: "one",
    framing: "A close crop from her chin to mid-chest, camera straight on.",
    words: QUOTE,
    style: "bold",
    size: "small",
  };

  test("makes the photo, then draws the words on that photo for free", async () => {
    assert.equal(agentCredits(request), PHOTO_CREDITS);
    const id = await start(request);
    await drain(); // plan
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.equal(provider.calls.generateImage, 1);
    const image = provider.inputs.find((input) => input.kind === "image") as { idea: string };
    assert.match(image.idea, /Framing, as in her reference: A close crop from her chin to mid-chest/);
    const words = provider.inputs.find((input) => input.kind === "text_photo") as { photoMediaId: string; text: string; style: string; size?: string };
    assert.equal(words.photoMediaId, "media_1", "the photo this run made");
    assert.equal(words.text, QUOTE);
    assert.equal(words.style, "bold");
    assert.equal(words.size, "small");
    assert.deepEqual(view.mediaIds, ["media_1", "worded_1"], "the clean photo and the one with words");
    const run = agentView(await record(id));
    assert.equal(run.creditsSpent, PHOTO_CREDITS);
    assert.match(run.summary ?? "", /the words were free/);
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS);
  });

  test("a line like hers is written once, then drawn", async () => {
    const id = await start({ ...request, words: undefined, wordsLike: QUOTE });
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    const words = provider.inputs.find((input) => input.kind === "text_photo") as { text: string };
    assert.equal(words.text, HOOK, "the writer's line, not the screenshot's");
    assert.equal((await record(id)).input.state?.words, HOOK);
  });

  test("a quote post with no quote given: the quote is written first, the photo planned to suit it, then drawn", async () => {
    const quotePost: AgentRequest = { kind: "photos", brief: "A quote about preparing for the new year.", count: 1, mode: "one", wordsBrief: "A quote about preparing for the new year." };
    assert.equal(agentCredits(quotePost), PHOTO_CREDITS, "one photo's price; the words are free");
    const written: string[] = [];
    agent.writeWords = async (_profile, brief) => {
      written.push(brief);
      return PHOTO_WORDS;
    };
    const id = await start(quotePost);
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "completed");
    assert.deepEqual(written, ["A quote about preparing for the new year."], "written once, before the photo");
    assert.equal(provider.calls.generateImage, 1);
    const image = provider.inputs.find((input) => input.kind === "image") as { idea: string };
    assert.ok(image.idea.includes(PHOTO_WORDS), "the scene is planned around the quote");
    const words = provider.inputs.find((input) => input.kind === "text_photo") as { text: string };
    assert.equal(words.text, PHOTO_WORDS);
    assert.deepEqual(view.mediaIds, ["media_1", "worded_1"]);
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS);
  });

  test("a photo that fails the judge stops before the words, and a retry is priced at one photo", async () => {
    agent.keep = false;
    const id = await start(request);
    await drain();
    const view = await pollUntil(id, () => false);
    assert.equal(view.status, "failed");
    assert.match(view.error ?? "", /failed the check/);
    assert.equal(provider.calls.renderTextPhoto ?? 0, 0, "no words on a faulty photo");
    assert.equal(await billing.credits.balance(USER_ID), 20 - PHOTO_CREDITS);
    const failed = await record(id);
    assert.equal(agentView(failed).retryCredits, PHOTO_CREDITS);

    agent.keep = true;
    const state = initialState(request, carryOver(failed.input.state!));
    const retry = await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId: "req_retry", input: { ...failed.input, state, resumedFrom: id } }, deps());
    await drain();
    const done = await pollUntil(retry.id, () => false);
    assert.equal(done.status, "completed");
    const words = provider.inputs.find((input) => input.kind === "text_photo") as { photoMediaId: string };
    assert.equal(words.photoMediaId, "media_2", "the new photo, not the one that failed");
  });
});

describe("a run with the brand off", () => {
  async function startOff(request: AgentRequest): Promise<string> {
    const input: AgentJobInput = { kind: "agent", message: "just for fun", request, reply: "On it.", brand: false };
    return (await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId: "req_off", input }, deps())).id;
  }

  test("hands the writer and the director no niche, offer or keyword", async () => {
    const seen: { niche: string; offer: string; keyword: string; brandOff?: boolean }[] = [];
    let keyword: string | null = null;
    const write = agent.write;
    agent.write = async (profile, options) => {
      seen.push(profile);
      return write(profile, options);
    };
    const direct = agent.direct;
    agent.direct = async (input) => {
      keyword = input.keyword;
      return direct(input);
    };
    const id = await startOff(REEL);
    await drain();
    await poll(id);
    assert.deepEqual(seen.map(({ niche, offer, keyword: word, brandOff }) => ({ niche, offer, keyword: word, brandOff })), [{ niche: "", offer: "", keyword: "", brandOff: true }]);
    assert.equal(keyword, "");
  });

  test("tells the carousel job to write without the brand", async () => {
    const id = await startOff({ kind: "carousel", brief: "winter arc: five habits to start before January", format: "carousel" });
    await drain();
    await pollUntil(id, () => false);
    const input = provider.inputs.find((item) => item.kind === "carousel") as { brand?: boolean };
    assert.equal(input.brand, false);
  });

  test("a run with the brand on sends no flag, as before", async () => {
    const id = await start({ kind: "carousel", brief: "three mistakes new creators make", format: "carousel" });
    await drain();
    await pollUntil(id, () => false);
    const input = provider.inputs.find((item) => item.kind === "carousel") as { brand?: boolean };
    assert.equal("brand" in input, false);
  });
});

describe("a run for one of several offers", () => {
  const OFFERS = [{ offer: "1:1 coaching, four weeks of calls", keyword: "COACH" }];

  function withOffers(): void {
    const brand = agent.brand;
    agent.brand = async (userId, avatarId) => {
      const found = await brand(userId, avatarId);
      return found && { ...found, profile: { ...found.profile, offers: OFFERS } };
    };
  }

  async function startSaying(message: string, request: AgentRequest, requestId: string): Promise<string> {
    const input: AgentJobInput = { kind: "agent", message, request, reply: "On it." };
    return (await startJob(user(), { kind: "agent", avatarId: AVATAR_ID, requestId, input }, deps())).id;
  }

  test("hands the writer and the director the offer her message names", async () => {
    withOffers();
    const seen: { offer: string; keyword: string }[] = [];
    let keyword: string | null = null;
    const write = agent.write;
    agent.write = async (profile, options) => {
      seen.push({ offer: profile.offer, keyword: profile.keyword });
      return write(profile, options);
    };
    const direct = agent.direct;
    agent.direct = async (input) => {
      keyword = input.keyword;
      return direct(input);
    };
    const id = await startSaying("a reel for my coach offer", REEL, "req_coach");
    await drain();
    await poll(id);
    assert.deepEqual(seen, [{ offer: "1:1 coaching, four weeks of calls", keyword: "COACH" }]);
    assert.equal(keyword, "COACH");
  });

  test("keeps the default when her message names none", async () => {
    withOffers();
    const seen: string[] = [];
    const write = agent.write;
    agent.write = async (profile, options) => {
      seen.push(profile.keyword);
      return write(profile, options);
    };
    const id = await startSaying("a reel about my morning", REEL, "req_default");
    await drain();
    await poll(id);
    assert.deepEqual(seen, ["AVATAR"]);
  });

  test("tells the carousel job which offer her message named", async () => {
    withOffers();
    const id = await startSaying("a carousel about the weekly calls, COACH", { kind: "carousel", brief: "what changed in four weeks", format: "carousel" }, "req_coach_set");
    await drain();
    await pollUntil(id, () => false);
    const input = provider.inputs.find((item) => item.kind === "carousel") as { offer?: number };
    assert.equal(input.offer, 1);
  });
});

describe("her own words for the screen", () => {
  const SLIDES = ["How a post turns into a sale", "Someone stops on your reel.", "Comment CASH and I'll send it to you."];

  test("a set of her own slides goes to the render job word for word, with her keyword and no cover to pin", async () => {
    const id = await start({ kind: "carousel", brief: "how a post turns into a sale", format: "carousel", slides: 3, slideTexts: SLIDES, keyword: "CASH" });
    await drain();
    const planned = await record(id);
    const note = planned.input.state?.steps.find((step) => step.name === "plan")?.note ?? "";
    assert.match(note, /Your 3 slides, word for word/);
    await pollUntil(id, () => false);
    const input = provider.inputs.find((item) => item.kind === "carousel") as { slideTexts?: string[]; keyword?: string; coverTitle?: string; reference?: string };
    assert.deepEqual(input.slideTexts, SLIDES);
    assert.equal(input.keyword, "CASH");
    assert.equal(input.coverTitle, undefined);
    assert.equal(input.reference, undefined);
  });

  test("a set with nothing of hers sends no slides and no keyword, as before", async () => {
    const id = await start({ kind: "carousel", brief: "three mistakes new creators make", format: "carousel" });
    await drain();
    await pollUntil(id, () => false);
    const input = provider.inputs.find((item) => item.kind === "carousel") as object;
    assert.equal("slideTexts" in input, false);
    assert.equal("keyword" in input, false);
  });

  async function directKeyword(request: AgentRequest): Promise<{ cue: string; writer: string }> {
    let cue = "";
    let writer = "";
    const write = agent.write;
    agent.write = async (profile, options) => {
      writer = profile.keyword;
      return write(profile, options);
    };
    const direct = agent.direct;
    agent.direct = async (input) => {
      cue = input.keyword;
      return direct(input);
    };
    const id = await start(request);
    await drain();
    await poll(id);
    return { cue, writer };
  }

  test("a reel on her own hook offers the director no brand keyword to burn in", async () => {
    assert.deepEqual(await directKeyword({ ...REEL, hook: "Nobody needs to see your face" }), { cue: "", writer: "AVATAR" });
  });

  test("a reel with a keyword she named asks for hers, in the caption and the second line", async () => {
    assert.deepEqual(await directKeyword({ ...REEL, hook: "Nobody needs to see your face", keyword: "CASH" }), { cue: "CASH", writer: "CASH" });
  });

  test("a reel with nothing of hers keeps her brand's keyword, as before", async () => {
    assert.deepEqual(await directKeyword(REEL), { cue: "AVATAR", writer: "AVATAR" });
  });
});

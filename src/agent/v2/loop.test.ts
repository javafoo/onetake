/* The turn loop against a scripted model and fake tools: no network, no
 * database. What it proves: a turn streams words, runs tools and sends their
 * answers back with the model's own turn (signature kept); the playbooks reach
 * the model but not the thread; paid work starts only inside the budget she
 * stated and is otherwise offered; an offer tapped twice starts one job and is
 * counted once; a refused message is not kept; and a turn stops at six rounds. */

import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { ContentBlockedError, type Content, type FunctionCall, type TurnResult } from "@/ai/gemini";
import { memoryStore, type MemoryBillingStore } from "@/billing/store.memory";
import type { User } from "@/data/users";
import { startJobOnce, type JobDeps, type StartJobRequest } from "@/jobs";
import { memoryJobStore, type MemoryJobStore } from "@/jobs/store.memory";
import { InvalidRequestError, UserFacingError } from "@/lib/errors";


import { agentCredits } from "../plan";

import { MAX_ROUNDS, runTurn, slowMessage, type LoopDeps } from "./loop";
import { acceptOffer, declineOffer } from "./offers";
import { applyDelta, type ThreadState } from "./thread";
import { callRequestId, offerRequestId, statesNumber, type ToolDeps } from "./tools";
import type { TurnEvent } from "./types";

const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const AVATAR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PHOTO_PRICE = agentCredits({ kind: "photos", brief: "x", count: 1, mode: "one" });

const call = (name: string, args: Record<string, unknown> = {}, thoughtSignature?: string): FunctionCall => ({ name, args, ...(thoughtSignature ? { thoughtSignature } : {}) });

/** One scripted model round: words, calls, or both. */
type Step = { text?: string; calls?: FunctionCall[]; throws?: Error };

function scripted(steps: Step[]) {
  const seen: Content[][] = [];
  let i = 0;
  const generateTurn: LoopDeps["generateTurn"] = async (options) => {
    seen.push(structuredClone(options.contents));
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step.throws) throw step.throws;
    if (step.text) for (const piece of step.text.split(/(?<= )/)) options.onText?.(piece);
    const calls = step.calls ?? [];
    const result: TurnResult = {
      text: step.text ?? "",
      calls,
      content: {
        role: "model",
        parts: [
          ...(step.text ? [{ text: step.text }] : []),
          ...calls.map((c) => ({ functionCall: { name: c.name, args: c.args }, ...(c.thoughtSignature ? { thoughtSignature: c.thoughtSignature } : {}) })),
        ],
      },
    };
    return result;
  };
  return { generateTurn, seen, rounds: () => i };
}

function fakeTools(over: Partial<ToolDeps> = {}) {
  const started: StartJobRequest[] = [];
  let ids = 0;
  const tools: ToolDeps = {
    reference: async () => "REFERENCE block",
    memory: async () => ["She has two kids."],
    brand: async () => ({ niche: "slow mornings" }),
    library: async () => [],
    recentPosts: async () => [],
    writePost: async () => ({ draftId: "d1", hook: "h", caption: "c", cta: "Comment X" }),
    writeHooks: async ({ count }) => ({ hooks: Array.from({ length: count }, (_, n) => `hook ${n + 1}`), dropped: 0 }),
    ownMaterial: async (material) => material,
    addFact: async (text) => text,
    affordable: async () => {},
    saveLooks: async (images, requestId) => images.map((_, index) => `look-${requestId}-${index}`),
    startJob: async (request) => {
      started.push(request);
      return { jobId: `job-${started.length}`, created: true };
    },
    newId: () => `offer-${++ids}`,
    now: () => new Date("2026-10-06T09:00:00Z"),
    ...over,
  };
  return { tools, started };
}

const thread = (over: Partial<ThreadState> = {}): ThreadState => ({
  id: THREAD_ID,
  avatarId: AVATAR_ID,
  title: null,
  messages: [],
  budgetCredits: 0,
  spentCredits: 0,
  offers: [],
  lastRequestId: null,
  ...over,
});

function deps(generate: LoopDeps["generateTurn"], tools: ToolDeps, over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    generateTurn: generate,
    tools,
    profile: { niche: "slow mornings", audience: "tired mums", offer: "a guide", keyword: "SLOW", voice: "warm", proofPoints: [] },
    screen: async () => {},
    context: async (left) => `ABOUT HER. Budget left ${left}.`,
    ...over,
  };
}

const input = (message: string) => ({ message, requestId: "22222222-2222-4222-8222-222222222222", at: "2026-10-06T09:00:00.000Z" });

async function turn(d: LoopDeps, t: ThreadState, message: string) {
  const events: TurnEvent[] = [];
  const delta = await runTurn(d, t, input(message), (event) => events.push(event));
  return { events, delta };
}

describe("runTurn", () => {
  test("text, then a tool, then text: streamed in order, the answer sent back with the model's own turn", async () => {
    const model = scripted([
      { text: "Let me look. ", calls: [call("read_brand", {}, "SIG-1")] },
      { text: "Here are three hooks." },
    ]);
    const { tools } = fakeTools();
    const { events, delta } = await turn(deps(model.generateTurn, tools), thread(), "write me hooks");

    // Consecutive deltas collapsed: words, the tool line, words, done.
    const shape = events.map((event) => event.type).filter((type, i, all) => type !== all[i - 1]);
    assert.deepEqual(shape, ["text", "tool", "text", "done"]);
    assert.deepEqual(events.find((event) => event.type === "tool"), { type: "tool", label: "Reading your brand" });
    assert.equal(events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join(""), "Let me look. Here are three hooks.");
    assert.deepEqual(events.at(-1), { type: "done", threadId: THREAD_ID });

    // Round two saw round one's turn as Gemini returned it, signature and all, then the answer.
    const second = model.seen[1];
    const modelTurn = second[second.length - 2];
    assert.deepEqual(modelTurn.parts[1], { functionCall: { name: "read_brand", args: {} }, thoughtSignature: "SIG-1" });
    assert.match(JSON.stringify(second[second.length - 1]), /slow mornings/);
    // The first content is who she is; the system prompt holds no brand.
    assert.match(JSON.stringify(second[0]), /ABOUT HER/);

    assert.deepEqual(delta.messages.map((message) => message.role), ["her", "agent", "tool", "agent"]);
    const stored = delta.messages[2];
    assert.ok(stored.role === "tool" && stored.thoughtSignature === "SIG-1");
    assert.ok(!JSON.stringify(delta).includes("PLAYBOOK TEXT"), "the playbook text is not kept on the thread");
    assert.equal(delta.title, "write me hooks");
  });

  test("hooks: the writer gets the reference block and her memory, and the saved hooks come back", async () => {
    let got: { knowledge: string; memory: string[]; count: number } | null = null;
    const { tools } = fakeTools({
      writeHooks: async (args) => {
        got = args;
        return { hooks: ["a", "b", "c"], dropped: 0 };
      },
    });
    const model = scripted([{ calls: [call("write_hooks", { count: 3, topic: "slow mornings, curiosity gap" })] }, { text: "Saved three." }]);
    const { delta } = await turn(deps(model.generateTurn, tools), thread(), "three hooks");
    assert.deepEqual(got, { count: 3, topic: "slow mornings, curiosity gap", knowledge: "REFERENCE block", memory: ["She has two kids."] });
    assert.match(JSON.stringify(delta.messages[1]), /savedToHooksPage/);
  });

  test("a paid tool inside the budget starts the job under the thread's request id", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "at a café", count: 1 })] }, { text: "Started." }]);
    const { tools, started } = fakeTools();
    const { events, delta } = await turn(deps(model.generateTurn, tools), thread({ budgetCredits: 5 }), "make a photo of me at a café");
    assert.equal(started.length, 1);
    assert.equal(started[0].requestId, callRequestId(THREAD_ID, 1, 1));
    assert.equal(started[0].kind, "agent");
    assert.deepEqual(events.find((event) => event.type === "job"), { type: "job", jobId: "job-1", kind: "image", credits: PHOTO_PRICE });
    assert.equal(delta.spent, PHOTO_PRICE);
    assert.deepEqual(delta.messages.map((message) => message.role), ["her", "tool", "job", "agent"]);
  });

  test("over the budget it is offered, not started, and the model is told so", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "at a café", count: 1 })] }, { text: `That is ${PHOTO_PRICE} credit. Tap to make it.` }]);
    const { tools, started } = fakeTools();
    const { events, delta } = await turn(deps(model.generateTurn, tools), thread(), "make a photo of me at a café");
    assert.equal(started.length, 0);
    const offer = events.find((event) => event.type === "offer");
    assert.ok(offer && offer.type === "offer");
    assert.deepEqual(offer.offer, { id: "offer-1", label: "A photo: at a café", credits: PHOTO_PRICE, status: "open" });
    assert.ok(!("request" in offer.offer), "the stream never carries the job request");
    assert.equal(delta.offers.length, 1);
    assert.equal(delta.offers[0].request.requestId, offerRequestId(THREAD_ID, "offer-1"));
    assert.equal(delta.spent, 0);
    // The card carries the price and the button, so the reply is ours and the model is not asked again.
    assert.equal(model.rounds(), 1);
    assert.match(events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join(""), /Tap the button to start it/);
    assert.equal(delta.messages.at(-1)?.role, "agent");
  });

  test("a job that only starts is told to her without a second round of the model", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "at a café", count: 1 })] }, { text: "never asked" }]);
    const { tools } = fakeTools();
    const { events } = await turn(deps(model.generateTurn, tools), thread({ budgetCredits: 5 }), "make a photo of me at a café");
    assert.equal(model.rounds(), 1);
    assert.match(events.filter((event) => event.type === "text").map((event) => (event as { delta: string }).delta).join(""), /started your photo/);
  });

  test("recreate sends the pasted screenshot to the photo job as a look, for one photo", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "wavy loose hair", count: 3, recreate: true })] }, { text: "x" }]);
    const { tools, started } = fakeTools();
    const shot = { mimeType: "image/png", data: Buffer.from("png-bytes") };
    await runTurn(deps(model.generateTurn, tools), thread({ budgetCredits: 5 }), { ...input("recreate this"), images: [shot] }, () => {});
    assert.equal(started.length, 1);
    const request = (started[0].input as { request: { count: number; brief?: string; lookMediaIds?: string[] } }).request;
    assert.equal(request.count, 1);
    assert.equal(request.brief, "recreate this", "her own words, not the model's rewrite");
    assert.deepEqual(request.lookMediaIds, [`look-${callRequestId(THREAD_ID, 1, 1)}-0`]);
  });

  test("a swap recreate is made on Pro unless she named a model", async () => {
    const shot = { mimeType: "image/png", data: Buffer.from("png-bytes") };
    for (const [args, want] of [
      [{ idea: "x", recreate: true, recreateHow: "swap" }, "pro"],
      [{ idea: "x", recreate: true, recreateHow: "swap", model: "daily" }, "daily"],
      [{ idea: "x", recreate: true }, undefined],
    ] as const) {
      const model = scripted([{ calls: [call("make_photos", { ...args })] }, { text: "x" }]);
      const { tools, started } = fakeTools();
      await runTurn(deps(model.generateTurn, tools), thread({ budgetCredits: 9 }), { ...input("same photo, her face"), images: [shot] }, () => {});
      const request = (started[0].input as { request: { model?: string; lookMode?: string } }).request;
      assert.equal(request.model, want);
    }
  });

  test("recreate with no screenshot in the message is refused to the model, and nothing starts", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "x", recreate: true })] }, { text: "Paste it again." }]);
    const { tools, started } = fakeTools();
    await turn(deps(model.generateTurn, tools), thread({ budgetCredits: 5 }), "recreate this");
    assert.equal(started.length, 0);
    assert.match(JSON.stringify(model.seen[1].at(-1)), /no screenshot/i);
  });

  test("a refused call still goes back to the model, which has to say why", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "" })] }, { text: "Say what the photo shows." }]);
    await turn(deps(model.generateTurn, fakeTools().tools), thread({ budgetCredits: 5 }), "photo");
    assert.equal(model.rounds(), 2);
  });

  test("what a slow turn says depends on what already ran", () => {
    const base = { messages: [], offers: [], spent: 0 } as unknown as Parameters<typeof slowMessage>[0];
    assert.match(slowMessage(base), /Nothing was started/);
    assert.match(slowMessage({ ...base, messages: [{ role: "tool" }] } as never), /What is above is done/);
    assert.match(slowMessage({ ...base, offers: [{}] } as never), /offer above is ready/);
    assert.match(slowMessage({ ...base, messages: [{ role: "tool" }, { role: "job" }] } as never), /already running[\s\S]*don't send it again/i);
  });

  test("two paid calls in one round share the budget: the second is offered", async () => {
    const model = scripted([{ calls: [call("make_photos", { idea: "café" }), call("make_photos", { idea: "beach" })] }, { text: "ok" }]);
    const { tools, started } = fakeTools();
    const { delta } = await turn(deps(model.generateTurn, tools), thread({ budgetCredits: PHOTO_PRICE }), "two photos");
    assert.equal(started.length, 1);
    assert.equal(delta.offers.length, 1);
    assert.equal(delta.spent, PHOTO_PRICE);
  });

  test("a budget is set only from a number in her own message", async () => {
    const model = scripted([{ calls: [call("set_budget", { credits: 10 }), call("make_photos", { idea: "café" })] }, { text: "ok" }]);
    const { tools, started } = fakeTools();
    const { delta } = await turn(deps(model.generateTurn, tools), thread(), "spend up to 10 credits and make a café photo");
    assert.equal(delta.budget, 10);
    assert.equal(started.length, 1, "the photo came out of the budget she just set");

    const sneaky = scripted([{ calls: [call("set_budget", { credits: 50 })] }, { text: "ok" }]);
    const second = await turn(deps(sneaky.generateTurn, fakeTools().tools), thread(), "make lots of photos");
    assert.equal(second.delta.budget, undefined);
    assert.match(JSON.stringify(second.delta.messages[1]), /only set from a number she wrote/);
    assert.equal(statesNumber("about 1,200 credits", 1200), true);
  });

  test("a message the screen refuses is not kept and nothing the model said reaches her", async () => {
    /* The screen runs beside the first round, so the model may have answered
       already; its words were held back and are dropped with the message. */
    const model = scripted([{ text: "never" }]);
    const { events, delta } = await turn(
      deps(model.generateTurn, fakeTools().tools, {
        screen: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          throw new UserFacingError("That is not something we can make.");
        },
      }),
      thread(),
      "something not allowed",
    );
    assert.deepEqual(events, [{ type: "error", message: "That is not something we can make." }, { type: "done", threadId: THREAD_ID }]);
    assert.deepEqual(delta.messages, []);
    assert.equal(delta.title, undefined);
  });

  test("the first words wait for the screen, then come out in order, and her message is kept first", async () => {
    const model = scripted([{ text: "Here you go. " }]);
    let passed = false;
    const { events, delta } = await turn(
      deps(model.generateTurn, fakeTools().tools, {
        screen: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          passed = true;
        },
      }),
      thread(),
      "hooks please",
    );
    assert.equal(passed, true);
    assert.deepEqual(events, [{ type: "text", delta: "Here " }, { type: "text", delta: "you " }, { type: "text", delta: "go. " }, { type: "done", threadId: THREAD_ID }]);
    assert.equal(delta.messages[0].role, "her");
    assert.equal(delta.messages[1].role, "agent");
    assert.equal(delta.title, "hooks please");
  });

  test("the context is built for her message, and pasted screenshots ride on it once", async () => {
    const model = scripted([{ text: "I see a quote post." }]);
    const asked: string[] = [];
    const events: TurnEvent[] = [];
    const delta = await runTurn(
      deps(model.generateTurn, fakeTools().tools, {
        context: async (_left, message) => {
          asked.push(message);
          return "ABOUT HER. REFERENCE.";
        },
      }),
      thread(),
      { ...input("make my version of this"), images: [{ mimeType: "image/png", data: Buffer.from("png-bytes") }] },
      (event) => events.push(event),
    );
    assert.deepEqual(asked, ["make my version of this"]);
    const hers = model.seen[0][model.seen[0].length - 1];
    assert.equal(hers.role, "user");
    assert.deepEqual(hers.parts[1], { inlineData: { mimeType: "image/png", data: Buffer.from("png-bytes").toString("base64") } });
    // The thread keeps the count, never the picture.
    assert.deepEqual(delta.messages[0], { role: "her", text: "make my version of this", at: input("").at, requestId: input("").requestId, screenshots: 1 });
    assert.match(JSON.stringify(delta.messages[0]), /^(?!.*png-bytes)/);
  });

  test("a message Google refuses is dropped from the thread, so the next turn is not refused too", async () => {
    const model = scripted([{ throws: new ContentBlockedError("SAFETY", false) }]);
    const { events, delta } = await turn(deps(model.generateTurn, fakeTools().tools), thread(), "bad words");
    assert.equal(events[0].type, "error");
    assert.match((events[0] as { message: string }).message, /filter/);
    assert.deepEqual(delta.messages, []);
    assert.equal(delta.title, undefined);
  });

  test("a failure after work was done keeps the work and says so", async () => {
    // A read beside the start keeps a second round, which is the one that fails.
    const model = scripted([{ calls: [call("make_photos", { idea: "café" }), call("read_brand")] }, { throws: new Error("socket hang up") }]);
    const reported: unknown[] = [];
    const { events, delta } = await turn(deps(model.generateTurn, fakeTools().tools, { report: (error) => reported.push(error) }), thread({ budgetCredits: 5 }), "photo");
    assert.equal(events.at(-2)?.type, "error");
    assert.deepEqual(delta.messages.map((message) => message.role), ["her", "tool", "tool", "job"]);
    assert.equal(delta.spent, PHOTO_PRICE);
    assert.equal(reported.length, 1);
  });

  test("six rounds at most: the seventh call is never run", async () => {
    const model = scripted([{ calls: [call("read_brand")] }]);
    let reads = 0;
    const { tools } = fakeTools({
      brand: async () => {
        reads++;
        return {};
      },
    });
    const { events, delta } = await turn(deps(model.generateTurn, tools), thread(), "loop forever");
    assert.equal(model.rounds(), MAX_ROUNDS);
    assert.equal(reads, MAX_ROUNDS - 1);
    assert.match(JSON.stringify(events), /took more steps than one message allows/);
    assert.equal(delta.messages.at(-1)?.role, "agent");
  });

  test("a tool that fails tells the model, and the turn goes on", async () => {
    const model = scripted([{ calls: [call("words_on_photo", { photoMediaId: "p9", text: "Hello" })] }, { text: "That photo is not yours." }]);
    const { tools } = fakeTools({ ownMaterial: async () => { throw new InvalidRequestError("That photo is not in your library."); } });
    const { events, delta } = await turn(deps(model.generateTurn, tools), thread(), "put hello on p9");
    assert.match(JSON.stringify(model.seen[1].at(-1)), /not in your library/);
    assert.equal(events.at(-1)?.type, "done");
    assert.ok(!events.some((event) => event.type === "error"));
    assert.equal(delta.messages.length, 3);
  });
});

/* ---- Offers, against the real job machine on its memory stores ---------- */

const USER_ID = "user_v2_loop_test";
const user = (): User => ({
  id: USER_ID,
  email: "x@example.invalid",
  onboardedAt: null,
  freePhotoUsedAt: null,
  setupSeenAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe("offers", () => {
  let billing: MemoryBillingStore;
  let jobs: MemoryJobStore;
  let scheduled: number;
  let stored: ThreadState;
  let priced: number;

  beforeEach(() => {
    billing = memoryStore();
    jobs = memoryJobStore(() => billing.rows);
    scheduled = 0;
    priced = 0;
    billing.seedLedger({ userId: USER_ID, delta: 40, reason: "adjustment" });
  });

  const jobDeps = (): Partial<JobDeps> => ({ store: jobs, credits: billing.credits, schedule: () => void scheduled++, budgetUsd: () => 25, limits: async () => {} });
  const offerDeps = () => ({
    load: async () => stored,
    mutate: async (change: (thread: ThreadState) => ThreadState | null) => {
      const next = change(stored);
      if (next) stored = next;
      return stored;
    },
    affordable: async () => void priced++,
    startJob: async (request: StartJobRequest) => {
      const started = await startJobOnce(user(), request, jobDeps());
      return { jobId: started.view.id, created: started.created };
    },
    now: () => new Date(),
  });

  async function offered(): Promise<string> {
    const model = scripted([{ calls: [call("make_photos", { idea: "at a café" })] }, { text: "Tap to make it." }]);
    const { tools } = fakeTools();
    const { delta } = await turn(deps(model.generateTurn, tools), thread(), "make a photo of me at a café");
    stored = applyDelta(thread(), delta);
    return delta.offers[0].id;
  }

  test("accepted twice: one job, scheduled once, counted once, drawn once", async () => {
    const offerId = await offered();
    const first = await acceptOffer(offerDeps(), offerId);
    const second = await acceptOffer(offerDeps(), offerId);
    assert.equal(second.jobId, first.jobId);
    assert.equal(first.kind, "image");
    assert.equal(first.credits, PHOTO_PRICE);
    assert.equal(jobs.jobs.size, 1);
    assert.equal([...jobs.jobs.values()][0].requestId, offerRequestId(THREAD_ID, offerId));
    assert.equal(scheduled, 1);
    assert.equal(priced, 1, "the price is checked on the first tap only");
    assert.equal(stored.spentCredits, PHOTO_PRICE);
    assert.equal(stored.messages.filter((message) => message.role === "job").length, 1);
    assert.equal(stored.offers[0].status, "accepted");
  });

  test("a declined offer cannot be accepted, and declining twice changes nothing", async () => {
    const offerId = await offered();
    await declineOffer(offerDeps(), offerId);
    await declineOffer(offerDeps(), offerId);
    await assert.rejects(acceptOffer(offerDeps(), offerId), /said no/);
    assert.equal(jobs.jobs.size, 0);
    assert.equal(stored.offers[0].status, "declined");
  });

  test("an offer id that is not on the thread starts nothing", async () => {
    await offered();
    await assert.rejects(acceptOffer(offerDeps(), "someone-elses-offer"), /gone/);
    assert.equal(jobs.jobs.size, 0);
  });
});

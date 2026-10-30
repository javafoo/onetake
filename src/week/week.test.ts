import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ChildJobs } from "@/agent/step";
import type { BrandProfile, PostIdea } from "@/content/hooks";
import { memoryJobStore } from "@/jobs/store.memory";
import type { JobRecord, JobView } from "@/jobs/types";

import { readWeekForm } from "./form";
import { betterDraft, fitBudget, makeable, makeRequest, readPlan, readRelevance, readReview, readUnderstanding, topicOnly, writerBrief, type Format, type WeekJobInput } from "./plan";
import { weekStep, type WeekDeps } from "./step";
import { finishedMedia, weekView } from "./view";

const PRICES: Record<Format, number> = { reel: 8, carousel: 2, photo: 1 };

const PROFILE: BrandProfile = {
  niche: "pricing coaching for designers",
  audience: "freelance designers",
  offer: "a pricing call",
  keyword: "PRICE",
  voice: "warm, direct",
  proofPoints: [],
};

describe("reading what the models said", () => {
  test("understanding keeps only real facts and short queries", () => {
    const read = readUnderstanding({
      facts: [{ text: "A client raised her prices 40% after our call", kind: "win" }, { text: "", kind: "win" }, { text: "Launch email flopped", kind: "made-up" }],
      themes: ["raising prices"],
      queries: ["designers raising prices 2026", "freelance rates news", "a third query"],
    });
    assert.equal(read.facts.length, 2);
    assert.equal(read.facts[1].kind, "story");
    assert.equal(read.queries.length, 2);
  });

  test("a plan must stand on her facts and use real trend numbers", () => {
    const plan = readPlan(
      { posts: [{ format: "reel", angle: "Her client's raise", why: "Proof", facts: [0, 9], trend: 4 }, { format: "photo", angle: "No facts", why: "x", facts: [] }, { format: "tweet", angle: "a", why: "b", facts: [0] }] },
      2,
      1,
      PRICES,
      20,
    );
    assert.equal(plan.length, 1);
    assert.deepEqual(plan[0].facts, [0]);
    assert.equal(plan[0].trend, undefined);
  });

  test("over budget, the dearest posts go first", () => {
    const posts = [{ format: "reel" as const }, { format: "carousel" as const }, { format: "photo" as const }];
    assert.deepEqual(fitBudget(posts, PRICES, 4).map((post) => post.format), ["carousel", "photo"]);
    assert.deepEqual(fitBudget(posts, PRICES, 11).map((post) => post.format), ["reel", "carousel", "photo"]);
  });

  test("a review keeps a post only with a good score and no problems", () => {
    assert.equal(readReview({ score: 8, problems: [], note: "Strong" }).keep, true);
    assert.equal(readReview({ score: 9, problems: ["Invents a number"], note: "x" }).keep, false);
    assert.equal(readReview({ score: "high" }).score, 0);
  });
});

describe("judging", () => {
  test("the better draft is kept, and the first wins a tie", () => {
    const review = (score: number, invented: string[] = []) => ({ score, keep: false, problems: [], invented, note: "" });
    assert.equal(betterDraft({ idea: "a", review: review(8) }, { idea: "b", review: review(6) }).idea, "a");
    assert.equal(betterDraft({ idea: "a", review: review(5) }, { idea: "b", review: review(8) }).rewritten, true);
    assert.equal(betterDraft({ idea: "a", review: review(7) }, { idea: "b", review: review(7) }).idea, "a");
  });

  test("a draft with nothing invented beats a higher score with a made-up claim", () => {
    const review = (score: number, invented: string[] = []) => ({ score, keep: false, problems: [], invented, note: "" });
    assert.equal(betterDraft({ idea: "a", review: review(9, ["$200,000 in grants"]) }, { idea: "b", review: review(7) }).idea, "b");
    assert.equal(makeable(review(9, ["$200,000 in grants"])), false);
    assert.equal(makeable(review(6)), true);
  });

  test("an invented claim is also a problem, so a rewrite is asked for", () => {
    const read = readReview({ score: 9, invented: ["Up to $200,000 in grants"], problems: [], note: "Remove the grant." });
    assert.equal(read.keep, false);
    assert.deepEqual(read.problems, ["Up to $200,000 in grants"]);
  });

  test("a search result reaches the writer as a bare topic", () => {
    assert.equal(topicOnly("Down Payment Assistance Programs and Grants for First-Time Buyers | Zillow"), "Down Payment Assistance Programs and Grants for First-Time Buyers");
    assert.equal(topicOnly("Up to $200,000 in grants and a 10% boost - City news"), "Up to in grants and a boost");
  });

  test("only trends that really matter are kept, best first", () => {
    const trends = [0, 1, 2].map((i) => ({ title: `t${i}`, url: `https://x/${i}`, summary: "" }));
    const kept = readRelevance({ scores: [{ index: 0, score: 3 }, { index: 2, score: 9 }, { index: 1, score: 7 }, { index: 7, score: 10 }] }, trends);
    assert.deepEqual(kept.map((trend) => trend.title), ["t2", "t1"]);
  });
});

describe("making", () => {
  test("the reviewed hook is used word for word", () => {
    const idea: PostIdea = { hook: "She raised her prices 40%", angle: "", caption: "Caption", cta: "Comment PRICE" };
    const base = { angle: "Angle", why: "", facts: [0], status: "written" as const, mediaIds: [], idea };
    assert.equal((makeRequest({ ...base, format: "reel" }) as { hook?: string }).hook, idea.hook);
    assert.equal((makeRequest({ ...base, format: "carousel" }) as { cover?: string }).cover, idea.hook);
    assert.equal((makeRequest({ ...base, format: "photo" }) as { words?: string }).words, idea.hook);
  });

  test("the brief carries the facts, the trend and the editor's note", () => {
    const brief = writerBrief({ format: "photo", angle: "A", why: "", facts: [0], trend: 0 }, [{ text: "raised 40%", kind: "win" }], [{ title: "Rates survey", url: "https://x", summary: "Rates up" }], "Hook too vague.");
    assert.match(brief, /raised 40%/);
    assert.match(brief, /Rates survey/);
    assert.doesNotMatch(brief, /Rates up/);
    assert.match(brief, /Hook too vague/);
  });

  test("only the finished thing is shown", () => {
    assert.deepEqual(finishedMedia([{ id: "p", kind: "image" }, { id: "c", kind: "clip" }, { id: "r", kind: "reel" }]), [{ id: "r", video: true }]);
    assert.deepEqual(finishedMedia([{ id: "a", kind: "image" }, { id: "b", kind: "image" }]), [{ id: "b", video: false }]);
  });
});

describe("the start form", () => {
  test("typed notes need some substance", () => {
    const form = new FormData();
    form.set("notes", "busy week");
    assert.throws(() => readWeekForm(form), /Tell me a little more/);
  });

  test("the budget is capped", () => {
    const form = new FormData();
    form.set("notes", "word ".repeat(20));
    form.set("budget", "999");
    assert.equal(readWeekForm(form).budget, 30);
  });
});

describe("a whole week", () => {
  test("listens, plans, writes, rewrites what fails review, makes the posts, and spends only what they cost", async () => {
    const store = memoryJobStore();
    const input: WeekJobInput = { kind: "week", notes: "A client raised her prices 40% after our call. My launch email flopped.", budget: 12 };
    const { job } = await store.create({ userId: "u1", avatarId: "a1", kind: "week", requestId: "r1", input, credits: 0 });
    await store.transition({ userId: "u1", jobId: job.id, from: ["queued"], patch: { status: "running" } });

    let reviews = 0;
    const deps: WeekDeps = {
      brand: async () => ({ avatarId: "a1", profile: PROFILE }),
      transcribe: async () => "",
      async think<T>(options: { system: string }) {
        if (options.system.includes("content strategist")) {
          return { facts: [{ text: "A client raised her prices 40% after our call", kind: "win" }], themes: ["pricing"], queries: ["designer rates"] } as T;
        }
        if (options.system.includes("worth a solo founder's post")) {
          return { scores: [{ index: 0, score: 9 }] } as T;
        }
        if (options.system.includes("plan a solo founder")) {
          return { posts: [{ format: "reel", angle: "The raise", why: "Real proof", facts: [0], trend: 0 }, { format: "photo", angle: "Lesson", why: "Quick", facts: [0] }] } as T;
        }
        reviews += 1;
        // The first post's first draft fails; everything after passes.
        return (reviews === 1 ? { score: 4, problems: ["Hook is vague"], note: "Lead with the 40%." } : { score: 8, problems: [], note: "Good." }) as T;
      },
      modelName: (tier) => `nemotron-${tier}`,
      search: async () => ({ results: [{ title: "Designer rates rise", url: "https://news.example/rates", content: "Rates are up this year." }] }),
      write: async (_profile, options) => ({ hook: options.brief.includes("40%") && options.brief.includes("editor") ? "She raised her prices 40%" : "A pricing story", angle: "", caption: "c", cta: "Comment PRICE" }),
      remember: async () => undefined,
      prices: () => PRICES,
      spent: async (_userId, runId) => (runId === "child-1" ? 8 : 1),
    };

    const started: string[] = [];
    const views = new Map<string, JobView>();
    const children: ChildJobs = {
      async start(request) {
        started.push(request.requestId);
        const view = { id: `child-${started.length}`, kind: "agent", status: "running", error: null, mediaIds: [], message: null, credits: 0, creditsCharged: 0, creditsRefunded: 0, createdAt: "", updatedAt: "" } as JobView;
        views.set(view.id, view);
        return view;
      },
      async advance(id) {
        const view = views.get(id)!;
        return { ...view, status: "completed", mediaIds: [`${id}-media`], creditsCharged: id === "child-1" ? 8 : 1 };
      },
      async stop(id) {
        return views.get(id) ?? null;
      },
    };

    let step: Awaited<ReturnType<typeof weekStep>> = { done: false };
    for (let poll = 0; poll < 12 && !step.done; poll += 1) {
      const record = (await store.find("u1", job.id)) as JobRecord;
      step = await weekStep(record, record.input as WeekJobInput, { store, children, week: deps });
    }

    assert.ok(step.done && !("failed" in step), "the week finishes");
    const record = (await store.find("u1", job.id)) as JobRecord & { input: WeekJobInput };
    const view = weekView(record);
    assert.equal(view.posts.length, 2);
    assert.equal(view.posts[0].rewritten, true);
    assert.equal(view.posts[0].hook, "She raised her prices 40%");
    assert.equal(view.posts[0].trend?.url, "https://news.example/rates");
    assert.equal(view.posts.every((post) => post.status === "ready"), true);
    assert.deepEqual(started, [`${job.id}:post:0`, `${job.id}:post:1`]);
    assert.equal(view.creditsSpent, 9);
    assert.match(view.summary ?? "", /2 of 2 posts ready/);
  });
});

describe("holding back", () => {
  test("a post that still fails after its rewrite is not made, and nothing is spent on it", async () => {
    const store = memoryJobStore();
    const input: WeekJobInput = { kind: "week", notes: "A client raised her prices 40% after our call.", budget: 12 };
    const { job } = await store.create({ userId: "u1", avatarId: "a1", kind: "week", requestId: "r2", input, credits: 0 });
    await store.transition({ userId: "u1", jobId: job.id, from: ["queued"], patch: { status: "running" } });
    const deps: WeekDeps = {
      brand: async () => ({ avatarId: "a1", profile: PROFILE }),
      transcribe: async () => "",
      async think<T>(options: { system: string }) {
        if (options.system.includes("content strategist")) return { facts: [{ text: "A client raised her prices 40%", kind: "win" }], themes: [], queries: [] } as T;
        if (options.system.includes("plan a solo founder")) return { posts: [{ format: "photo", angle: "The raise", why: "Proof", facts: [0] }] } as T;
        return { score: 3, problems: ["Invents a statistic"], note: "Remove the made-up number." } as T;
      },
      modelName: (tier) => tier,
      search: async () => ({ results: [] }),
      write: async () => ({ hook: "h", angle: "", caption: "c", cta: "Comment PRICE" }),
      remember: async () => undefined,
      prices: () => PRICES,
      spent: async () => 0,
    };
    const started: string[] = [];
    const children: ChildJobs = {
      async start(request) { started.push(request.requestId); throw new Error("should not start"); },
      async advance() { return null; },
      async stop() { return null; },
    };
    let step: Awaited<ReturnType<typeof weekStep>> = { done: false };
    for (let poll = 0; poll < 12 && !step.done; poll += 1) {
      const record = (await store.find("u1", job.id)) as JobRecord;
      step = await weekStep(record, record.input as WeekJobInput, { store, children, week: deps });
    }
    const view = weekView((await store.find("u1", job.id)) as JobRecord & { input: WeekJobInput });
    assert.equal(started.length, 0);
    assert.equal(view.posts[0].status, "held");
    assert.equal(view.creditsSpent, 0);
    assert.match(view.summary ?? "", /held back/);
  });
});

describe("invented claims", () => {
  test("a post that keeps a made-up claim after its rewrite is held back, however well it scores", async () => {
    const store = memoryJobStore();
    const input: WeekJobInput = { kind: "week", notes: "A client raised her prices 40% after our call.", budget: 12 };
    const { job } = await store.create({ userId: "u1", avatarId: "a1", kind: "week", requestId: "r3", input, credits: 0 });
    await store.transition({ userId: "u1", jobId: job.id, from: ["queued"], patch: { status: "running" } });
    const deps: WeekDeps = {
      brand: async () => ({ avatarId: "a1", profile: PROFILE }),
      transcribe: async () => "",
      async think<T>(options: { system: string }) {
        if (options.system.includes("content strategist")) return { facts: [{ text: "A client raised her prices 40%", kind: "win" }], themes: [], queries: [] } as T;
        if (options.system.includes("plan a solo founder")) return { posts: [{ format: "photo", angle: "The raise", why: "Proof", facts: [0] }] } as T;
        return { score: 9, invented: ["Up to $200,000 in grants"], problems: [], note: "Remove the grant." } as T;
      },
      modelName: (tier) => tier,
      search: async () => ({ results: [] }),
      write: async () => ({ hook: "h", angle: "", caption: "c", cta: "Comment PRICE" }),
      remember: async () => undefined,
      prices: () => PRICES,
      spent: async () => 0,
    };
    const children: ChildJobs = {
      async start() { throw new Error("should not start"); },
      async advance() { return null; },
      async stop() { return null; },
    };
    let step: Awaited<ReturnType<typeof weekStep>> = { done: false };
    for (let poll = 0; poll < 12 && !step.done; poll += 1) {
      const record = (await store.find("u1", job.id)) as JobRecord;
      step = await weekStep(record, record.input as WeekJobInput, { store, children, week: deps });
    }
    const view = weekView((await store.find("u1", job.id)) as JobRecord & { input: WeekJobInput });
    assert.equal(view.posts[0].status, "held");
    assert.match(view.posts[0].error ?? "", /200,000/);
  });
});

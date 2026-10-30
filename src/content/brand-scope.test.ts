import assert from "node:assert/strict";
import { test } from "node:test";

import type { Brief } from "../brief/build";
import { accountLine } from "../agent/understand";
import { decideCue, directPrompt } from "../agent/direct";
import { resolveKit } from "../carousel/kits";
import { carouselPrompt, toSpec } from "../carousel/write";
import { checkSpec, describeProblems } from "../carousel/check";
import { carouselSpecSchema, type CarouselSpec } from "../carousel/spec";
import { brandFlag, genericAction, rememberedLines, writerBrief, writerProfile } from "./brand-scope";
import { factCheckPrompt, templatePrompt, writerPrompt, type BrandProfile, type PostIdea } from "./hooks";
import { photoWordsPrompt } from "./photo-quote";

/* Every string here is one no real prompt would contain, so finding one in
   a brand-off prompt can only mean the profile leaked into it. */
const SENTINEL = {
  niche: "SENTINEL-NICHE-zq1",
  audience: "SENTINEL-AUDIENCE-zq2",
  offer: "SENTINEL-OFFER-zq3",
  keyword: "SENTINELKWzq4",
  voice: "SENTINEL-VOICE-zq5",
  story: "SENTINEL-STORY-zq6",
  proof: "SENTINEL-PROOF-zq7 285K followers",
  winner: "SENTINEL-WINNER-zq8",
  brief: "SENTINEL-BRIEF-zq9",
  memory: "SENTINEL-MEMORY-zq10 she ran 3 marathons",
};

/** What the agent remembers about her: brand, like her story. */
const MEMORY = [SENTINEL.memory];

const PROFILE: BrandProfile = {
  personaName: "Mia",
  story: SENTINEL.story,
  niche: SENTINEL.niche,
  audience: SENTINEL.audience,
  offer: SENTINEL.offer,
  keyword: SENTINEL.keyword,
  voice: SENTINEL.voice,
  proofPoints: [SENTINEL.proof],
  winners: [SENTINEL.winner],
};

const item = (text: string) => ({ text, source: "user" });
const BRIEF = {
  oneLiner: item(SENTINEL.brief),
  audience: [item(SENTINEL.brief)],
  problem: [item(SENTINEL.brief)],
  offer: [item(SENTINEL.brief)],
  pointOfView: [item(SENTINEL.brief)],
  proof: [item(SENTINEL.brief)],
  positioningLines: [item(SENTINEL.brief)],
  story: { before: item(SENTINEL.brief), turn: item(SENTINEL.brief), after: item(SENTINEL.brief) },
} as unknown as Brief;

const POST: PostIdea = { hook: "Winter arc starts now", angle: "habits", caption: "Five habits.", cta: "Save this." };
const TEMPLATE = "My name is Jess\nI used ChatGPT\n\nNow I have 285K followers";

/** Every writer and checker prompt, rendered for one profile. */
function everyPrompt(profile: BrandProfile, brief: Brief | null): Record<string, string> {
  const kit = resolveKit("signal");
  const carousel = (layout?: "photos" | "split" | "grid") =>
    carouselPrompt({ topic: "winter arc: 5 habits to start before January", profile, brief, kit, skeleton: "list", format: "carousel", layout, name: "t", photoRefs: ["p1"], memory: MEMORY });
  const join = ({ system, prompt }: { system: string; prompt: string }) => `${system}\n${prompt}`;
  return {
    hooks: join(writerPrompt(profile, 5, { memory: MEMORY })),
    hooksReel: join(writerPrompt(profile, 1, { visual: true, brief: "winter arc", style: "bold", places: ["her kitchen"], memory: MEMORY })),
    hooksTalking: join(writerPrompt(profile, 1, { visual: true, format: "talking", talkingSeconds: 8, brief: "winter arc", memory: MEMORY })),
    hooksTemplate: join(writerPrompt(profile, 1, { visual: true, template: TEMPLATE, memory: MEMORY })),
    hooksReference: join(writerPrompt(profile, 1, { reference: TEMPLATE, memory: MEMORY })),
    template: templatePrompt(TEMPLATE, profile),
    factCheck: join(factCheckPrompt(profile, [POST], false, MEMORY)),
    factCheckAdapted: join(factCheckPrompt(profile, [POST], true, MEMORY)),
    carousel: join(carousel()),
    carouselPhotos: join(carousel("photos")),
    carouselSplit: join(carousel("split")),
    carouselGrid: join(carousel("grid")),
    reader: accountLine(profile),
    director: directPrompt({ post: POST, keyword: profile.keyword, request: { kind: "reel", brief: "winter arc", footage: "auto", cue: "auto", talking: false }, library: [] }),
    photoWords: photoWordsPrompt(profile, "a funny winter quote"),
  };
}

test("brand on: the helper hands back her whole profile and brief", () => {
  assert.equal(writerProfile(PROFILE, true), PROFILE);
  assert.equal(writerBrief(BRIEF, true), BRIEF);
});

test("brand off: the helper returns nothing brand-specific, only her name", () => {
  const off = writerProfile(PROFILE, false);
  assert.deepEqual(off, { personaName: "Mia", niche: "", audience: "", offer: "", keyword: "", voice: "", proofPoints: [], winners: [], brandOff: true });
  assert.equal(writerBrief(BRIEF, false), null);
  const text = JSON.stringify(off);
  for (const sentinel of Object.values(SENTINEL)) assert.ok(!text.includes(sentinel), sentinel);
});

test("the flag as it travels: only an explicit false is off", () => {
  assert.equal(brandFlag(undefined), true);
  assert.equal(brandFlag(true), true);
  assert.equal(brandFlag("false"), true);
  assert.equal(brandFlag(false), false);
});

test("brand off: no writer or checker prompt carries her niche, audience, offer, keyword, voice, story, proof, winners or brief", () => {
  const prompts = everyPrompt(writerProfile(PROFILE, false), writerBrief(BRIEF, false));
  for (const [name, text] of Object.entries(prompts)) {
    for (const [field, sentinel] of Object.entries(SENTINEL)) {
      assert.ok(!text.includes(sentinel), `${name} leaks the ${field}`);
    }
    // Nor the house examples about avatars and selling: the founder's case is a post about anything else.
    assert.doesNotMatch(text, /\bAI avatar\b|built an avatar|comment the (?:exact )?keyword/i, `${name} still talks about her product or a keyword`);
  }
});

test("brand on: the same prompts do carry her brand, so the test above can fail", () => {
  const prompts = everyPrompt(PROFILE, BRIEF);
  for (const name of ["hooks", "carousel", "reader", "director", "factCheck"]) assert.ok(prompts[name].includes(SENTINEL.offer) || prompts[name].includes(SENTINEL.keyword) || prompts[name].includes(SENTINEL.story), name);
  assert.ok(prompts.carousel.includes(SENTINEL.brief));
  assert.ok(prompts.photoWords.includes(SENTINEL.voice));
});

test("brand off: the claims rules get stricter, not looser", () => {
  const off = writerProfile(PROFILE, false);
  assert.match(writerPrompt(off, 1).system, /No numbers about her and no results/);
  assert.match(writerPrompt(off, 1).system, /save the post, share it with a friend, or follow/);
  assert.match(factCheckPrompt(off, [POST]).system, /nothing personal about her is supported/);
  assert.match(templatePrompt(TEMPLATE, off), /kept as it is/);
  assert.match(templatePrompt(TEMPLATE, off), /Another person's name: leave it out/);
});

function spec(slides: unknown[], layout = "mixed"): CarouselSpec {
  return carouselSpecSchema.parse({ version: 1, name: "winter-arc", format: "carousel", layout, caption: "Save this for January.", slides });
}

const SLIDES = [
  { type: "cover", photo: "p1", title: { lines: ["Winter arc"] }, sub: "Five habits, starting with the first one →" },
  { type: "paper", title: { lines: ["Wake early"] }, body: "The day is quieter before anyone needs you. But what do you do with it?" },
  { type: "paper", title: { lines: ["Move daily"] }, body: "Ten minutes counts more than a plan you never start. So where does it fit?" },
  { type: "paper", title: { lines: ["Read more"] }, body: "Pages beat scrolling for a calmer head. What about the evenings?" },
];

test("brand off: the carousel's last slide asks to save, share or follow, never for her keyword", () => {
  const off = writerProfile(PROFILE, false);
  const draft = {
    caption: "Save this for January.",
    slides: [
      { type: "cover", titleLines: ["Winter arc"], sub: "Five habits, starting with the first one →" },
      { type: "keyword", keyword: "Share", promise: "Send it to the friend starting with you." },
    ],
  };
  const made = toSpec(draft, { photoRefs: ["p1"], profile: off, name: "t", format: "carousel" }) as { slides: { type: string; keyword?: string; action?: string }[] };
  assert.deepEqual(made.slides[1], { type: "keyword", keyword: "SHARE", promise: "Send it to the friend starting with you.", action: "share" });
  // A writer that slipped back to a comment keyword still gets a generic ask.
  const slipped = toSpec({ ...draft, slides: [draft.slides[0], { type: "keyword", keyword: "AVATAR", promise: "Keep it." }] }, { photoRefs: ["p1"], profile: off, name: "t", format: "carousel" }) as { slides: { keyword?: string; action?: string }[] };
  assert.equal(slipped.slides[1].action, "save");
  assert.equal(slipped.slides[1].keyword, "SAVE");

  const withAction = spec([...SLIDES, { type: "keyword", keyword: "SAVE", promise: "Keep it for the first week of January.", action: "save" }]);
  assert.deepEqual(checkSpec(withAction, { profile: off }).filter((problem) => problem.rule.startsWith("keyword") || problem.rule === "final-action"), []);
  const withKeyword = spec([...SLIDES, { type: "keyword", keyword: "AVATAR", promise: "Comment for the guide." }]);
  assert.ok(checkSpec(withKeyword, { profile: off }).some((problem) => problem.rule === "keyword-word"));
  // A saved brand-off set re-checked with her brand on is not told to use her keyword.
  assert.deepEqual(checkSpec(withAction, { profile: PROFILE }).filter((problem) => problem.rule.startsWith("keyword")), []);
});

test("the generic action a writer named is read loosely", () => {
  assert.equal(genericAction("SAVE"), "save");
  assert.equal(genericAction("saves"), "save");
  assert.equal(genericAction("Follow for more"), "follow");
  assert.equal(genericAction("AVATAR"), null);
  assert.equal(genericAction(undefined), null);
});

test("brand off: the director's Comment cue is dropped, other cues stay", () => {
  assert.deepEqual(decideCue("Comment WINTER", "It asks.", "auto", ""), { cue: null, noCueWhy: "Written without your brand, so there is no keyword to comment." });
  assert.deepEqual(decideCue("Comment WINTER", "It asks.", "yes", "").cue, { text: "Read the caption", why: "You asked for a second line." });
  assert.equal(decideCue("Read the caption", "It asks.", "auto", "").cue?.text, "Read the caption");
  // With her brand on, her keyword cue is hers to have.
  assert.equal(decideCue("Comment AVATAR", "It asks.", "auto", "AVATAR").cue?.text, "Comment AVATAR");
});

test("memory: her remembered facts follow the profile lines in both writers, one Remembered line each", () => {
  const hooks = writerPrompt(PROFILE, 1, { memory: ["She has two kids.", "  She lives   in Lisbon. "] }).prompt;
  assert.match(hooks, /Voice: SENTINEL-VOICE-zq5[\s\S]*Remembered: She has two kids\.\nRemembered: She lives in Lisbon\./);
  const carousel = everyPrompt(PROFILE, BRIEF).carousel;
  assert.ok(carousel.includes(`Remembered: ${SENTINEL.memory}`));
  assert.ok(carousel.indexOf(`Remembered: ${SENTINEL.memory}`) > carousel.indexOf("Proof points allowed"), "after the profile lines");
  assert.deepEqual(rememberedLines(PROFILE, ["", "  "]), []);
  assert.deepEqual(rememberedLines(writerProfile(PROFILE, false), ["She has two kids."]), [], "brand off: nothing remembered");
});

test("memory: no memory leaves the writer prompts exactly as they were", () => {
  assert.equal(writerPrompt(PROFILE, 1, { memory: [] }).prompt, writerPrompt(PROFILE, 1).prompt);
  assert.doesNotMatch(writerPrompt(PROFILE, 1).prompt, /Remembered:/);
  assert.equal(factCheckPrompt(PROFILE, [POST], false, []).prompt, factCheckPrompt(PROFILE, [POST]).prompt);
});

test("memory: the fact-checker counts remembered facts as allowed ground", () => {
  const { prompt } = factCheckPrompt(PROFILE, [POST], false, ["She ran 3 marathons in 2025."]);
  assert.match(prompt, /ALLOWED GROUND: WHAT SHE TOLD US[^\n]*supported\)\nRemembered: She ran 3 marathons in 2025\./);
  assert.ok(prompt.indexOf("WHAT SHE TOLD US") < prompt.indexOf("DRAFTS"));
});

test("both checkers are told a REFERENCE block is technique and its numbers are not her proof", () => {
  const rule = /block headed REFERENCE is writing technique[^.]*never her proof/;
  assert.match(factCheckPrompt(PROFILE, [POST]).system, rule);
  assert.match(factCheckPrompt(writerProfile(PROFILE, false), [POST]).system, rule);
  const counted = spec([...SLIDES.slice(0, 3), { type: "paper", title: { lines: ["Read more"] }, body: "I read 47 books this way. What about the evenings?" }, { type: "keyword", keyword: "SENTINELKWZQ4", promise: "Comment for the list." }]);
  const problems = checkSpec(counted, { profile: PROFILE });
  assert.ok(problems.some((problem) => problem.rule === "unsupported-number"));
  assert.match(describeProblems(problems), rule);
  assert.doesNotMatch(describeProblems([{ slide: 1, rule: "body-length", detail: "too long" }]), rule, "only when a number was caught");
});

test("memory: checkSpec takes a number from a remembered fact, never with the brand off", () => {
  const counted = spec([...SLIDES.slice(0, 3), { type: "paper", title: { lines: ["Read more"] }, body: "I read 47 books this way. What about the evenings?" }, { type: "keyword", keyword: "SENTINELKWZQ4", promise: "Comment for the list." }]);
  const numbers = (problems: ReturnType<typeof checkSpec>) => problems.filter((problem) => problem.rule === "unsupported-number" && problem.detail.includes("(47)"));
  assert.equal(numbers(checkSpec(counted, { profile: PROFILE })).length, 1);
  assert.deepEqual(numbers(checkSpec(counted, { profile: PROFILE, memory: ["She read 47 books last year."] })), []);
  assert.equal(numbers(checkSpec(counted, { profile: writerProfile(PROFILE, false), memory: ["She read 47 books last year."] })).length, 1);
});

/* The house knowledge (docs/AGENT-V2.md 3.4) is craft, not brand: with the
   brand off it still reaches every writer, while her memory and her approved
   posts stay out (`writerContext`). */
const KNOWLEDGE = "REFERENCE (technique, not facts about her; never quote it, never take a number from it as her claim)\n\n[Playbook > Hooks]\nOpen on the gap.";

test("knowledge: brand off still gets the house knowledge, after the profile lines, and no memory", () => {
  const off = writerProfile(PROFILE, false);
  const hooks = writerPrompt(off, 1, { knowledge: KNOWLEDGE, memory: MEMORY }).prompt;
  assert.ok(hooks.includes(KNOWLEDGE));
  assert.ok(hooks.indexOf(KNOWLEDGE) > hooks.indexOf("written without her brand"), "after the profile lines");
  assert.ok(!hooks.includes(SENTINEL.memory), "no memory with the brand off");

  const kit = resolveKit("signal");
  const carousel = carouselPrompt({ topic: "winter arc", profile: off, brief: null, kit, skeleton: "list", format: "carousel", name: "t", photoRefs: ["p1"], knowledge: KNOWLEDGE, memory: MEMORY }).prompt;
  assert.ok(carousel.includes(KNOWLEDGE));
  assert.ok(carousel.indexOf(KNOWLEDGE) > carousel.indexOf("written without her brand"));
  assert.ok(!carousel.includes(SENTINEL.memory));

  const words = photoWordsPrompt(off, "a funny winter quote", KNOWLEDGE);
  assert.ok(words.endsWith(KNOWLEDGE));
  for (const value of Object.values(SENTINEL)) {
    for (const prompt of [hooks, carousel, words]) assert.ok(!prompt.includes(value), `brand off leaked ${value}`);
  }
});

test("knowledge: brand on puts it right after her remembered facts", () => {
  const hooks = writerPrompt(PROFILE, 1, { knowledge: KNOWLEDGE, memory: MEMORY }).prompt;
  assert.ok(hooks.indexOf(`Remembered: ${SENTINEL.memory}`) < hooks.indexOf(KNOWLEDGE));
});

test("knowledge: empty or blank leaves every writer prompt exactly as it was", () => {
  const kit = resolveKit("signal");
  const base = { topic: "winter arc", profile: PROFILE, brief: null, kit, skeleton: "list" as const, format: "carousel" as const, name: "t", photoRefs: ["p1"] };
  for (const knowledge of ["", "  \n "]) {
    assert.equal(writerPrompt(PROFILE, 1, { knowledge }).prompt, writerPrompt(PROFILE, 1).prompt);
    assert.equal(carouselPrompt({ ...base, knowledge }).prompt, carouselPrompt(base).prompt);
    assert.equal(photoWordsPrompt(PROFILE, "a quote", knowledge), photoWordsPrompt(PROFILE, "a quote"));
  }
});

test("knowledge: the reference block follows the profile and memory lines, and nothing changes without it", () => {
  const block = "REFERENCE (technique, not facts about her; never quote it, never take a number from it as her claim)\n\n[Playbook > Hooks]\nOpen a gap.";
  const prompt = writerPrompt(PROFILE, 1, { memory: ["She has two kids."], knowledge: block }).prompt;
  assert.ok(prompt.includes(block));
  assert.ok(prompt.indexOf(block) > prompt.indexOf("Remembered: She has two kids."), "after the remembered lines");
  assert.ok(prompt.indexOf(block) > prompt.indexOf("Voice: SENTINEL-VOICE-zq5"), "after the profile lines");
  assert.equal(writerPrompt(PROFILE, 1, { knowledge: "  " }).prompt, writerPrompt(PROFILE, 1).prompt);
});

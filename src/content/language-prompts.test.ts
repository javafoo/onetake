import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { decideCue, directPrompt } from "../agent/direct";
import { secondLineText } from "../agent/second-line";
import { resolveKit } from "../carousel/kits";
import { askText } from "../carousel/spec";
import { topicsKey } from "../carousel/topics";
import { carouselPrompt, toSpec } from "../carousel/write";
import type { ModelCall } from "../onboarding/lock";
import { writerProfile } from "./brand-scope";
import { factCheckPrompt, templatePrompt, writerPrompt, type BrandProfile, type PostIdea } from "./hooks";
import { talkingPrompt, spokenWords, talkingSeconds } from "./motion";
import { photoWordsPrompt, writePhotoWords } from "./photo-quote";

/* Proof that English did not move. Every prompt a writer builds, and every
   word the app puts on screen for her, is rendered here for an English
   profile and hashed. The hashes were taken from the branch before the
   content language existed (`next` at 0750352, and still the same at
   14b6dd5 after Storyboard), so a change to any English prompt, however
   small, fails this file. A deliberate change to a prompt
   updates its hash here, in the same commit, where a reviewer sees it. */

const PROFILE: BrandProfile = {
  personaName: "Mia",
  story: "I posted for a year to nobody. Then I built an avatar and post every day.",
  niche: "Faceless Instagram",
  audience: "Women who hate being on camera",
  offer: "The 7-day starter kit",
  keyword: "AVATAR",
  voice: "Warm, direct, a little dry",
  proofPoints: ["12,000 followers in 5 months"],
  winners: ["I deleted my account twice before this worked"],
};
const POST: PostIdea = { hook: "Nobody tells you this", angle: "habits", caption: "Five habits.", cta: "Comment AVATAR." };
const TEMPLATE = "My name is Jess\nI used ChatGPT\n\nNow I have 285K followers";

type Call = { prompt: string; system?: string };
function capture(reply: unknown): { model: ModelCall; calls: Call[] } {
  const calls: Call[] = [];
  const model = (async (options: Call) => {
    calls.push(options);
    return reply;
  }) as ModelCall;
  return { model, calls };
}

/** Every English prompt and on-screen word this job touched, by name. */
async function englishPrompts(profile: BrandProfile): Promise<Record<string, string>> {
  const join = ({ system, prompt }: { system: string; prompt: string }) => `${system}\n---\n${prompt}`;
  const kit = resolveKit("signal");
  const carousel = (layout?: "photos" | "split" | "grid", p: BrandProfile = profile) =>
    join(carouselPrompt({ topic: "5 habits before January", profile: p, brief: null, kit, skeleton: "list", format: "carousel", layout, name: "t", photoRefs: ["p1"] }));
  const off = writerProfile(profile, false);

  const words = capture({ words: "A line" });
  await writePhotoWords(profile, "a funny winter quote", words.model as never);

  const spec = toSpec(
    { caption: "Comment AVATAR", slides: [{ type: "cover", titleLines: ["A"], sub: "b" }, { type: "keyword", keyword: "AVATAR", promise: "p" }] },
    { photoRefs: ["p1"], profile, name: "t", format: "carousel" },
  );

  return {
    hooks: join(writerPrompt(profile, 5)),
    hooksReel: join(writerPrompt(profile, 1, { visual: true, brief: "winter arc", style: "bold", places: ["her kitchen"] })),
    hooksTalking: join(writerPrompt(profile, 1, { visual: true, format: "talking", talkingSeconds: 8, brief: "winter arc" })),
    hooksTalking12: join(writerPrompt(profile, 1, { visual: true, format: "talking", talkingSeconds: 12 })),
    hooksExact: join(writerPrompt(profile, 1, { hook: "My exact hook" })),
    hooksTemplate: join(writerPrompt(profile, 1, { visual: true, template: TEMPLATE })),
    hooksOff: join(writerPrompt(off, 1, { visual: true, style: "serif" })),
    template: templatePrompt(TEMPLATE, profile),
    factCheck: join(factCheckPrompt(profile, [POST])),
    factCheckAdapted: join(factCheckPrompt(profile, [POST], true)),
    factCheckOff: join(factCheckPrompt(off, [POST])),
    carousel: carousel(),
    carouselPhotos: carousel("photos"),
    carouselSplit: carousel("split"),
    carouselGrid: carousel("grid"),
    carouselOff: carousel(undefined, off),
    director: directPrompt({ post: POST, keyword: profile.keyword, request: { kind: "reel", brief: "winter arc", footage: "auto", cue: "auto", talking: false }, library: [] }),
    photoWords: photoWordsPrompt(profile, "a funny winter quote"),
    photoWordsSystem: words.calls[0]?.system ?? "",
    talking: talkingPrompt("“You do not need to show your face.”"),
    spoken: JSON.stringify([spokenWords(8), spokenWords(12), spokenWords(10), talkingSeconds("one two three four five six seven eight nine ten eleven twelve")]),
    topicsKey: topicsKey(profile),
    spec: JSON.stringify(spec),
    asks: JSON.stringify([askText({ keyword: "AVATAR" }), askText({ keyword: "SAVE", action: "save" }), askText({ keyword: "FOLLOW", action: "follow" })]),
    secondLines: JSON.stringify([secondLineText({ kind: "caption" }), secondLineText({ kind: "comment", word: "guide" }), secondLineText({ kind: "own", text: "Mine" })]),
    cues: JSON.stringify([decideCue("", "", "yes"), decideCue("Comment AVATAR", "why", "auto", "")]),
  };
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);

/* Taken on `next` at 0750352, before this work, with the same inputs. */
const BEFORE: Record<string, string> = {
  hooks: "d278932117aac483",
  hooksReel: "2e42f0a73f6fe533",
  hooksTalking: "3414587263786fc2",
  hooksTalking12: "5be5f36f17d0f747",
  hooksExact: "fcd8b4544c910367",
  hooksTemplate: "59a0e6c09d029207",
  hooksOff: "585e8a477012e72b",
  template: "fd73fa5ed8da1699",
  /* Agent v2 P3, deliberately: both fact-checkers gained one sentence saying a
     REFERENCE block is technique and its numbers are not her proof. */
  factCheck: "948d0f9ba2884451",
  factCheckAdapted: "56bdc33738e1333f",
  factCheckOff: "ac56c05fb563b4c1",
  carousel: "de98c09f152c88af",
  carouselPhotos: "044a3d238644a591",
  carouselSplit: "bfef5b2c0005e002",
  carouselGrid: "b17ccd147891ce20",
  carouselOff: "6b1348b23928966f",
  director: "97262a56826f8773",
  photoWords: "44c38955268d27f4",
  photoWordsSystem: "1a0ec97053e7d80d",
  talking: "35d7d8a4e77f5573",
  spoken: "d259257bfcff5489",
  topicsKey: "4c731a47bdfb4196",
  spec: "5d811486eaf7b6cc",
  asks: "34f49d71d6d5afa6",
  secondLines: "5667c4e1cbcfe859",
  cues: "995d86318b1f3f85",
};

test("English prompts and on-screen words are byte for byte what they were before languages existed", async () => {
  const now = await englishPrompts(PROFILE);
  assert.deepEqual(Object.keys(now).sort(), Object.keys(BEFORE).sort());
  for (const [name, text] of Object.entries(now)) assert.equal(hash(text), BEFORE[name], `${name} changed for English`);
});

test("every captured prompt is a real prompt, not an empty capture", async () => {
  for (const [name, text] of Object.entries(await englishPrompts(PROFILE))) {
    assert.ok(text.length > 20 && !text.includes("undefined"), name);
  }
});

test("a profile that says English is the same as one that says nothing", async () => {
  const plain = await englishPrompts(PROFILE);
  for (const language of ["en", "EN", " en ", "xx", "", "ar"]) {
    assert.deepEqual(await englishPrompts({ ...PROFILE, language }), plain, `language "${language}"`);
  }
});

/* Agent v2 (docs/AGENT-V2.md 3.4, 3.6): every writer takes reference
   material and memory, and inserts them only when there is some. A writer
   handed none, the way a retrieval that failed or found nothing hands them,
   must hash as above. */
test("no knowledge and no memory leave the English prompts on the hashes above", () => {
  const kit = resolveKit("signal");
  const set = { topic: "5 habits before January", profile: PROFILE, brief: null, kit, skeleton: "list" as const, format: "carousel" as const, name: "t", photoRefs: ["p1"] };
  const join = ({ system, prompt }: { system: string; prompt: string }) => `${system}\n---\n${prompt}`;
  const empty = { knowledge: "", memory: [] };
  assert.equal(hash(join(writerPrompt(PROFILE, 5, empty))), BEFORE.hooks);
  assert.equal(hash(join(carouselPrompt({ ...set, ...empty }))), BEFORE.carousel);
  assert.equal(hash(photoWordsPrompt(PROFILE, "a funny winter quote", "")), BEFORE.photoWords);
});

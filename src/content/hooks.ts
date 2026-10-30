import { generateText } from "../ai/text";
import { tidyGlyphs } from "../reel/glyphs";
import { countWords, LONGEST_SECONDS, MAX_SECONDS, MIN_SECONDS, TARGET_SECONDS, WORDS_PER_SECOND, HOLD_SECONDS } from "../reel/timing";
import type { ShotType } from "../style/house-style";
import { brandOff, REFERENCE_IS_TECHNIQUE, rememberedLines } from "./brand-scope";
import { contentLanguage, withLanguage, widenLimit } from "./languages";
import { MAX_BEATS, MAX_TALKING_SECONDS, spokenWords } from "./motion";
import { SCENE_GROUPS } from "./scene-library";
import type { TextStyle } from "./text-styles";

/* Text generation sits behind this one function so the provider can change
   (Gemini today) without touching callers. */

/** One thing she sells and the word people comment to get it. */
export type Offer = { offer: string; keyword: string };

export type BrandProfile = {
  /** The persona's name and her canon story, agreed once during avatar setup.
      It is the only source of personal history the writer may draw on. */
  personaName?: string;
  story?: string;
  niche: string;
  audience: string;
  offer: string;
  /** The single comment keyword that triggers the DM / points to the link in bio. */
  keyword: string;
  /**
   * Her other offers, each with its own keyword. `offer` and `keyword` above
   * are the default one. Read through ./offers.ts, never raw: the row is json.
   */
  offers?: Offer[];
  /**
   * The colour her comment keyword is drawn in on reels and carousels, as
   * #rrggbb. Absent: the text look's own colour, as before it existed. Read
   * through `keywordColorOf` in ./keyword-color.ts.
   */
  keywordColor?: string;
  voice: string;
  /**
   * Where a link sticker in her stories points. Absent, stories point to the
   * comment keyword instead. Checked to be an http(s) URL when it is saved.
   */
  link?: string;
  /** The offer pays her a commission: a story frame with a link says so. */
  affiliate?: boolean;
  /** Only these facts may be used as proof. The writer must not invent numbers. */
  proofPoints: string[];
  /** Hooks that already performed: the writer reuses their shape, not their words. */
  winners?: string[];
  /**
   * The language her posts are written in, as a code from ./languages.ts.
   * Absent is English. Read it through `contentLanguage`, never raw: the row
   * is json and may hold anything.
   */
  language?: string;
  /**
   * Set only by `writerProfile` in ./brand-scope.ts, never stored: this
   * request is written without her brand, so every brand field above is
   * empty and the writers use their stricter no-brand rules.
   */
  brandOff?: boolean;
};

/* The b-roll a post wants. The scene is a rough idea in the form the photo
   prompt writer takes; the motion is what the clip does under the hook. */
export type Visual = {
  scene: string;
  shot: ShotType;
  motion: string;
};

export type PostIdea = {
  hook: string;
  angle: string;
  caption: string;
  cta: string;
  /** Only the agent asks for one; hooks written on the Create page have none. */
  visual?: Visual;
  /** For a talking reel: the line she says to camera. */
  spoken?: string;
};

const SHOTS: ShotType[] = ["selfie", "wide_selfie", "mirror", "friend"];

/** The longest hook a reel can carry: what can be read in the longest clip the video model makes. */
export const MAX_HOOK_WORDS = Math.floor((LONGEST_SECONDS - HOLD_SECONDS) * WORDS_PER_SECOND);
/** The most words that keep a reel inside its usual eight seconds. */
export const USUAL_HOOK_WORDS = Math.floor((MAX_SECONDS - HOLD_SECONDS) * WORDS_PER_SECOND);
/** The hook length that lands a reel on its target length: what the writer aims for. */
export const TARGET_HOOK_WORDS = Math.round((TARGET_SECONDS - HOLD_SECONDS) * WORDS_PER_SECOND);

const SCHEMA = {
  type: "object",
  properties: {
    posts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hook: { type: "string" },
          angle: { type: "string" },
          caption: { type: "string" },
          cta: { type: "string" },
        },
        required: ["hook", "angle", "caption", "cta"],
      },
    },
  },
  required: ["posts"],
};

/* The agent's version of the schema: every post also carries the visual brief
   for the clip under it, and, for a talking reel, the line she says. */
const VISUAL_SCHEMA = {
  type: "object",
  properties: {
    scene: { type: "string" },
    shot: { type: "string", enum: SHOTS },
    motion: { type: "string" },
  },
  required: ["scene", "shot", "motion"],
};

/** The answer's shape. Exported for its test. A talking reel asks for its spoken line with or without a scene. */
export function schemaFor(options: WriteOptions) {
  const talking = options.format === "talking";
  if (!options.visual && !talking) return SCHEMA;
  const item = SCHEMA.properties.posts.items;
  return {
    ...SCHEMA,
    properties: {
      posts: {
        ...SCHEMA.properties.posts,
        items: {
          ...item,
          properties: { ...item.properties, ...(options.visual ? { visual: VISUAL_SCHEMA } : {}), ...(talking ? { spoken: { type: "string" } } : {}) },
          required: [...item.required, ...(options.visual ? ["visual"] : []), ...(talking ? ["spoken"] : [])],
        },
      },
    },
  };
}

const SYSTEM = `You write short-form video hooks and captions for one creator's Instagram account.

How the format works: the hook is the only text on screen, over a silent 5-second clip that loops. It opens a curiosity gap that the caption closes, so the viewer keeps the clip playing while they read. The caption is where the value is.

Rules:
- Hook: plain words, first person, no emoji, no hashtags, no quotation marks. It must make sense with no picture. A short hook gets a reel exactly as long as it takes to read: usually ${TARGET_HOOK_WORDS - 4} to ${TARGET_HOOK_WORDS + 2} words (about ${TARGET_SECONDS} seconds) and at most ${USUAL_HOOK_WORDS} for one or two sentences. A hook laid out as several short lines in groups (a story told in steps: who she is, what she does not do, what she did) may run to ${MAX_HOOK_WORDS} words; the reel stays about ${TARGET_SECONDS} seconds and loops while they read, so the FIRST LINE must stop the scroll on its own: the most surprising or specific thing goes first, never a warm-up. Write such a hook with a newline between lines and a blank line between groups.
- Caption: 60-140 words. Open by paying off the hook in the first line. Short lines. Use the words this audience would type into search, woven in naturally. No hashtags.
- CTA: one line, ends the caption's thought, and asks the reader to comment the exact keyword given.
- Personal history comes ONLY from the Story section: what happened to her, how long anything took, what she felt, where she worked, who was around her. If the Story does not say it, it did not happen. When a hook needs a personal detail the Story lacks, write it as an observation about the reader instead ("You have been meaning to start for years") rather than inventing one about her.
- Her offer is not personal history: a line that shows her product doing what the Offer says, or her using it that way ("That is exactly what we cover on my free call", "This is the first thing I fix for every client"), is allowed.
- Proof: use only the proof points provided, verbatim in meaning. Never invent numbers, income, follower counts, timelines or testimonials. If no proof point fits, write the post without one.
- The creator's on-screen persona may be AI-generated. Never have it claim to have personally used a physical product or to have experiences a synthetic persona cannot have.
- Every post takes a different angle. Do not rephrase one idea several times.`;

/* The same writer with the brand off: a post on any subject, for anyone. No
   story, offer or proof points exist for it, so the claim rules get stricter
   rather than looser: nothing about her past, no numbers about her, no results. */
const SYSTEM_NO_BRAND = `You write short-form video hooks and captions for one creator's Instagram account. This post is not about her business or anything she sells: write it on the subject she gives, for anyone who cares about that subject.

How the format works: the hook is the only text on screen, over a silent 5-second clip that loops. It opens a curiosity gap that the caption closes, so the viewer keeps the clip playing while they read. The caption is where the value is.

Rules:
- Hook: plain words, first person or second person, no emoji, no hashtags, no quotation marks. It must make sense with no picture. A short hook gets a reel exactly as long as it takes to read: usually ${TARGET_HOOK_WORDS - 4} to ${TARGET_HOOK_WORDS + 2} words (about ${TARGET_SECONDS} seconds) and at most ${USUAL_HOOK_WORDS} for one or two sentences. A hook laid out as several short lines in groups may run to ${MAX_HOOK_WORDS} words; the FIRST LINE must stop the scroll on its own. Write such a hook with a newline between lines and a blank line between groups.
- Caption: 60-140 words. Open by paying off the hook in the first line. Short lines. Use the words people would type into search for this subject, woven in naturally. No hashtags.
- CTA: one line that ends the caption's thought and asks the reader to save the post, share it with a friend, or follow for more. No comment keyword, no link, nothing to buy.
- She has no personal history for this post. Never say what happened to her, how long anything took, where she worked or lived, or who was around her. Write it as an observation about the reader or the subject instead ("You have been meaning to start for years").
- No numbers about her and no results: no follower counts, views, income, earnings, sales, clients, timelines, before-and-after results or testimonials. A count of what the post gives the reader ("five habits") is fine.
- Never mention a product, a course, a tool she sells or her business.
- The creator's on-screen persona may be AI-generated. Never have it claim to have personally used a physical product or to have experiences a synthetic persona cannot have.
- Every post takes a different angle. Do not rephrase one idea several times.`;

/* Added when the writer is also briefing the footage. The motion is where a
   first version went wrong: one small movement reads as a still photo with a
   sway, so the clip wants two clear beats that fill its five seconds. */
const VISUAL_RULES = `- Visual: the silent clip under the hook. Pick the b-roll that matches what the post is ABOUT, not what it says: a post about not needing to get ready to film wants a getting-ready scene; a post about an easier life or a side income wants the easy-life clip (iced coffee in the car, laptop at a cafe). Prefer a scene from the menu; write your own only when none fits, in the same short form: where she is, what she is doing, what she holds. Daylight only, no readable text or brands.
- Motion: what she does in the clip, which runs as long as the hook takes to read (${MIN_SECONDS} to ${MAX_SECONDS} seconds). Write ${MAX_BEATS} distinct beats joined by "then", each a real visible action with a prop or a change of pose, flowing into each other so she is moving from the first frame to the last and is never still at the start or the end: "She lifts the iced coffee and takes a slow sip, then sets it down and turns a page of the notebook, then leans back and tucks her hair behind her ear with a small smile." Keep her face steady (no big expression changes, no talking) and never mention the camera, a cut, a zoom or an angle.`;

function talkingRules(seconds: number, noBrand = false, language?: string): string {
  const words = spokenWords(seconds, language);
  const example = noBrand
    ? "You do not need a new year to start over. You need one small thing you do every single day. Here is where I would begin."
    : "Most people think they have to wait until they are ready. The ones who do well start small and ask for help early. Here is the first thing I tell every client.";
  return `- This is a TALKING reel: she talks to camera, with sound, and the hook sits over the clip as a headline. Write "spoken": her script, ${noBrand ? "in plain spoken words" : "in her voice"}, ${words.min} to ${words.max} words and never more than ${words.cut} (it fills ${seconds} seconds at a talking pace; shorter leaves her pausing), spoken the way a person talks to a phone: a claim, then the turn, then the promise ("${example}"). No hashtags, no keyword. The hook on screen is shorter, a headline for what she says. The visual's motion is ignored for a talking reel (she looks at the camera and speaks), so make the scene a place where she would naturally talk to her phone.`;
}

const CHECK_SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          unsupported: { type: "array", items: { type: "string" } },
          hook: { type: "string" },
          caption: { type: "string" },
        },
        required: ["index", "unsupported", "hook", "caption"],
      },
    },
  },
  required: ["results"],
};

/**
 * The fact-checker's instructions, as plain strings so they can be tested.
 *
 * Three kinds of ground. Her story and proof points are the whole record of
 * her life and results. Her offer (what the product is, what it does, how she
 * uses it) is also allowed ground: a line like "That is exactly what we
 * cover on my free call" describes the offer at work, not a past event. Still
 * never allowed: personal history the story does not hold, numbers not in
 * the proof points, and any money or earnings claim the writer made up.
 */
export function factCheckPrompt(
  profile: Pick<BrandProfile, "personaName" | "story" | "proofPoints" | "offer" | "niche" | "brandOff" | "language">,
  posts: Pick<PostIdea, "hook" | "caption">[],
  adapted = false,
  memory: readonly string[] = [],
): { system: string; prompt: string } {
  const checked = brandOff(profile) ? factCheckWithoutBrand(posts, adapted) : factCheckWithBrand(profile, posts, adapted, memory);
  /* A rewritten sentence stays in her language. The rules about what may be
     claimed are the same in every language: numbers only from her proof
     points, history only from her story. */
  return { ...checked, system: withLanguage(checked.system, profile.language, "every hook and caption you return, including any sentence you rewrite") };
}

function factCheckWithBrand(
  profile: Pick<BrandProfile, "personaName" | "story" | "proofPoints" | "offer" | "niche">,
  posts: Pick<PostIdea, "hook" | "caption">[],
  adapted: boolean,
  memory: readonly string[],
): { system: string; prompt: string } {
  const offer = profile.offer.trim();
  /* Remembered facts are hers, confirmed in chat or typed on the Brand page:
     as good as the story. Absent when there are none, so the prompt is
     unchanged for an account with no memory. */
  const remembered = rememberedLines({}, memory);
  const system =
    "You are a fact-checker for a creator's captions. The brief is the complete record of the persona's life and results. " +
    "A claim about her past, her feelings about her past, durations, numbers, places or people is unsupported unless the brief states it. " +
    "Her offer is allowed ground: a line that says what her product or offer does, or how she uses it (for example: That is exactly what we cover on my free call; This is the first thing I fix for every client), is supported when it fits the offer as described, even though the story does not tell it as an event. Never flag or rewrite such a line as invented history. " +
    "Still unsupported, always: a personal event, job, place, person or timeline that is not in the story; a number that is not in the proof points; any claim about money, income, earnings, sales or clients won that a proof point does not state. " +
    "General statements about the reader or the niche are fine. " +
    REFERENCE_IS_TECHNIQUE;
  const prompt =
    `BRIEF\nPersona's name: ${profile.personaName?.trim() || "(none)"}\nStory: ${profile.story?.trim() || "(none)"}\nProof points:\n${profile.proofPoints.map((p) => `- ${p}`).join("\n") || "- (none)"}\n\n` +
    (remembered.length
      ? `ALLOWED GROUND: WHAT SHE TOLD US (facts about her as true as the story and proof points; a claim or number that one of these states is supported)\n${remembered.join("\n")}\n\n`
      : "") +
    `ALLOWED GROUND: HER OFFER (what the product is, what it does and how she uses it; lines that describe these are supported)\nOffer: ${offer || "(none)"}\nNiche: ${profile.niche.trim() || "(none)"}\n\n` +
    `DRAFTS\n${posts.map((post, i) => `[${i}] HOOK: ${post.hook}\nCAPTION: ${post.caption}`).join("\n\n")}\n\n` +
    "For every draft return its index, the unsupported claims you found (empty if none), and the hook and caption. " +
    "A line that shows her using her product the way the offer describes is not a claim to report. " +
    "If a draft has unsupported claims, rewrite only the sentences that contain them, keeping the curiosity gap, the length and the voice. " +
    (adapted
      ? "Each hook is laid out line by line after another creator's post, already with this persona's details swapped in. " +
        "In the hook, only a specific fact is unsupported: a name, a brand, a number, a result, a duration or an event that neither the brief nor her offer states. " +
        "A general feeling or habit in a hook line (for example: I hate filming in public; without filming a thing) is her voice, not a claim: leave it. Her own name is supported, and so is her product doing what her offer says it does. " +
        "Fix an unsupported fact by deleting or swapping only those words inside its line; never rewrite, merge, add or drop a line, and keep the line breaks exactly. "
      : `Hooks stay at or under ${MAX_HOOK_WORDS} words. `) +
    "If a draft is clean, return it unchanged.";
  return { system, prompt };
}

/**
 * The fact-check with the brand off. There is no story, proof or offer to
 * check against, so there is no allowed ground: any first-person claim about
 * her life, any number about her and any money claim is rewritten as
 * something general. Only those; the checker does not judge anything else.
 */
function factCheckWithoutBrand(posts: Pick<PostIdea, "hook" | "caption">[], adapted: boolean): { system: string; prompt: string } {
  const system =
    "You are a fact-checker for a creator's captions. This post is written without her brand: nothing about her life or results is on file, so nothing personal about her is supported. " +
    "Unsupported, always: a first-person claim about her past or her life (what happened to her, how long anything took, where she worked or lived, who she knows); a number about her (followers, views, days, months, years, results); any claim about money, income, earnings, sales or clients. " +
    "Supported: general statements about the reader or the subject, a feeling or habit said as a general truth, and a count of what the post gives the reader (five habits, three steps). Check only for the unsupported kinds above. " +
    REFERENCE_IS_TECHNIQUE;
  const prompt =
    `DRAFTS\n${posts.map((post, i) => `[${i}] HOOK: ${post.hook}\nCAPTION: ${post.caption}`).join("\n\n")}\n\n` +
    "For every draft return its index, the unsupported claims you found (empty if none), and the hook and caption. " +
    "If a draft has unsupported claims, rewrite only the sentences that contain them as general statements about the reader or the subject, keeping the curiosity gap, the length and the voice. " +
    (adapted
      ? "Each hook is kept line by line from another creator's post. In the hook, only a personal fact is unsupported: a number about her, a result, a duration, a money claim or an event in her life. " +
        "Fix it by deleting or swapping only those words inside its line; never rewrite, merge, add or drop a line, and keep the line breaks exactly. "
      : `Hooks stay at or under ${MAX_HOOK_WORDS} words. `) +
    "If a draft is clean, return it unchanged.";
  return { system, prompt };
}

/** A second pass that reads each draft against the brief and rewrites any claim
    about the persona's life, numbers or timeline that the brief does not contain.
    The first pass is told not to invent; this one checks that it did not. */
async function removeInventedHistory(profile: BrandProfile, posts: PostIdea[], adapted = false, memory: readonly string[] = []): Promise<PostIdea[]> {
  const { system, prompt } = factCheckPrompt(profile, posts, adapted, memory);
  const { results } = await generateText<{
    results: { index: number; unsupported: string[]; hook: string; caption: string }[];
  }>({
    schema: CHECK_SCHEMA,
    thinking: "low",
    // What she posts is the product: the check runs on Nemotron Super, not the fast tier.
    tier: "super",
    system,
    prompt,
  });
  return posts.map((post, i) => {
    const result = results.find((item) => item.index === i);
    if (!result?.unsupported.length) return post;
    const hook = adapted ? keepLines(post.hook, result.hook) : result.hook.trim();
    return { ...post, hook, caption: result.caption.trim() };
  });
}

export type WriteOptions = {
  /** Ask for the visual brief (scene, shot, motion) with every post. */
  visual?: boolean;
  /** The avatar's usual places, offered first on the scene menu. */
  places?: string[];
  /** What the post must be about, in the creator's words. Without it the writer picks its own angles. */
  brief?: string;
  /** A scene the creator asked for; the visual follows it instead of the menu. */
  scene?: string;
  /** A talking reel wants a spoken line as well. */
  format?: "loop" | "talking";
  /** How long the talking clip can be, which sets how long her script is. Twelve unless the video model stops sooner. */
  talkingSeconds?: number;
  /** The open looks (no boxes) set the hook as short lines in groups, so it is written that way. */
  style?: TextStyle;
  /** A hook the creator wrote, used word for word. The writer fits everything else to it. */
  hook?: string;
  /**
   * A post's hook she pointed at ("with this hook"), rewritten for her line by
   * line: same lines and groups, her name, her offer, her numbers. It may run
   * as long as the original, and it is still fact-checked.
   */
  template?: string;
  /** A post she admires: a model for the shape of the hook, never its words or facts. */
  reference?: string;
  /** What the agent remembers about her (`memoryLines`): allowed ground for the writer and the fact-check. */
  memory?: string[];
  /** The house knowledge and her approved posts, as `referenceBlock` renders them. Technique, never her facts. */
  knowledge?: string;
};

/**
 * An adapted hook after the fact-check: the checker's words, but only if it
 * kept the lines. A checker that merged or rewrote lines (or wrote the breaks
 * as a literal backslash-n) has broken the layout she asked for, and the
 * writer's lines are kept instead: they were already written from her facts.
 */
export function keepLines(written: string, checked: string): string {
  const fixed = checked.replace(/\\n/g, "\n").trim();
  const lines = (text: string) => text.split("\n").filter((line) => line.trim()).length;
  return fixed && lines(fixed) === lines(written) ? fixed : written.trim();
}

/** How a template is laid out: its lines and the groups the blank lines make. */
export function templateShape(template: string): { lines: number; groups: number } {
  const groups = template.trim().split(/\n\s*\n/).map((group) => group.split("\n").filter((line) => line.trim()).length).filter(Boolean);
  return { lines: groups.reduce((sum, count) => sum + count, 0), groups: groups.length };
}

/**
 * The writer's instruction for a hook she pointed at: keep it line for line,
 * swap only what is someone else's for what is hers. Everything it may swap
 * in comes from her profile, so nothing is invented to fill a line.
 */
export function templatePrompt(template: string, profile: Pick<BrandProfile, "personaName" | "offer" | "proofPoints" | "brandOff">): string {
  const { lines, groups } = templateShape(template);
  /* With the brand off there is nothing of hers to swap in: the lines stay as
     they are and only what is plainly someone else's comes out. */
  if (brandOff(profile)) {
    return [
      `The creator wants the hook below, kept as it is. Write it LINE BY LINE into "hook": exactly ${lines} ${lines === 1 ? "line" : "lines"} in ${groups} ${groups === 1 ? "group" : "groups"}, in the same order (a newline between lines, a blank line between groups), every line word for word.`,
      "Change only two things, and only inside the line that holds them:",
      "- Another person's name: leave it out and keep the line natural.",
      '- A brand, product, app or tool name: leave it out, or say it in plain words ("an app", "a tool").',
      "Do not reword, tidy, shorten or change the tense of anything else.",
      "Then write the angle, caption, call to action and visual to fit the hook.",
      `THE HOOK TO KEEP:
${template.trim()}`,
    ].join("\n");
  }
  const name = profile.personaName?.trim();
  const offer = profile.offer.trim();
  return [
    `The creator wants the hook below, made hers. Rewrite it LINE BY LINE into "hook": exactly ${lines} ${lines === 1 ? "line" : "lines"} in ${groups} ${groups === 1 ? "group" : "groups"}, in the same order (a newline between lines, a blank line between groups), each line about as long as the original line and in the same rhythm.`,
    "Keep every line that holds nothing personal exactly as it is, word for word. In a line that holds a personal detail, replace only the words of that detail and keep every other word of the line as it is: this is a word swap, not a rewrite. Do not reword, tidy, shorten or change the tense of anything else.",
    "The details to swap, each for hers:",
    `- Another person's name: ${name ? `"${name}"` : "leave the name out and keep the line natural"}.`,
    `- A tool, product, brand or app: her offer${offer ? ` ("${offer}", in a few words)` : ""}, or "my business" if that does not fit the line.`,
    `- A number: only a number from her proof points${profile.proofPoints.length ? "" : " (she has none)"}; otherwise drop the number and keep the line natural.`,
    "- A place, a job or a life detail: hers from the Story, or neutral words.",
    "Never keep someone else's name, brand or claim.",
    `For example, for a creator called Mia who sells a course and has no proof points: "My name is Jess" becomes "My name is Mia"; "I bought the Acme planner" becomes "I bought my own course"; "I hate being on camera" stays as it is.`,
    "Then write the angle, caption, call to action and visual to fit the adapted hook.",
    `THE HOOK TO ADAPT:
${template.trim()}`,
  ].join("\n");
}

/** The looks with no box under the type; the hook is written as short lines for them. */
const OPEN_STYLES = new Set<TextStyle>(["bold", "pastel", "serif"]);

const OPEN_RULES = `- This reel is in an open style: type straight on the clip, no boxes. Write the hook as short lines, three to six words each, one thought per line, and put a blank line between groups of lines (one to three groups), so on screen it reads like a short poem rather than a paragraph. Use a newline between lines and an empty line between groups. Same word limit. Example of the shape:
I stopped filming myself
six months ago

I still post every day

Here is what changed`;

const OPEN_RULES_NO_BRAND = OPEN_RULES.replace(
  /Example of the shape:[\s\S]*$/,
  `Example of the shape:
Nobody tells you this
about January

The plan is not the problem

Starting is`,
);

/** The profile lines the hook writer reads. With the brand off there are none but her name. */
function profileLines(profile: BrandProfile): string[] {
  if (brandOff(profile)) {
    return [
      `Persona: ${profile.personaName || "(unnamed)"}`,
      "This post is written without her brand: no niche, audience, offer, story, proof points or keyword. Write only on the subject given, and write no personal history.",
    ];
  }
  return [
    `Persona: ${profile.personaName || "(unnamed)"}`,
    `Story (the only personal history that exists):\n${profile.story?.trim() || "(none given: write no personal history at all)"}`,
    `Niche: ${profile.niche}`,
    `Audience: ${profile.audience}`,
    `Offer: ${profile.offer}`,
    `Comment keyword: ${profile.keyword}`,
    `Voice: ${profile.voice}`,
    `Proof points allowed:\n${profile.proofPoints.map((p) => `- ${p}`).join("\n") || "- (none)"}`,
    profile.winners?.length
      ? `Hooks that already performed for this account (reuse the structure, not the wording):\n${profile.winners.map((w) => `- ${w}`).join("\n")}`
      : "",
  ];
}

/** The hook writer's instructions, as plain strings so they can be tested. */
export function writerPrompt(profile: BrandProfile, count: number, options: WriteOptions = {}): { system: string; prompt: string } {
  const noBrand = brandOff(profile);
  const menu = [
    ...(options.places ?? []).map((place) => `- ${place} (selfie)`),
    ...SCENE_GROUPS.flatMap((group) => group.scenes.map((scene) => `- ${scene.idea} (${scene.shot})`)),
  ];
  const system = [
    noBrand ? SYSTEM_NO_BRAND : SYSTEM,
    options.visual ? VISUAL_RULES : "",
    options.format === "talking" ? talkingRules(options.talkingSeconds ?? MAX_TALKING_SECONDS, noBrand, profile.language) : "",
    options.style && OPEN_STYLES.has(options.style) ? (noBrand ? OPEN_RULES_NO_BRAND : OPEN_RULES) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system: withLanguage(system, profile.language, `the hook, the caption, the call to action${options.format === "talking" ? " and the spoken line" : ""}`),
    prompt: [
      `Write ${count} ${count === 1 ? "post" : "posts"}.`,
      options.brief ? `What the ${count === 1 ? "post is" : "posts are"} about, in the creator's own words. Follow it closely:\n${options.brief.trim()}` : "",
      options.hook ? `The hook is already written by the creator and is used EXACTLY as given, word for word, in "hook". Write the angle, caption, call to action and visual to fit it:\n${options.hook.trim()}` : "",
      options.template && !options.hook ? templatePrompt(options.template, profile) : "",
      options.reference && !options.hook && !options.template
        ? `A post the creator admires, as a model for SHAPE only. Match how its hook opens, what it promises, its length and its rhythm, with her own subject, her own words and only her own facts. If it is laid out as short lines in groups, lay the hook out the same way, with the same number of lines and groups (newline between lines, blank line between groups). Its names, numbers and claims are someone else's and must not appear:\n${options.reference.trim()}`
        : "",
      options.scene ? `The creator asked for this scene under the hook. Use it as the visual, in the menu's short form:\n${options.scene.trim()}` : "",
      ...profileLines(profile),
      rememberedLines(profile, options.memory).join("\n"),
      options.knowledge?.trim() ?? "",
      options.visual ? `Scene menu for the visual, with the shot type that suits each:\n${menu.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** The spoken line alone, for a talking reel whose writer left it out. */
async function writeSpoken(profile: BrandProfile, post: PostIdea, options: WriteOptions): Promise<string> {
  const { spoken } = await generateText<{ spoken: string }>({
    system: [talkingRules(options.talkingSeconds ?? MAX_TALKING_SECONDS, brandOff(profile), profile.language), "Write only the line she says to camera for the post below, in her voice, first person. Only facts from the post itself."].join("\n"),
    prompt: [`Hook: ${post.hook}`, `Caption: ${post.caption}`, profile.voice ? `Her voice: ${profile.voice}` : ""].filter(Boolean).join("\n"),
    schema: { type: "object", properties: { spoken: { type: "string" } }, required: ["spoken"] },
    tier: "super",
  });
  return (spoken ?? "").trim();
}

/** A line cut to a word limit, taken back to its last full sentence so she never stops mid-thought. Pure. */
export function toSentenceEnd(line: string): string {
  const end = Math.max(line.lastIndexOf(". "), line.lastIndexOf("! "), line.lastIndexOf("? "), /[.!?]$/.test(line) ? line.length - 1 : -1);
  // Keep the cut as it is when the only full sentence would be too short to say anything.
  return end > line.length / 3 ? line.slice(0, end + 1).trim() : line;
}

export async function writePosts(profile: BrandProfile, count = 5, options: WriteOptions = {}): Promise<PostIdea[]> {
  const { system, prompt } = writerPrompt(profile, count, options);
  const { posts } = await generateText<{ posts: PostIdea[] }>({
    system,
    schema: schemaFor(options),
    thinking: "low",
    /* Nano drifted into the third person and invented claims in live runs;
       Super keeps her voice and answers about as fast. */
    tier: "super",
    prompt,
  });

  const adapted = Boolean(options.template && !options.hook);
  /* Nemotron sometimes leaves a talking reel's spoken line empty (about one
     answer in two in a live test); asking for just that line is cheaper than
     writing the whole post again. */
  if (options.format === "talking") {
    for (const post of posts) {
      if (countWords(post.spoken ?? "") < 3) post.spoken = await writeSpoken(profile, post, options);
    }
  }
  const checked = await removeInventedHistory(profile, posts, adapted, options.memory);
  const language = contentLanguage(profile);

  return checked.map((post) => {
    // Her own hook is hers: not reworded, not fact-checked, not cut to the limit.
    if (options.hook) post.hook = options.hook.trim();
    // Line breaks are kept: a hook written in groups is drawn in groups, in either style. Emoji cannot be drawn at all.
    post.hook = tidyGlyphs(post.hook).replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const words = countWords(post.hook);
    // The limit was tuned on English; a language that spends more words on the same thought gets more.
    const limit = widenLimit(MAX_HOOK_WORDS, language);
    // An adapted hook keeps the length of the post it came from, like her own.
    if (words > limit && !options.hook && !adapted) {
      throw new Error(`Hook is ${words} words, over the ${limit}-word reel limit: "${post.hook}"`);
    }
    // With the brand off there is no keyword: the call to action is save, share or follow.
    // A model that drops the call to action entirely gets the plain one, rather than losing the whole post.
    if (!brandOff(profile) && !(post.cta ?? "").trim()) {
      // Often the call to action was written as the caption's last line; use it rather than saying it twice.
      const lines = post.caption.trim().split("\n");
      const last = lines.at(-1) ?? "";
      if (last.toLowerCase().includes(profile.keyword.toLowerCase())) {
        post.cta = last.trim();
        post.caption = lines.slice(0, -1).join("\n").trim();
      } else {
        post.cta = `Comment ${profile.keyword} and I will send you the details.`;
      }
    }
    if (!brandOff(profile) && !post.cta.toLowerCase().includes(profile.keyword.toLowerCase())) {
      throw new Error(`CTA does not contain the keyword "${profile.keyword}": "${post.cta}"`);
    }
    if (post.visual && !SHOTS.includes(post.visual.shot)) post.visual.shot = "selfie";
    if (options.format === "talking") {
      const spoken = (post.spoken ?? "").trim();
      if (countWords(spoken) < 3) throw new Error("The writer returned no spoken line for the talking reel.");
      const { cut } = spokenWords(options.talkingSeconds ?? MAX_TALKING_SECONDS, language);
      post.spoken = countWords(spoken) > cut ? toSentenceEnd(spoken.split(/\s+/).slice(0, cut).join(" ")) : spoken;
    } else {
      delete post.spoken;
    }
    return post;
  });
}

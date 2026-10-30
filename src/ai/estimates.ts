/* What a text or vision call costs us, so the daily cap can count it.
 *
 * Image and video prices are per output and sit next to their clients
 * (`IMAGE_PRICE_USD` in gemini.ts, `VIDEO_PRICE_PER_SECOND_USD` in
 * higgsfield.ts). Text is priced per token, which is not known until the
 * answer comes back, so there are two numbers here: an estimate to reserve
 * against the cap before the call, and a rate to settle with afterwards if
 * Gemini told us how many tokens it used.
 *
 * The estimates are deliberately generous. Under-reserving is what lets a cap
 * be walked past, and being wrong by a tenth of a cent costs nothing.
 */

/** Published per-million-token prices (ai.google.dev/gemini-api/docs/pricing, read 2026-09-21). */
const TEXT_PRICE_PER_MTOK_USD: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

/** Used when the model is not in the table: the most expensive one we know of. */
const FALLBACK_PRICE = { input: 0.3, output: 2.5 };

/* Embedding prices per million input tokens. The pricing page read on
   2026-10-06 lists only gemini-embedding-2, at $0.20; gemini-embedding-001 is
   still served and documented as stable but no longer priced there, so it
   keeps its last published $0.15. Anything unknown is billed at the higher. */
const EMBEDDING_PRICE_PER_MTOK_USD: Record<string, number> = {
  "gemini-embedding-001": 0.15,
  "gemini-embedding-2": 0.2,
};
const EMBEDDING_FALLBACK_PRICE = 0.2;

/** What embedding this many input tokens cost. */
export function embeddingCostUsd(model: string, inputTokens: number): number {
  return (inputTokens * (EMBEDDING_PRICE_PER_MTOK_USD[model] ?? EMBEDDING_FALLBACK_PRICE)) / 1_000_000;
}

export interface TokenUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * What a finished text call cost, from Gemini's own token counts.
 *
 * Returns undefined when the response carried no `usageMetadata`, so the
 * caller keeps its estimate rather than replacing it with a guess dressed up
 * as a measurement.
 */
export function textCallCostUsd(model: string, usage: TokenUsage | undefined): number | undefined {
  if (!usage) return undefined;
  const price = TEXT_PRICE_PER_MTOK_USD[model] ?? FALLBACK_PRICE;
  const input = usage.promptTokenCount ?? 0;
  const output = usage.candidatesTokenCount ?? Math.max(0, (usage.totalTokenCount ?? 0) - input);
  if (input === 0 && output === 0) return undefined;
  return (input * price.input + output * price.output) / 1_000_000;
}

/* What to hold against the daily cap before a call, by shape of call.
 *
 * Measured against real runs and then rounded up: a hook set is two calls over
 * a page of brand notes and comes back with five posts; a photo set sent to a
 * vision model is a megabyte of images and a short answer. */
export const CALL_ESTIMATE_USD = {
  /** One short question, a sentence or two back. The interview coach. */
  text_short: 0.002,
  /** A page in, several paragraphs out. Hook writing, carousel writing. */
  text_long: 0.01,
  /** Every source document in one prompt. The brief builder. */
  text_document: 0.03,
  /** One photograph plus a short answer. Face finding, screening. */
  vision_photo: 0.004,
  /** Up to fifteen thumbnails in one call. Curation, the identity lock. */
  vision_set: 0.03,
  /** One search query embedded: a sentence, a fraction of a cent. */
  embedding: 0.0001,
} as const;

export type CallShape = keyof typeof CALL_ESTIMATE_USD;

/**
 * What a whole action is expected to cost us, before it runs.
 *
 * Actions are named rather than call sites, because the cap has to be checked
 * once at the front door: a check per call would pass the first one and stop
 * halfway through, leaving the user with half a result and us with the bill
 * for it.
 */
export const ACTION_ESTIMATE_USD = {
  /** writePosts: a writing pass and a fact-checking pass. */
  write_hooks: CALL_ESTIMATE_USD.text_long * 2,
  /** One reply from the brand rework coach, which rereads the saved brand and the chat. */
  brand_rework_turn: CALL_ESTIMATE_USD.text_long,
  /** The coach reviewing one answer. */
  onboarding_review: CALL_ESTIMATE_USD.text_short,
  /** Three fresh voice samples. */
  onboarding_voice: CALL_ESTIMATE_USD.text_long,
  /** draftLock over the five chosen photos. */
  onboarding_lock: CALL_ESTIMATE_USD.vision_set,
  /** proposeRoles over every uploaded photo. */
  onboarding_curate: CALL_ESTIMATE_USD.vision_set,
  /** buildBriefFrom over every source document. */
  rebuild_brief: CALL_ESTIMATE_USD.text_document,
  /** suggestTopics: one call, cached afterwards. */
  suggest_topics: CALL_ESTIMATE_USD.text_long,
  /** detectFaceBox on one photo. */
  find_face: CALL_ESTIMATE_USD.vision_photo,
  /** One screening pass over one photo. */
  screen_photo: CALL_ESTIMATE_USD.vision_photo,
  /** One screening pass over a scene idea. */
  screen_idea: CALL_ESTIMATE_USD.text_short,
  /** Three movement suggestions from a photo's stored scene. Text only. */
  motion_ideas: CALL_ESTIMATE_USD.text_short,
  /** The same, for an upload with no scene on file: one thumbnail is looked at. */
  motion_ideas_photo: CALL_ESTIMATE_USD.vision_photo,
  /** One rewrite of a rough idea into the motion line, plus its safety screen. */
  polish_motion: CALL_ESTIMATE_USD.text_short * 2,
  /** The agent reading one chat message, plus the screen on what it asked for. */
  agent_understand: CALL_ESTIMATE_USD.text_short * 2,
  /** The same with up to three screenshots attached. */
  agent_understand_images: CALL_ESTIMATE_USD.text_short * 2 + CALL_ESTIMATE_USD.vision_photo * 3,
  /** One agent v2 turn: up to a few model rounds with tools, plus the writers and retrieval they call. */
  agent_turn: CALL_ESTIMATE_USD.text_long * 4,
} as const;

export type ActionShape = keyof typeof ACTION_ESTIMATE_USD;

/* What a job of each kind costs us in model calls, beyond the images and
   clips that are priced per output.
 *
 * This is the number that used to be zero. `creditsFor` is zero for carousel
 * and reel because writing and rendering are included in the plan — which is
 * what the *user* pays, not what *we* pay. A carousel job runs a writer pass
 * and a face-finding pass per photo; a reel job samples three frames and asks
 * a vision model where the face is. Both were invisible to the cap and to
 * `provider_costs` because the code guarded on `estimate > 0`. */
export const JOB_MODEL_ESTIMATE_USD: Record<string, number> = {
  /* A writing pass, a rewrite pass, and face finding on the photos it uses.
     A split or grid set adds one matching call and a first look at uploads
     not yet described; both are kept on the photo, so the looks are rare. */
  carousel: CALL_ESTIMATE_USD.text_long * 2 + CALL_ESTIMATE_USD.text_short + CALL_ESTIMATE_USD.vision_photo * 6,
  // Three sampled frames in one vision call.
  reel: CALL_ESTIMATE_USD.vision_photo,
  // The prompt writer and the photo judge, either side of the image itself.
  image: CALL_ESTIMATE_USD.text_short + CALL_ESTIMATE_USD.vision_photo,
  // The motion prompt is written locally; nothing extra.
  clip: 0,
  identity_view: 0,
  // The face finder, once per photo; the drawing is our own compute.
  text_photo: CALL_ESTIMATE_USD.vision_photo,
  /* An agent run: the writer and its fact-check, the director, the motion
     polish and up to six scene screens. Its children reserve their own. */
  agent: CALL_ESTIMATE_USD.text_long * 3 + CALL_ESTIMATE_USD.text_short * 8,
  /* A week: reading her notes and planning (two long reasoning calls), a
     writer, fact-check and review per post with one rewrite, and the voice
     note's transcription. Its posts are agent runs that reserve their own. */
  week: CALL_ESTIMATE_USD.text_long * 10 + CALL_ESTIMATE_USD.text_short * 6,
  // One planning turn: a long write (the whole plan as JSON) and the screen over it.
  plan: CALL_ESTIMATE_USD.text_long * 2 + CALL_ESTIMATE_USD.text_short,
  // A storyboard run: a screen per still. Its stills and clips reserve their own.
  story: CALL_ESTIMATE_USD.text_short * 6,
  // The join is ffmpeg, plus one face look when there is a hook on screen.
  stitch: CALL_ESTIMATE_USD.vision_photo,
  /* A day of stories: the writer and its fact-check, two text calls at low
     thinking; the frames are our own canvas. Its new photos reserve their own. */
  stories: CALL_ESTIMATE_USD.text_long * 2,
};

/** The model-call cost of one job of this kind, over and above its output price. */
export function jobModelEstimateUsd(kind: string): number {
  return JOB_MODEL_ESTIMATE_USD[kind] ?? CALL_ESTIMATE_USD.text_short;
}

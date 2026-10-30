import { toReference, type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import { getMedia, updateMediaMeta, withLocalFile, type Media } from "../data/media";

import { hasForbidden, MOTION_PRESETS, MOTION_RULES, sentence, stripRules, SUGGESTION_COUNT } from "./motion";

/* Three movements that suit *this* photo.
 *
 * The founder's ask: "certain photos will look good with certain animations
 * rather than making the user think of what they want every time." So the
 * drawer does the thinking, out of what the app already knows.
 *
 * Where the knowledge comes from, cheapest first:
 *
 * 1. A generated photo already carries the scene it was made from, in
 *    `media.meta.idea`. That is a sentence about a kitchen counter and an iced
 *    coffee, which is all a text call needs — no vision, no image bytes.
 * 2. An upload or an imported reference carries nothing, so one vision call
 *    looks at a 512px thumbnail. Once.
 *
 * Nothing the creator typed reaches this file: the input is a media id, and
 * the scene it reads was screened when the photo was made, as the photo itself
 * was on upload. A suggestion she taps is screened like any other idea, in
 * `polishMotionAction`, because that is where a rough idea becomes a prompt —
 * which is the one place the check is worth paying for.
 *
 * "Once" is the whole reason this file writes to the database. The drawer asks
 * every time a tile is tapped, and a creator taps around; without a cache that
 * is a vision call per tap, on a free feature. The answer is written back to
 * `media.meta.motionIdeas`, where it belongs to the photo rather than to a
 * process that will not outlive the request.
 */

/** Three lines, as stored on the media row. */
export type MotionIdeas = string[];

export interface MotionIdeaDeps {
  model?: typeof generateText;
  /** Overridden in tests so no ffmpeg and no storage are needed. */
  thumbnail?: (userId: string, mediaId: string) => Promise<InlineImage>;
}

const SCHEMA = {
  type: "object",
  properties: { motions: { type: "array", items: { type: "string" } } },
  required: ["motions"],
};

/* More than the drawer shows, on purpose. The rules throw one or two of these
   away most times — a model asked for movements will reach for a head tilt or
   a slow zoom sooner or later — and a photo of a mirror selfie topping up from
   the sip preset is a suggestion about a cup that is not in the picture. Two
   spare costs nothing: it is the same call. */
const ASK_FOR = 5;

const SYSTEM = [
  "You suggest small movements for an image-to-video model that will animate one still photograph of a creator.",
  "",
  "Every suggestion must obey these rules:",
  MOTION_RULES,
  "",
  `Answer with exactly ${ASK_FOR} suggestions. Each is one sentence in the third person, present tense,`,
  "at most twenty words, describing one small slow movement she makes — a hand, her head, or something she is",
  "already holding. Use what is actually in the photograph: do not invent a prop, a place or a person.",
  "Never mention a camera, a cut, a zoom, an angle, text on screen, or any change of outfit, hair or makeup.",
  "They must be genuinely different from each other: different parts of her, different props.",
].join("\n");

/** What is already on the row, if anything. Pure: no database, no model. */
export function cachedMotionIdeas(media: Pick<Media, "meta">): MotionIdeas {
  const stored = (media.meta as { motionIdeas?: unknown }).motionIdeas;
  if (!Array.isArray(stored)) return [];
  return stored.filter((line): line is string => typeof line === "string" && line.length > 0).slice(0, SUGGESTION_COUNT);
}

/** The scene a generated photo was made from, or null for an upload. */
export function sceneOf(media: Pick<Media, "meta">): string | null {
  const meta = media.meta as { idea?: unknown; prompt?: unknown };
  for (const value of [meta.idea, meta.prompt]) {
    if (typeof value === "string" && value.trim().length > 8) return value.trim();
  }
  return null;
}

/** Trim, drop anything the rules forbid, de-duplicate, top up from the presets. */
export function tidySuggestions(lines: readonly string[]): MotionIdeas {
  const seen = new Set<string>();
  const clean: string[] = [];
  const consider = (line: string) => {
    // Same echo the polish step guards against: a model told the rules repeats them.
    const one = sentence(stripRules(line.trim().replace(/\s+/g, " ")).slice(0, 160));
    const key = one.toLowerCase();
    if (one.length < 16 || seen.has(key) || hasForbidden(one)) return;
    seen.add(key);
    clean.push(one);
  };
  for (const line of lines) consider(line);
  /* The drawer promises three. A model that answered with two, or with two
     good ones and a camera pan, must not leave a gap where a suggestion was. */
  for (const preset of MOTION_PRESETS) {
    if (clean.length >= SUGGESTION_COUNT) break;
    consider(preset.idea);
  }
  return clean.slice(0, SUGGESTION_COUNT);
}

async function photoThumbnail(userId: string, mediaId: string): Promise<InlineImage> {
  // 512px is plenty to see a cup, a laptop and where her hands are.
  return withLocalFile(userId, mediaId, (path) => toReference(path, 512));
}

export interface MotionIdeaResult {
  ideas: MotionIdeas;
  /** True when the answer came off the row and no model was called. */
  cached: boolean;
  /** True when this call had to look at the picture rather than read its scene. */
  sawPhoto: boolean;
}

/**
 * Three suggested movements for one photo, looked at once and remembered.
 *
 * Returns the cached lines untouched when the row already has them — that
 * branch makes no model call at all, which is what the whole cache is for and
 * what `motion-ideas.db.test.ts` checks against real Postgres.
 */
export async function motionIdeasFor(
  userId: string,
  mediaId: string,
  lock: { expressions?: string } | null,
  deps: MotionIdeaDeps = {},
): Promise<MotionIdeaResult> {
  const media = await getMedia(userId, mediaId);
  if (!media || media.kind !== "image") throw new Error("That photo is not in your library.");

  const cached = cachedMotionIdeas(media);
  if (cached.length >= SUGGESTION_COUNT) return { ideas: cached, cached: true, sawPhoto: false };

  const model = deps.model ?? generateText;
  const scene = sceneOf(media);
  const expressions = lock?.expressions?.trim();

  let ideas: MotionIdeas;
  let sawPhoto = false;
  try {
    if (scene) {
      const answer = await model<{ motions: string[] }>({
        system: SYSTEM,
        schema: SCHEMA,
        thinking: "low",
        prompt: [
          `The photograph shows: ${scene.slice(0, 600)}`,
          expressions ? `Her usual expressions: ${expressions.slice(0, 300)}` : "",
          `Suggest ${ASK_FOR} movements.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      ideas = tidySuggestions(answer?.motions ?? []);
    } else {
      sawPhoto = true;
      const image = await (deps.thumbnail ?? photoThumbnail)(userId, mediaId);
      const answer = await model<{ motions: string[] }>({
        system: SYSTEM,
        schema: SCHEMA,
        thinking: "low",
        images: [image],
        prompt: [
          "Look at this photograph of the creator.",
          expressions ? `Her usual expressions: ${expressions.slice(0, 300)}` : "",
          `Suggest ${ASK_FOR} movements that suit what she is doing and holding in it.`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      });
      ideas = tidySuggestions(answer?.motions ?? []);
    }
  } catch {
    /* A suggestion is a convenience: a provider outage must not close the
       drawer. The presets always work, and they are not written to the row, so
       the real look happens the next time she opens it. */
    return { ideas: tidySuggestions([]), cached: false, sawPhoto };
  }

  await updateMediaMeta(userId, mediaId, { motionIdeas: ideas });
  return { ideas, cached: false, sawPhoto };
}

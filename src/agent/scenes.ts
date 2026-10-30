import { generateText } from "@/ai/text";
import { SCENE_GROUPS } from "@/content/scene-library";
import type { IdentityLock } from "@/identity/build";
import { withEnglishFields } from "@/content/languages";
import type { ShotType } from "@/style/house-style";

import { MAX_PHOTOS, type PhotoMode, type SceneIdea } from "./plan";

/* A set of photos is planned before any is paid for: one model call turns
   "a coffee shop set" into the scene ideas the photo prompt writer takes, so
   the creator sees the plan and the price before the run spends anything on
   it. Pure helpers at the bottom keep the count and the shots honest. */

const SHOTS: ShotType[] = ["selfie", "wide_selfie", "mirror", "friend"];

const SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          idea: { type: "string" },
          shot: { type: "string", enum: SHOTS },
          why: { type: "string" },
        },
        required: ["idea", "shot", "why"],
      },
    },
  },
  required: ["scenes"],
};

const MODE_RULES: Record<PhotoMode, string> = {
  one: "One photo. Pick the single scene that best fits what she asked for.",
  set: "A set from ONE shoot: the same place, the same outfit and the same light in every idea, and a different pose, framing or moment in each (full length, chest up, glancing away, mid-laugh, holding the prop). Say the outfit and the place in every idea so they match.",
  related: "A sequence of scenes that belong together in time (a morning, a trip, a work day): different places or moments that tell one story in order, the same outfit unless the story changes it.",
  various: "Different scenes with nothing in common but her: vary the place, the outfit, the light and the shot type so no two look alike.",
};

const SYSTEM = `You plan photos of one creator's AI avatar for her Instagram. Each idea is a rough scene in the form the photo prompt writer takes: where she is, what she is doing, what she holds or wears that stands out, and the light. One or two sentences, plain words, daylight only, no readable text or brands, never a race, ethnicity or nationality. Prefer the menu when a menu scene fits; write your own when it does not, in the same short form. "why" is one short clause on why this scene fits what she asked for.

Constraints travel: every constraint in what she asked for goes into EVERY idea, in the same words (what must not be in the picture, for example "the phone is not visible"; the angle, for example "from high above, the camera at arm's length"; the kind of shot). The shot type follows her words: a 0.5, wide or arm's-length selfie is "wide_selfie"; a selfie is "selfie"; a mirror shot is "mirror"; a photo taken of her by someone else is "friend".`;

/** The planner's rules. The ideas feed the photo prompt writer, so they are English whatever language she wrote in. */
export function scenesSystem(language?: string): string {
  return withEnglishFields(SYSTEM, language, "every idea and every why");
}

export async function planScenes(input: {
  brief: string;
  mode: PhotoMode;
  count: number;
  scene?: string;
  lock: Pick<IdentityLock, "wardrobe" | "scenes"> | null;
  /** Her content language. The ideas go to the photo prompt writer, so they stay English whatever she wrote in. */
  language?: string;
}): Promise<SceneIdea[]> {
  const count = clampCount(input.count);
  const menu = [
    ...(input.lock?.scenes ?? []).map((place) => `- ${place} (selfie)`),
    ...SCENE_GROUPS.flatMap((group) => group.scenes.map((scene) => `- ${scene.idea} (${scene.shot})`)),
  ];
  const { scenes } = await generateText<{ scenes: SceneIdea[] }>({
    system: scenesSystem(input.language),
    schema: SCHEMA,
    thinking: "low",
    prompt: [
      `Plan exactly ${count} ${count === 1 ? "photo" : "photos"}.`,
      `What she asked for: ${input.brief}`,
      input.scene ? `She named this place or activity; every idea uses it: ${input.scene}` : "",
      `Kind of set: ${MODE_RULES[input.mode]}`,
      input.lock?.wardrobe?.length ? `Her usual wardrobe (pick from it where an outfit is needed):\n${input.lock.wardrobe.map((item) => `- ${item}`).join("\n")}` : "",
      `Scene menu, with the shot type that suits each:\n${menu.join("\n")}`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });
  return tidyScenes(scenes, count);
}

export function clampCount(count: number): number {
  return Math.min(MAX_PHOTOS, Math.max(1, Math.round(Number.isFinite(count) ? count : 1)));
}

/** Exactly `count` usable ideas: trimmed, a real shot type, none shorter than a sentence. */
export function tidyScenes(scenes: readonly Partial<SceneIdea>[], count: number): SceneIdea[] {
  const clean = scenes
    .map((scene) => ({
      idea: (scene.idea ?? "").trim().replace(/\s+/g, " ").slice(0, 400),
      shot: SHOTS.includes(scene.shot as ShotType) ? (scene.shot as ShotType) : ("selfie" as ShotType),
      why: (scene.why ?? "").trim().slice(0, 160),
    }))
    .filter((scene) => scene.idea.length >= 12)
    .slice(0, count);
  if (clean.length === 0) throw new Error("The planner returned no usable scene. Say where she is and what she is doing.");
  return clean;
}

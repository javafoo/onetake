import { toReference, type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import { sceneOf } from "../content/motion-ideas";
import { getMedia, updateMediaMeta, withLocalFile } from "../data/media";

import { applyPhotos, photoSlots, photoSubject, settlePicks, type Candidate } from "./match";
import type { CarouselSpec } from "./spec";

/* Matching a written set to the photos it will sit on. Two model calls at
   most per photo, ever, and one per set:

   - What a photo shows. A generated photo already says, in the scene it was
     made from. An upload is looked at once, at 512px, and the sentence is kept
     on its row (`meta.description`), so the second set that uses it costs
     nothing.
   - Which photo goes where: one text call over the descriptions and the
     lines, settled by `settlePicks`, which a bad answer cannot get past. */

export interface FitDeps {
  model?: typeof generateText;
  thumbnail?: (userId: string, mediaId: string) => Promise<InlineImage>;
}

const DESCRIBE_SYSTEM =
  "You describe one photograph for someone choosing which photo goes behind a line of text in an Instagram post. " +
  "One plain sentence of at most twenty-five words: what is in it, where, and the mood. " +
  "Say whether a person's face is visible. Never guess who anyone is, their age, race, ethnicity or nationality.";

/** What a photo shows, in one sentence, from the row when it is known. Null when it cannot be told. */
export async function photoDescription(userId: string, mediaId: string, deps: FitDeps = {}): Promise<string | null> {
  const media = await getMedia(userId, mediaId);
  if (!media) return null;
  const stored = (media.meta as { description?: unknown }).description;
  if (typeof stored === "string" && stored.trim()) return stored.trim();
  const scene = sceneOf(media);
  if (scene) return scene.slice(0, 400);

  const image = await (deps.thumbnail ?? ((user, id) => withLocalFile(user, id, (path) => toReference(path, 512))))(userId, mediaId);
  const answer = await (deps.model ?? generateText)<{ description: string }>({
    system: DESCRIBE_SYSTEM,
    schema: { type: "object", properties: { description: { type: "string" } }, required: ["description"] },
    thinking: "low",
    images: [image],
    prompt: "Describe this photograph.",
  });
  const description = answer?.description?.trim().replace(/\s+/g, " ").slice(0, 400);
  if (!description) return null;
  await updateMediaMeta(userId, mediaId, { description });
  return description;
}

const MATCH_SYSTEM =
  "You place photos behind the lines of an Instagram carousel. Each slot is one line of text; pick the photo whose content fits that line best, " +
  "literally where you can (a line about finances over a desk or a laptop, a line about a hobby over the hobby) and by mood where you cannot. " +
  "Use each photo once before using any photo twice. Photos marked 'of her' show the creator; use at least one of those on the first slide.";

/** One media id per photo slot: the model's picks, settled so a bad answer cannot get through. */
export async function choosePhotos(spec: CarouselSpec, candidates: Candidate[], deps: FitDeps = {}): Promise<string[]> {
  const slots = photoSlots(spec);
  const answer = await (deps.model ?? generateText)<{ picks: number[] }>({
    system: MATCH_SYSTEM,
    schema: { type: "object", properties: { picks: { type: "array", items: { type: "integer" } } }, required: ["picks"] },
    thinking: "low",
    prompt: [
      `Photos:\n${candidates.map((photo, index) => `${index}. ${photo.subject === "me" ? "(of her) " : ""}${photo.description}`).join("\n")}`,
      `Slots, in order:\n${slots.map((slot, index) => `${index}. slide ${slot.slide + 1}: ${slot.text}`).join("\n")}`,
      `Answer with "picks": exactly ${slots.length} photo numbers, one per slot, in slot order.`,
    ].join("\n\n"),
  });
  return settlePicks(slots, candidates, answer?.picks ?? [], spec);
}

/**
 * The set, re-pointed at the photos that fit each line. Returns the photos
 * as they were when there is nothing to choose between, and falls back to the
 * writer's order when a model call fails: a set in the wrong order is still a
 * set, and matching is a nicety on top of it.
 */
export async function fitPhotos(
  userId: string,
  spec: CarouselSpec,
  mediaIds: string[],
  deps: FitDeps = {},
): Promise<{ spec: CarouselSpec; photos: Record<string, string> } | null> {
  const slots = photoSlots(spec);
  if (!slots.length || mediaIds.length < 2) return null;
  try {
    const candidates: Candidate[] = [];
    for (const id of mediaIds) {
      const media = await getMedia(userId, id);
      if (!media) continue;
      candidates.push({ id, subject: photoSubject(media.meta), description: (await photoDescription(userId, id, deps)) ?? "a photo" });
    }
    if (candidates.length < 2) return null;
    return applyPhotos(spec, slots, await choosePhotos(spec, candidates, deps));
  } catch {
    return null;
  }
}

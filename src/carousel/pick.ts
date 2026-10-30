import { layoutTakesScenes, type PhotoSubject } from "./match";
import { photoRef, spreadRefs } from "./photos";
import type { Format, Layout } from "./spec";

/* Which photos a set uses when the creator picks none.

   The rule, in order: her own generated photos before the reference originals
   (the references are setup material, not content), newest first because that
   is the look she has most recently approved, and then spread so two covers in
   one set are not two frames of the same shot. Pure: ids in, ids out. */

export type PhotoCandidate = {
  id: string;
  /** "image" is a generated library photo, "reference" an original she uploaded. */
  kind: "image" | "reference";
  /** Newest first is the intent; this is what decides it. */
  createdAt: number;
  /** A scene photo (no face needed) is only picked for the layouts that take one. Absent means her. */
  subject?: PhotoSubject;
};

/** How many photos to offer the matcher for a set: what it needs, plus some
    room to choose, since a split or grid set places each photo by its line. */
export function photoPool(format: Format, layout: Layout = "mixed"): number {
  const needed = photosNeeded(format, layout);
  return layoutTakesScenes(layout) ? Math.min(24, needed + 9) : needed;
}

/** How many different photos a set can actually show: the covers, plus the last
    slide. An all-photo set shows one on every slide; asking for that many keeps
    repeats to a minimum, and a short library simply repeats. A split set
    shows two a slide and a grid set opens on four, at the default length:
    eight slides for a carousel, four for a story. */
export function photosNeeded(format: Format, layout: Layout = "mixed"): number {
  const slides = format === "story" ? 4 : 8;
  if (layout === "split") return (slides - 1) * 2 + 1;
  if (layout === "grid") return 4 + (slides - 2) + 1;
  if (layout === "photos") return format === "story" ? 5 : 8;
  return format === "story" ? 2 : 3;
}

/**
 * The automatic pick. Returns up to `count` media ids, best first, or an empty
 * list when there is nothing to pick from — the caller decides what to say
 * about that, because "you have no photos yet" is a different sentence in every
 * place it appears.
 */
export function autoPickPhotos(candidates: PhotoCandidate[], count: number, layout: Layout = "mixed"): string[] {
  if (count <= 0) return [];
  const scenes = layoutTakesScenes(layout);
  const newestFirst = (kind: PhotoCandidate["kind"]) =>
    candidates
      .filter((photo) => photo.kind === kind && (scenes || photo.subject !== "scene"))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((photo) => photo.id);
  /* Spread inside each group and then put the groups in order, rather than
     spreading the lot: a reference must never be reached for while there is
     still a library photo that has not been used. */
  return [...spreadRefs(newestFirst("image")), ...spreadRefs(newestFirst("reference"))].slice(0, count);
}

/**
 * The photo references the spec uses, in the order the writer hands them to
 * cover slides, paired with the media each one resolves to. A set with fewer
 * photos than covers reuses them, which the writer already does by cycling.
 */
export function photoMap(mediaIds: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  mediaIds.forEach((mediaId, index) => {
    map[photoRef(index)] = mediaId;
  });
  return map;
}

/** A lowercase slug for the output folder name in the spec. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34)
    .replace(/-+$/, "");
}

/** The spec's `name`: the topic, the kit and, for a story, that it is one. */
export function carouselName(topic: string, kitId: string, format: Format): string {
  return [slugify(topic) || "carousel", slugify(kitId), format === "story" ? "story" : null]
    .filter(Boolean)
    .join("-")
    .slice(0, 48);
}

import { photoRef } from "./photos";
import { slidePhotos, type CarouselSpec, type Layout, type Slide } from "./spec";

/* Which photo goes behind which words.

   The writer hands photos out in turn, because it cannot see them. For a set
   where the photo carries the line ("restart a hobby you forgot you had" over
   an easel) that is not good enough, so once the words exist each photo slot
   is matched to a photo by what the photo shows. A model proposes; this file
   decides. Everything here is pure: descriptions and picks in, a spec out. */

/** "me": a photo of the creator. "scene": a place, an object, a moment with no
    face needed, uploaded for exactly these sets. */
export type PhotoSubject = "me" | "scene";

export function photoSubject(meta: unknown): PhotoSubject {
  return (meta as { subject?: unknown } | null)?.subject === "scene" ? "scene" : "me";
}

/** Scene photos belong in the sets whose slides are a line over a picture.
    A cover in the other layouts is her, with a title across her. */
export function layoutTakesScenes(layout: Layout): boolean {
  return layout === "split" || layout === "grid";
}

export type PhotoSlot = {
  slide: number;
  /** Which photo on the slide: 0 for a one-photo slide, 0-1 on a split, 0-3 on a grid. */
  slot: number;
  /** The words the photo sits under, which is what it is matched to. */
  text: string;
};

function slideWords(slide: Slide): string {
  switch (slide.type) {
    case "split":
      return slide.lines.join(" / ");
    case "line":
      return slide.text;
    case "grid":
      return [slide.headline, slide.sub].filter(Boolean).join(" ");
    case "keyword":
      return slide.promise;
    case "cover":
      return [...slide.title.lines, slide.sub].filter(Boolean).join(" ");
    case "paper":
      return "";
  }
}

/** Every photo slot in the set, in the order a reader meets them. */
export function photoSlots(spec: CarouselSpec): PhotoSlot[] {
  return spec.slides.flatMap((slide, index) => {
    const count = slidePhotos(slide).length;
    if (!count) return [];
    // A split's two halves each have their own line; everything else shares the slide's words.
    return Array.from({ length: count }, (_, slot) => ({
      slide: index,
      slot,
      text: slide.type === "split" ? slide.lines[slot] : slideWords(slide),
    }));
  });
}

export type Candidate = { id: string; description: string; subject: PhotoSubject };

/**
 * One media id per slot. `picks` is what the model chose, as candidate
 * numbers per slot; anything out of range, or a photo already used while
 * unused ones remain, is dropped and the slot is filled from the unused
 * photos in the order they came. The grid cover always gets at least one
 * photo of her when there is one: four objects under a title reads as stock.
 */
export function settlePicks(slots: PhotoSlot[], candidates: Candidate[], picks: readonly number[], spec?: CarouselSpec): string[] {
  if (!candidates.length) throw new Error("No photos to place.");
  const used = new Map<number, number>();
  const chosen: (number | null)[] = slots.map((_, index) => {
    const pick = picks[index];
    if (!Number.isInteger(pick) || pick < 0 || pick >= candidates.length) return null;
    return pick;
  });

  // A repeat is allowed only once every photo has been used once.
  chosen.forEach((pick, index) => {
    if (pick === null) return;
    if (used.has(pick) && used.size < candidates.length) chosen[index] = null;
    else used.set(pick, (used.get(pick) ?? 0) + 1);
  });

  let next = 0;
  const fill = (): number => {
    // The least-used photo, earliest first: repeats spread out rather than piling on one picture.
    const least = Math.min(...candidates.map((_, index) => used.get(index) ?? 0));
    for (let step = 0; step < candidates.length; step += 1) {
      const index = (next + step) % candidates.length;
      if ((used.get(index) ?? 0) === least) {
        next = index + 1;
        return index;
      }
    }
    return 0;
  };
  const settled = chosen.map((pick) => {
    if (pick !== null) return pick;
    const index = fill();
    used.set(index, (used.get(index) ?? 0) + 1);
    return index;
  });

  if (spec?.slides[0]?.type === "grid") {
    const cover = slots.map((slot, index) => (slot.slide === 0 ? index : -1)).filter((index) => index >= 0);
    const hasHer = cover.some((index) => candidates[settled[index]].subject === "me");
    const her = candidates.findIndex((candidate) => candidate.subject === "me");
    if (!hasHer && her >= 0 && cover.length) {
      // Swap her in for the cover photo she would otherwise sit furthest from: the first cell.
      const elsewhere = settled.findIndex((pick, index) => pick === her && !cover.includes(index));
      if (elsewhere >= 0) settled[elsewhere] = settled[cover[0]];
      settled[cover[0]] = her;
    }
  }
  return settled.map((index) => candidates[index].id);
}

/** The spec with every photo slot pointed at its matched photo, and the ref map to store with it. */
export function applyPhotos(spec: CarouselSpec, slots: PhotoSlot[], mediaIds: string[]): { spec: CarouselSpec; photos: Record<string, string> } {
  const refOf = new Map<string, string>();
  const photos: Record<string, string> = {};
  const ref = (mediaId: string) => {
    let known = refOf.get(mediaId);
    if (!known) {
      known = photoRef(refOf.size);
      refOf.set(mediaId, known);
      photos[known] = mediaId;
    }
    return known;
  };
  const bySlide = new Map<number, string[]>();
  slots.forEach((slot, index) => {
    const list = bySlide.get(slot.slide) ?? [];
    list[slot.slot] = ref(mediaIds[index]);
    bySlide.set(slot.slide, list);
  });
  const slides = spec.slides.map((slide, index): Slide => {
    const refs = bySlide.get(index);
    if (!refs) return slide;
    switch (slide.type) {
      case "split":
        return { ...slide, photos: [refs[0], refs[1]] };
      case "grid":
        return { ...slide, photos: [refs[0], refs[1], refs[2], refs[3]] };
      case "cover":
      case "line":
      case "keyword":
        return { ...slide, photo: refs[0] };
      case "paper":
        return slide;
    }
  });
  return { spec: { ...spec, slides }, photos };
}

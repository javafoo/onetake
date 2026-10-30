/* The two photo styles an avatar can be made in, and the names a menu needs.
   Like shot-types.ts this is the part of `src/style/` the browser may see: a
   name and a sentence for a picker, nothing about how the photo is made. What
   each style asks of the image model is in house-style.ts, which is server-only.

   The style is stored on the avatar's identity lock (`photoStyle`), so it needs
   no column. Absent is "everyday", which is what every avatar made before this
   existed was drawn in. */

import type { ShotType } from "./shot-types";

export const PHOTO_STYLES = ["everyday", "editorial"] as const;
export type PhotoStyle = (typeof PHOTO_STYLES)[number];

export const DEFAULT_PHOTO_STYLE: PhotoStyle = "everyday";

export const PHOTO_STYLE_LABEL: Record<PhotoStyle, { name: string; blurb: string }> = {
  everyday: {
    name: "Everyday",
    blurb: "Looks like a phone photo a friend would post: selfies, mirrors, a friend holding the camera, daylight.",
  },
  editorial: {
    name: "Editorial",
    blurb: "Looks like a styled shoot with a photographer: polished light, a set, a composed pose, room above her for a headline.",
  },
};

export function isPhotoStyle(value: unknown): value is PhotoStyle {
  return typeof value === "string" && (PHOTO_STYLES as readonly string[]).includes(value);
}

/** The style a lock asks for; anything missing or unknown is the everyday one. */
export function photoStyleOf(lock: { photoStyle?: unknown } | null | undefined): PhotoStyle {
  return isPhotoStyle(lock?.photoStyle) ? lock.photoStyle : DEFAULT_PHOTO_STYLE;
}

/* The four shot types keep their ids in both styles (a stored job names one),
   but a menu has to say what they mean in the style being made: nobody holds a
   phone in an editorial set. */
export const SHOT_LABEL_BY_STYLE: Record<PhotoStyle, Record<ShotType, string>> = {
  everyday: {
    selfie: "Front-camera selfie",
    wide_selfie: "0.5x wide selfie",
    mirror: "Mirror selfie",
    friend: "A friend took it",
  },
  editorial: {
    selfie: "Portrait",
    wide_selfie: "Full-length, wide",
    mirror: "With a mirror in the set",
    friend: "Behind the scenes",
  },
};

/* An editorial avatar still gets a real selfie when the idea asks for one: what
   she types about the picture wins over the style's default. "Otherwise" is the
   idea ruling it out ("not a selfie", "no phone", "without a phone"). */
const SELFIE = /\bselfies?\b/i;
const RULED_OUT = /\b(?:no|not|without|never|instead of|rather than)\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,2}(?:selfies?|phone)\b/i;

export function asksForSelfie(idea: string): boolean {
  return SELFIE.test(idea) && !RULED_OUT.test(idea);
}

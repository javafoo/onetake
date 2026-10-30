/* The kinds of shot and their labels. This is the one part of `src/style/`
   the browser may see: a name for a menu, nothing about how the photo is
   made. The prompt openings, the look and the judge stay in house-style.ts,
   which is server-only. */

export type ShotType = "selfie" | "wide_selfie" | "mirror" | "friend";

export const SHOT_LABEL: Record<ShotType, string> = {
  selfie: "Front-camera selfie",
  wide_selfie: "0.5x wide selfie",
  mirror: "Mirror selfie",
  friend: "A friend took it",
};

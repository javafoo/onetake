/* Where the hook sits in a 9:16 frame. Pure geometry so it can be tested
   without a video. All values are fractions of the frame height. */

export const SAFE_TOP = 0.12; // below the Reels header
export const SAFE_BOTTOM = 0.78; // above the caption, buttons and audio row
export const DEFAULT_CENTRE = 0.42;
export const FACE_MARGIN = 0.03;

/** The taller of the two clear bands inside the safe area, above or below the
    face, as a fraction of the frame; the whole safe area when there is no face.
    A hook sized to fit here never has to cover her. */
export function clearHeight(face: FaceZone | null): number {
  if (!face) return SAFE_BOTTOM - SAFE_TOP;
  const below = SAFE_BOTTOM - (face.bottom + FACE_MARGIN);
  const above = face.top - FACE_MARGIN - SAFE_TOP;
  return Math.max(0, below, above);
}
/** Space between the hook block and a cue placed next to it. */
export const CUE_GAP = 0.018;

/** Vertical span of the face across the whole clip. */
export type FaceZone = { top: number; bottom: number };
export type Placement = { top: number; reason: "default" | "below_face" | "above_face" | "lowest_safe" };

export function placeBlock(blockHeight: number, face: FaceZone | null): Placement {
  const fits = (top: number) => top >= SAFE_TOP && top + blockHeight <= SAFE_BOTTOM;
  const centred = Math.min(Math.max(DEFAULT_CENTRE - blockHeight / 2, SAFE_TOP), SAFE_BOTTOM - blockHeight);
  if (!face) return { top: centred, reason: "default" };

  const overlapsFace = centred < face.bottom + FACE_MARGIN && centred + blockHeight > face.top - FACE_MARGIN;
  if (!overlapsFace) return { top: centred, reason: "default" };

  const below = face.bottom + FACE_MARGIN;
  if (fits(below)) return { top: below, reason: "below_face" };

  const above = face.top - FACE_MARGIN - blockHeight;
  if (fits(above)) return { top: above, reason: "above_face" };

  // A face that fills the frame: sit as low as the safe area allows, which covers the chin, not the eyes.
  return { top: SAFE_BOTTOM - blockHeight, reason: "lowest_safe" };
}

export type Block = { top: number; height: number };
export type CuePlacement = { top: number; reason: "below_hook" | "above_hook" | "lowest_safe" };

/** The cue sits just under the hook, where the eye lands after reading it. It
    moves above the hook when below would leave the safe area or cover the face,
    and only covers the face when there is nowhere else. */
export function placeCue(hook: Block, cueHeight: number, face: FaceZone | null): CuePlacement {
  const fits = (top: number) => top >= SAFE_TOP && top + cueHeight <= SAFE_BOTTOM;
  const clear = (top: number) => !face || top >= face.bottom + FACE_MARGIN || top + cueHeight <= face.top - FACE_MARGIN;
  const below = hook.top + hook.height + CUE_GAP;
  const above = hook.top - CUE_GAP - cueHeight;

  if (fits(below) && clear(below)) return { top: below, reason: "below_hook" };
  if (fits(above) && clear(above)) return { top: above, reason: "above_hook" };
  if (fits(below)) return { top: below, reason: "below_hook" };
  if (fits(above)) return { top: above, reason: "above_hook" };
  return { top: SAFE_BOTTOM - cueHeight, reason: "lowest_safe" };
}

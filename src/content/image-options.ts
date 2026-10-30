/* What a creator chooses when she asks for a photo: which image model, and what
   shape the photo comes out.

   Pure and client-safe, so the composer, the server action, the job input and
   the Gemini client all read one list. The model ids are the ones
   `src/billing/pricing.ts` prices under `kind: "image"`, so a name here and a
   price there cannot drift apart. */

export type ImageModel = "daily" | "pro";

/** `short` is the name on a phone's model chip, where the full name pushed the shape off the end. */
export const IMAGE_MODELS: Record<ImageModel, { label: string; short: string; blurb: string }> = {
  daily: { label: "Nano Banana 2.1", short: "NB2.1", blurb: "Fast. Good for most photos." },
  pro: { label: "Nano Banana Pro", short: "NB Pro", blurb: "Sharper detail and text. Slower." },
};

/** Nano Banana 2.1 is the everyday model; Pro is picked on purpose. */
export const DEFAULT_IMAGE_MODEL: ImageModel = "daily";

export type ImageAspect = "4:5" | "5:4" | "1:1" | "9:16" | "16:9";

export const IMAGE_ASPECTS: readonly ImageAspect[] = ["4:5", "5:4", "1:1", "9:16", "16:9"];

/** The Instagram feed portrait; the shape most photos are posted at. */
export const DEFAULT_IMAGE_ASPECT: ImageAspect = "4:5";

export function isImageModel(value: unknown): value is ImageModel {
  return value === "daily" || value === "pro";
}

export function isImageAspect(value: unknown): value is ImageAspect {
  return IMAGE_ASPECTS.some((aspect) => aspect === value);
}

/**
 * The shape to generate at, from whatever was stored or sent.
 *
 * Rows written before the five-shape list existed carry "3:4"; that is read as
 * the feed portrait it was standing in for rather than migrated. Anything
 * unrecognised is the default, because a wrong shape costs one credit and a
 * refused request costs a conversation.
 */
export function normalizeImageAspect(value: unknown): ImageAspect {
  if (value === "3:4") return "4:5";
  return isImageAspect(value) ? value : DEFAULT_IMAGE_ASPECT;
}

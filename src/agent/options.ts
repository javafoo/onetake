import { layoutFrom } from "@/carousel/spec";
import { isClipModel, type ClipModel } from "@/content/clip-options";
import { isImageAspect, isImageModel, type ImageAspect, type ImageModel } from "@/content/image-options";
import { isTextSize, normalizeTextStyle, type TextSize, type TextStyle } from "@/content/text-styles";

import { isUuid } from "@/data/ids";
import { InvalidRequestError } from "@/lib/errors";

import { CLIP_NOT_A_SLIDE, kitForTextStyle } from "./composer";
import { MAX_WORDS_CHARS, TEXT_PHOTO_NEEDS_PHOTO, TEXT_PHOTO_REPLY } from "./text-photo";
import { drawsWords, MAX_MATERIAL_PHOTOS, type AgentRequest, type Material } from "./plan";

/* What the composer's pickers say, laid over what the words asked for. Kept
   out of the server action file so it can be tested without a network, and
   because a "use server" module may only export async functions. */

/**
 * The pickers win over the words, but only the ones she set: the Text picker
 * is the reel's look and the set's kit alike, the image model and shape always
 * have a value, and the video model and the slides format are sent only when
 * she picked them. An absent one leaves the run's own choice standing, so a
 * talking reel still gets the model that can speak.
 */
export type AskOptions = {
  style?: TextStyle;
  /** Sent only when she changed it in the Text picker; otherwise what her words said stands. */
  size?: TextSize;
  /** The same: sent only when she set the case toggle herself. */
  lowercase?: boolean;
  imageModel?: ImageModel;
  imageAspect?: ImageAspect;
  clipModel?: ClipModel;
  format?: "carousel" | "story";
  /** The slides layout, only when she picked one in the Slides panel. */
  layout?: string;
  /** She picked the image shape herself: words on her photo are cut to it rather than kept at the photo's own shape. */
  aspectPicked?: boolean;
  /** The Slides tab was the one chosen when she sent. */
  slides?: boolean;
  /** The Brand chip, sent only when she set it; otherwise her words decide (src/agent/brand-read.ts). */
  brand?: boolean;
};

/* Each value is checked by name: a server action is a public endpoint, and an
   unknown model must not be priced as whatever it is closest to. */
export function withOptions(request: AgentRequest, options: AskOptions): AgentRequest {
  const style = options.style === undefined ? undefined : normalizeTextStyle(options.style);
  const imageModel = isImageModel(options.imageModel) ? options.imageModel : undefined;
  const imageAspect = isImageAspect(options.imageAspect) ? options.imageAspect : undefined;
  const clipModel = isClipModel(options.clipModel) ? options.clipModel : undefined;
  const look = { ...(isTextSize(options.size) ? { size: options.size } : {}), ...(typeof options.lowercase === "boolean" ? { lowercase: options.lowercase } : {}) };
  if (request.kind === "reel") {
    return { ...request, ...(style ? { style } : {}), ...look, ...(imageModel ? { model: imageModel } : {}), ...(clipModel ? { clipModel } : {}) };
  }
  if (request.kind === "photos") {
    // The Text picker is the look of the words when words go on the photo.
    const words = drawsWords(request) ? { ...(style ? { style } : {}), ...look } : {};
    return { ...request, ...(imageAspect ? { aspect: imageAspect } : {}), ...(imageModel ? { model: imageModel } : {}), ...words };
  }
  if (request.kind === "text_photo") return { ...request, ...(style ? { style } : {}), ...look, ...(imageAspect && options.aspectPicked === true ? { aspect: imageAspect } : {}) };
  const format = options.format === "story" || options.format === "carousel" ? options.format : request.format;
  // A layout she picked wins over the one read from her words; "mixed" is the absence of one.
  const layout = options.layout === undefined ? request.layout : layoutFrom(options.layout);
  const { layout: _read, ...rest } = request;
  void _read;
  return { ...rest, format, ...(layout && layout !== "mixed" ? { layout } : {}), ...(style ? { kit: kitForTextStyle(style) } : {}), ...look };
}

/**
 * Size and case as a manual job carries them, from what the chat sent: only
 * "small" and a true lowercase are kept, since large and as-typed are what a
 * job does when it is told nothing. Anything unreadable is the default.
 */
export function textLookInput(input: { size?: unknown; lowercase?: unknown }): { size?: "small"; lowercase?: true } {
  return { ...(input.size === "small" ? { size: "small" as const } : {}), ...(input.lowercase === true ? { lowercase: true as const } : {}) };
}

/** What the chat sends for the library items attached with +: ids only, checked for shape here and for owner by the action. */
export type MaterialInput = { photos?: unknown; clip?: unknown };

const isId = (value: unknown): value is string => typeof value === "string" && isUuid(value);

/**
 * The attached ids as the run will carry them, or null for none. Anything
 * that is not an id is refused rather than dropped: a quietly shortened list
 * would make a set from photos she did not choose.
 */
export function parseMaterial(raw: MaterialInput | undefined | null): Material | null {
  if (!raw) return null;
  const photos = raw.photos === undefined || raw.photos === null ? [] : raw.photos;
  if (!Array.isArray(photos) || !photos.every(isId)) throw new InvalidRequestError("The attached photos could not be read. Attach them again with +.");
  if (photos.length > MAX_MATERIAL_PHOTOS) throw new InvalidRequestError(`Up to ${MAX_MATERIAL_PHOTOS} photos per message.`);
  if (raw.clip !== undefined && raw.clip !== null && !isId(raw.clip)) throw new InvalidRequestError("The attached clip could not be read. Attach it again with +.");
  const unique = [...new Set(photos)];
  const clip = isId(raw.clip) ? raw.clip : undefined;
  return unique.length || clip ? { photos: unique, ...(clip ? { clip } : {}) } : null;
}

/**
 * Attached items laid onto what the words asked for. A reel keeps the clip,
 * or else the photos (it animates the first); photos and sets keep only the
 * photos. A set asked for with nothing but a clip is refused in words.
 */
export function withMaterial(request: AgentRequest, material: Material | null): AgentRequest {
  // Words on a photo are never drawn on a new one: without her photo there is nothing to run.
  if (request.kind === "text_photo" && !material?.photos.length) throw new InvalidRequestError(TEXT_PHOTO_NEEDS_PHOTO);
  if (!material) return request;
  if (request.kind === "reel") return { ...request, material };
  if (!material.photos.length) {
    if (request.kind === "carousel") throw new InvalidRequestError(CLIP_NOT_A_SLIDE);
    return request;
  }
  return { ...request, material: { photos: material.photos } };
}

/**
 * With the agent on and the Slides tab chosen, one photo of hers attached and
 * words given, a request the reader took for new photos is words on that
 * photo instead: Slides with a photo means her photo with words on it, and a
 * new photo would charge for something she did not ask for. Narrow on
 * purpose: only "photos", only one attached photo, only with words.
 */
export function slidesMeansTextPhoto(
  request: AgentRequest,
  options: Pick<AskOptions, "slides">,
  words: string | undefined,
): { request: AgentRequest; reply?: string } {
  const text = words?.trim();
  if (request.kind !== "photos" || options.slides !== true || request.material?.photos.length !== 1 || !text || text.length > MAX_WORDS_CHARS) return { request };
  return { request: { kind: "text_photo", brief: request.brief, words: text, material: { photos: request.material.photos } }, reply: TEXT_PHOTO_REPLY };
}

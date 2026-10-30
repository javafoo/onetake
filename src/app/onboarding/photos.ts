import { ACCEPTED_IMAGE_TYPES, normaliseType } from "@/lib/image-bytes";

import { MAX_PHOTOS, MIN_PHOTOS } from "./flow";

/* What the upload endpoint accepts before it has read a byte. The browser
   downscales every photo to a 2048px JPEG first, so these limits are a
   backstop against a script posting straight at the endpoint rather than the
   normal path. Nothing here touches the network or the database: it is one
   pure function so the refusals can be tested.

   What this does NOT decide is whether the file really is a photograph.
   `contentType` is the client's claim and is used for exactly one thing:
   turning away an obvious mistake before the bytes are read. The check that
   counts is on the bytes, in `src/lib/image-bytes.ts`, and the route refuses
   anything whose contents disagree with its claim. */

export const ACCEPTED_TYPES = ACCEPTED_IMAGE_TYPES;
export { normaliseType };

/** A 2048px JPEG lands around 400KB. Eight megabytes is a generous original. */
export const MAX_BYTES = 8 * 1024 * 1024;
/** Under this and the file is not a photograph, whatever its headers claim. */
export const MIN_BYTES = 2 * 1024;

export { MAX_PHOTOS, MIN_PHOTOS };

export type UploadCheck = { contentType: string; bytes: number; existing: number; consented: boolean };
export type UploadVerdict = { ok: true } | { ok: false; status: number; message: string };

/** Consent is checked first: without it there is no lawful reason to hold the
    bytes at all, so nothing else about the file matters. */
export function checkUpload(input: UploadCheck): UploadVerdict {
  if (!input.consented) {
    return { ok: false, status: 403, message: "Tick the box above before adding photos." };
  }
  const type = normaliseType(input.contentType);
  if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
    return { ok: false, status: 415, message: "That file is not a JPEG, PNG or WebP photo." };
  }
  if (input.bytes > MAX_BYTES) {
    return { ok: false, status: 413, message: "That photo is bigger than 8MB. Try one straight from your camera roll." };
  }
  if (input.bytes < MIN_BYTES) {
    return { ok: false, status: 400, message: "That file is too small to be a photo." };
  }
  if (input.existing >= MAX_PHOTOS) {
    return { ok: false, status: 409, message: `${MAX_PHOTOS} photos is the most we can use. Remove one first.` };
  }
  return { ok: true };
}

/** The line under the picker: what is still needed, in her numbers. */
export function photoCountMessage(count: number): string {
  if (count === 0) return `Add ${MIN_PHOTOS} to ${MAX_PHOTOS} photos of her.`;
  if (count < MIN_PHOTOS) {
    const left = MIN_PHOTOS - count;
    return `${count} added. ${left} more ${left === 1 ? "photo" : "photos"} and you can carry on.`;
  }
  return `${count} photos added. You can add ${MAX_PHOTOS - count} more, or carry on.`;
}

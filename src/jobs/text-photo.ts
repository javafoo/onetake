import type { FaceBox } from "@/carousel/render";
import { MAX_TEXT_PHOTO_CHARS, textPhotoFrame, textPhotoLines } from "@/carousel/text-photo";
import { localeFor } from "@/content/languages";
import { TEXT_STYLES, normalizeTextSize, normalizeTextStyle, onScreenCase, type TextSize, type TextStyle } from "@/content/text-styles";

import type { StepOutcome } from "./providers";
import type { JobRecord, TextPhotoJobInput } from "./types";

/* Words on one of her photos, as a job: find her photo, find its face, draw
   the words the way a cover of that look would, and file the result beside
   the photo it was drawn on. Everything that reads or writes storage comes in
   through `TextPhotoDeps`, so the job can be walked with fakes. */

/** The photo row as this job needs it. */
export type SourcePhoto = {
  id: string;
  kind: string;
  avatarId: string | null;
  folderId: string | null;
  width: number | null;
  height: number | null;
  meta: Record<string, unknown>;
};

export interface TextPhotoDeps {
  /** The row, looked up scoped to this user: someone else's id is null. */
  photo(userId: string, mediaId: string): Promise<SourcePhoto | null>;
  read(userId: string, mediaId: string): Promise<Buffer>;
  /** Width and height read off the bytes, for a row that never stored them. */
  size(data: Buffer): { width: number; height: number } | null;
  face(userId: string, mediaId: string): Promise<FaceBox | null>;
  draw(input: { style: TextStyle; size: TextSize; data: Buffer; face: FaceBox | null; lines: string[]; frame: { width: number; height: number; scale: number } }): Promise<Buffer>;
  save(
    userId: string,
    input: { avatarId: string | null; folderId: string | null; data: Buffer; width: number; height: number; meta: Record<string, unknown> },
  ): Promise<{ id: string }>;
}

export const NOT_YOUR_PHOTO = "That photo is not in your library any more. Attach it again with +.";

export async function makeTextPhoto(job: JobRecord, input: TextPhotoJobInput, deps: TextPhotoDeps): Promise<StepOutcome> {
  const text = input.text.trim();
  if (!text) throw new Error("There are no words to put on the photo.");
  if (text.length > MAX_TEXT_PHOTO_CHARS) throw new Error(`Keep the words under ${MAX_TEXT_PHOTO_CHARS} characters.`);

  // The id came in on a form or a run: it is hers only if her own lookup finds it.
  const source = await deps.photo(job.userId, input.photoMediaId);
  if (!source || source.kind !== "image" || source.meta.keep === false) throw new Error(NOT_YOUR_PHOTO);
  if (source.avatarId && job.avatarId && source.avatarId !== job.avatarId) throw new Error(NOT_YOUR_PHOTO);

  const data = await deps.read(job.userId, source.id);
  const size = source.width && source.height ? { width: source.width, height: source.height } : deps.size(data);
  if (!size) throw new Error("That photo's size could not be read.");
  const frame = textPhotoFrame(size, input.aspect);
  const style = normalizeTextStyle(input.style);
  const textSize = normalizeTextSize(input.size);
  const lowercase = input.lowercase === true;
  // Lowercase is how the words are drawn; `meta.words.text` keeps what she typed.
  const lines = textPhotoLines(onScreenCase(input.text, lowercase, localeFor(input.language)), textSize);
  const face = await deps.face(job.userId, source.id);
  const png = await deps.draw({ style, size: textSize, data, face, lines, frame });

  const saved = await deps.save(job.userId, {
    avatarId: source.avatarId ?? job.avatarId,
    // Beside the photo it was drawn on: a shoot's folder keeps its words.
    folderId: source.folderId,
    data: png,
    width: Math.round(frame.width * frame.scale),
    height: Math.round(frame.height * frame.scale),
    meta: {
      // The scene is the photo's own, so animating this one later knows what it shows.
      ...(typeof source.meta.idea === "string" ? { idea: source.meta.idea } : {}),
      ...(typeof source.meta.shot === "string" ? { shot: source.meta.shot } : {}),
      keep: true,
      jobId: job.id,
      sourceMediaIds: [source.id],
      words: { text: input.text, style, size: textSize, ...(lowercase ? { lowercase: true } : {}), ...(input.aspect ? { aspect: input.aspect } : {}) },
    },
  });
  const shape = input.aspect ? `cut to ${input.aspect}` : "at the photo's own shape";
  const look = `${TEXT_STYLES[style].label}${textSize === "small" ? ", small" : ""}${lowercase ? ", lowercase" : ""}`;
  return {
    mediaIds: [saved.id],
    message: `Your words are on the photo in the ${look} look, ${shape}. Free.`,
    costUsd: 0,
    meta: { sourceMediaId: source.id, lines: lines.length },
  };
}

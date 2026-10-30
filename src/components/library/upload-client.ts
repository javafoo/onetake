/* The browser side of "Add your own", shared by the Library page and the
 * chat's + picker so the two cannot drift apart about how a file gets in.
 *
 * Photos are downscaled here before they leave the browser — a phone photo is
 * five to twelve megabytes and the app never needs more than 2048px — and
 * posted in the body. Clips go in three steps, because our host refuses any
 * request body over 4.5MB before our code sees it: ask the server for a signed
 * URL (`/library/upload/start`), PUT the file straight into storage, then ask
 * the server to check and keep it (`/library/upload/finish`). When the server
 * has no signer (a local run), or the PUT cannot be made from this browser, a
 * clip small enough to post goes the old way and a larger one is refused with
 * a sentence that says so. */

import type { PhotoSubject } from "@/carousel/match";

export const MAX_SIDE = 2048;
const QUALITY = 0.85;

/** Kept in step with the server. It refuses again; this only saves her the upload. */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/** The most a request body to us may carry (`REQUEST_BODY_LIMIT` on the server). */
export const REQUEST_BODY_LIMIT = Math.floor(4.5 * 1024 * 1024);
/** What we tell her to stay under on the old path: a round number below the real ceiling. */
export const SMALL_CLIP_MB = 4;

/* What the file input offers. The video types are listed explicitly as well as
   by extension: a few Android pickers match on one and not the other, and an
   `accept` that misses means the camera roll opens with everything greyed out. */
export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.mp4,.mov";

export type UploadReply = { ok?: boolean; message?: string; id?: string; kind?: "image" | "clip"; url?: string; durationSeconds?: number | null };
type StartReply = UploadReply & { direct?: boolean; url?: string; pathname?: string; headers?: Record<string, string> };

/** Where a clip upload has got to, for a progress line. */
export type ClipUploadStage = "uploading" | "direct" | "checking" | "fallback";

export const isVideoFile = (file: File) => file.type.startsWith("video/") || /\.(mp4|mov|m4v)$/i.test(file.name);

export const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, "");

/** Redraw a photo at 2048px as a JPEG. Anything that will not decode goes up as it is. */
export async function downscale(file: File): Promise<{ body: Blob; type: string; name: string }> {
  /* An iPhone HEIC will not decode here. Rather than guess, the original goes
     up and the server says plainly that it is not a JPEG, PNG or WebP. */
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return { body: file, type: file.type, name: file.name };

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { body: file, type: file.type, name: file.name };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) return { body: file, type: file.type, name: file.name };
  return { body: blob, type: "image/jpeg", name: `${file.name.replace(/\.[^.]+$/, "")}.jpg` };
}

/** The MIME type the server will pin; a picker that gives none is told by the extension. */
function videoType(file: File): string {
  if (file.type) return file.type;
  return /\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4";
}

async function postJson<T extends UploadReply>(path: string, body: unknown): Promise<T | null> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await response.json().catch(() => null)) as T | null;
}

/** One file in the request body: the path photos always take and small clips fall back to. */
async function postFile(body: Blob, type: string, name: string, folder?: string, subject?: PhotoSubject): Promise<UploadReply | null> {
  const form = new FormData();
  form.append("file", new File([body], name, { type }));
  // Only ever called once the rights box is ticked; the server refuses without it.
  form.append("rights", "yes");
  // Only a scene is sent: a photo with no mark is of her, as every photo was before.
  if (subject === "scene") form.append("subject", subject);
  if (folder) form.append("folder", folder);
  const response = await fetch("/library/upload", { method: "POST", body: form });
  return (await response.json().catch(() => null)) as UploadReply | null;
}

/** A photo: shrunk here, then posted in the body. `subject` "scene" marks places and things. */
export async function uploadPhoto(file: File, folder?: string, subject?: PhotoSubject): Promise<UploadReply | null> {
  const { body, type, name } = await downscale(file);
  return postFile(body, type, name, folder, subject);
}

/** A clip: straight to storage when the server can sign for it, in the body when it cannot. */
export async function uploadClip(file: File, folder: string | undefined, onStage: (stage: ClipUploadStage) => void = () => undefined): Promise<UploadReply | null> {
  const type = videoType(file);
  onStage("uploading");
  const start = await postJson<StartReply>("/library/upload/start", { type, bytes: file.size, name: file.name, rights: "yes" });
  if (!start?.ok) return start;

  if (start.direct && start.url && start.pathname) {
    onStage("direct");
    let put: Response | null = null;
    try {
      put = await fetch(start.url, { method: "PUT", headers: start.headers ?? {}, body: file });
    } catch {
      /* A network error on the PUT, with no status at all, is what a bucket
         that has not been told to accept this site looks like from here.
         A small clip can still go the old way; a large one cannot. */
      put = null;
    }
    if (put?.ok) {
      onStage("checking");
      return postJson<UploadReply>("/library/upload/finish", {
        pathname: start.pathname,
        folderId: folder,
        kind: "clip",
        name: file.name,
        rights: "yes",
      });
    }
    if (put) return { ok: false, message: "That clip could not be uploaded. Try again in a moment." };
    if (file.size > REQUEST_BODY_LIMIT) {
      return {
        ok: false,
        message: `That clip could not be uploaded from this browser. Try one under ${SMALL_CLIP_MB}MB, or email us.`,
      };
    }
    onStage("fallback");
  } else if (file.size > REQUEST_BODY_LIMIT) {
    return {
      ok: false,
      message: `That clip is ${megabytes(file.size)}MB. ${SMALL_CLIP_MB}MB is the most that can be sent this way.`,
    };
  }

  return postFile(file, type, file.name, folder);
}

/** The refusal for a file too big to bother sending, or null when it may go. */
export function tooBig(file: File): string | null {
  const ceiling = isVideoFile(file) ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
  if (file.size <= ceiling) return null;
  return `${megabytes(file.size)}MB is too big — ${ceiling / 1024 / 1024}MB is the most we can take.`;
}

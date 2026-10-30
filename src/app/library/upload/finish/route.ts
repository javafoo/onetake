import { requireOwnFolder } from "@/data/folders";
import { requireUser, type User } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { getStorage } from "@/lib/get-storage";
import { StorageNotFoundError } from "@/lib/storage";
import { readAll } from "@/lib/stream";
import { ownsTmpUpload } from "@/lib/upload-handoff";
import { MAX_VIDEO_BYTES, normaliseVideoType } from "@/lib/video-bytes";

import { MAX_BYTES } from "../../../onboarding/photos";
import { fail, RIGHTS_REQUIRED, rightsConfirmed, storeUpload, uploadFailure } from "../store";

/* Step two of a direct upload: the bytes are in storage under a temporary key,
 * and the browser asks for them to become a library item.
 *
 * The key is the one untrusted thing here. It must be a temporary upload under
 * this user's own prefix (`ownsTmpUpload`, pure and tested); anything else is
 * refused before storage is touched, so a key naming another user's object or
 * one of this user's own finished media can be neither read nor deleted.
 *
 * From the bytes on, this is the in-request path exactly — `storeUpload` is
 * the same function — and the temporary object is deleted whichever way that
 * goes, so a refused clip does not sit in the bucket.
 */

export const dynamic = "force-dynamic";

/* Re-muxing a 60MB clip through ffmpeg is the slow case here, and it happens
   inside the request because the result is what decides whether the row is
   written at all. A minute is the ceiling the re-mux itself is bounded to. */
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();
  try {
    return await finish(request, user);
  } catch (error) {
    return uploadFailure(error);
  }
}

type Body = { pathname?: unknown; folderId?: unknown; kind?: unknown; name?: unknown; rights?: unknown };

async function finish(request: Request, user: User): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Body | null;
  const pathname = body?.pathname;
  if (!ownsTmpUpload(user.id, pathname)) return fail(400, "That upload is not yours or has already been used.");
  if (!rightsConfirmed(body?.rights)) return fail(400, RIGHTS_REQUIRED);
  const rightsConfirmedAt = new Date().toISOString();

  const avatar = await currentAvatar(user.id);
  if (!avatar) return fail(409, "Finish setting up your avatar first, then you can add your own photos and clips.");

  const storage = getStorage();
  try {
    const object = await storage.get(pathname).catch((error: unknown) => {
      if (error instanceof StorageNotFoundError || (error as { code?: string }).code === "ENOENT") return null;
      throw error;
    });
    if (!object) return fail(410, "That upload did not arrive or has expired. Try again.");

    /* The signature pinned the type and length, so these are what the browser
       claimed and what start/ accepted. They are checked again rather than
       believed: a stray object is cheaper to refuse than to decode. */
    const claimedType = object.contentType;
    const wantsVideo = normaliseVideoType(claimedType).startsWith("video/");
    if (body?.kind !== undefined && body.kind !== (wantsVideo ? "clip" : "image")) {
      return fail(400, "That upload is not the kind of file it was said to be.");
    }
    const ceiling = wantsVideo ? MAX_VIDEO_BYTES : MAX_BYTES;
    if (object.bytes > ceiling) {
      await object.stream.cancel().catch(() => undefined);
      return fail(413, "That file is bigger than it said it was.");
    }

    // Buffered whole, as the multipart path buffers its body: ffmpeg and the decoders take a Buffer.
    const raw = await readAll(object.stream);
    if (raw.byteLength > ceiling) return fail(413, "That file is bigger than it said it was.");
    if (raw.byteLength === 0) return fail(400, "That file is empty.");

    // Uploads land in the folder that was open, like everything else made from that screen.
    const folderId = (await requireOwnFolder(user.id, body?.folderId)) ?? null;
    const originalName = typeof body?.name === "string" ? body.name.slice(0, 120) : pathname.slice(pathname.lastIndexOf("/") + 1);
    return await storeUpload({ user, avatarId: avatar.id, folderId, originalName, rightsConfirmedAt }, raw, claimedType);
  } finally {
    /* Whatever happened above, the temporary object has served its purpose.
       A failure here is not hers: the row (if any) is already written. */
    await storage.delete(pathname).catch(() => undefined);
  }
}

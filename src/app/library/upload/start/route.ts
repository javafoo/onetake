import { randomUUID } from "node:crypto";

import { countUploads, UPLOAD_CAP } from "@/data/media";
import { requireUser, type User } from "@/data/users";
import { currentAvatar } from "@/lib/current-avatar";
import { getStorage } from "@/lib/get-storage";
import { requireWithinLimit } from "@/lib/rate-limit";
import { checkUploadClaim, tmpUploadPathname, UPLOAD_URL_SECONDS } from "@/lib/upload-handoff";

import { fail, libraryFullMessage, RIGHTS_REQUIRED, rightsConfirmed, UPLOAD_LIMIT, uploadFailure } from "../store";

/* Step one of a direct upload: the browser says what it holds, and gets back a
 * URL it may PUT that one file to.
 *
 * Nothing is written here — no row, no object. The URL points at a temporary
 * key under this user's own prefix, signed for exactly the type and size that
 * were claimed and good for ten minutes. Everything that decides whether the
 * file is kept happens in `finish/`, once the bytes exist and can be read.
 *
 * The checks that can be made from the claim alone are made now, because they
 * are the ones that save a person a 30MB upload: the caps, the library being
 * full, and the account not yet having an avatar to file the clip under.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const user = await requireUser();
  try {
    return await start(request, user);
  } catch (error) {
    return uploadFailure(error);
  }
}

type Body = { type?: unknown; bytes?: unknown; rights?: unknown };

async function start(request: Request, user: User): Promise<Response> {
  const storage = getStorage();
  /* The filesystem driver cannot sign a PUT, so local runs and tests keep
     posting the file in the body. The browser reads this and does that. */
  if (!storage.uploadUrl) return Response.json({ ok: true, direct: false });

  const body = (await request.json().catch(() => null)) as Body | null;
  // Refused before a byte is sent; finish/ checks it again where the row is written.
  if (!rightsConfirmed(body?.rights)) return fail(400, RIGHTS_REQUIRED);
  const claim = { type: typeof body?.type === "string" ? body.type : "", bytes: typeof body?.bytes === "number" ? body.bytes : 0 };
  const verdict = checkUploadClaim(claim);
  if (!verdict.ok) return fail(verdict.status, verdict.message);

  /* The allowance is taken here, at the point the in-request path takes it
     (before the bytes), because this is what lets bytes be sent at all. The
     finishing step does not take it again. */
  await requireWithinLimit(user, UPLOAD_LIMIT);

  const avatar = await currentAvatar(user.id);
  if (!avatar) return fail(409, "Finish setting up your avatar first, then you can add your own photos and clips.");

  /* A count, not a claim: the row is inserted under the atomic cap in
     `finish/`. This only spares her the upload when the answer is already no. */
  if ((await countUploads(user.id)) >= UPLOAD_CAP) return fail(409, libraryFullMessage());

  const pathname = tmpUploadPathname(user.id, randomUUID(), verdict.contentType);
  const target = await storage.uploadUrl(pathname, verdict.contentType, claim.bytes, UPLOAD_URL_SECONDS);
  return Response.json({ ok: true, direct: true, pathname, kind: verdict.kind, ...target });
}

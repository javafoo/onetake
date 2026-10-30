import { storeUploadResult, uploadRefusal, type Destination } from "@/library/store";

/* The upload routes' side of `src/library/store.ts`: the same sniff, probe,
   re-encode and store, answered as the Response both routes have always
   sent. Everything else is re-exported so the routes keep one import. */

export { libraryFullMessage, RIGHTS_REQUIRED, rightsConfirmed, UPLOAD_LIMIT, type Destination } from "@/library/store";

export function fail(status: number, message: string): Response {
  return Response.json({ ok: false, message }, { status });
}

/** The one place an upload's refusal becomes a status and a sentence. */
export function uploadFailure(error: unknown): Response {
  const { status, message } = uploadRefusal(error);
  return fail(status, message);
}

/** Sniff, probe, re-encode, store and file one upload; the claimed type only decides which path. */
export async function storeUpload(where: Destination, raw: Buffer, claimedType: string): Promise<Response> {
  const result = await storeUploadResult(where, raw, claimedType);
  if (!result.ok) return fail(result.status, result.message);
  if (result.kind === "image") {
    return Response.json({ ok: true, id: result.id, kind: "image", url: `/api/media/${result.id}`, width: result.width, height: result.height });
  }
  return Response.json({ ok: true, id: result.id, kind: "clip", url: `/api/media/${result.id}`, durationSeconds: result.durationSeconds, width: result.width, height: result.height });
}

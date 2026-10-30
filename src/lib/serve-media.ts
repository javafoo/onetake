import { extensionFor, type Media } from "@/data/media";
import { downloadFilename, mediaDisposition } from "@/lib/download";
import { getStorage } from "@/lib/get-storage";

/* The bytes of one file, for a row the caller has already found as its
   owner's. Shared by the signed-in media route and the signed file link. */

export async function serveMedia(request: Request, row: Media, download: boolean): Promise<Response> {
  const size = row.bytes;
  const headers: Record<string, string> = {
    "Content-Type": row.contentType,
    "Accept-Ranges": "bytes",
    // Private: a shared cache must never hold one user's media.
    "Cache-Control": "private, max-age=3600",
    /* These bytes came from a browser upload or from a provider. Every accepted
       upload is re-encoded, but this route must still never let a sniffed
       content type turn one user's file into script on our own origin. The
       filename is generated from the row, so a crafted original name cannot
       steer a save either. */
    "X-Content-Type-Options": "nosniff",
    /* `?download=1` saves rather than opens: the Download buttons on tiles
       use it. The filename is still built from the row and cleaned. */
    "Content-Disposition": mediaDisposition(
      download,
      downloadFilename({ id: row.id, kind: row.kind, extension: extensionFor(row.contentType), originalName: (row.meta as { originalName?: unknown }).originalName }),
    ),
  };

  /* Safari will not play a video at all unless ranges are honoured, and it asks
     for them constantly while seeking. */
  const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const { stream } = await getStorage().get(row.pathname, { start, end });
    return new Response(cancelOnAbort(stream, request.signal), {
      status: 206,
      headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  const { stream } = await getStorage().get(row.pathname);
  return new Response(cancelOnAbort(stream, request.signal), { headers: { ...headers, "Content-Length": String(size) } });
}

/* Browsers abandon video requests constantly (preload, seeking). Cancelling the
   stream is what tears the file handle or the upstream fetch down; without it a
   source stream keeps pushing into a controller nobody reads from. The runtime
   cancels the response body on disconnect as well, so this may be a no-op and a
   rejection from an already-locked stream is expected and ignored. */
function cancelOnAbort(stream: ReadableStream<Uint8Array>, signal: AbortSignal): ReadableStream<Uint8Array> {
  signal.addEventListener("abort", () => void stream.cancel().catch(() => {}), { once: true });
  return stream;
}

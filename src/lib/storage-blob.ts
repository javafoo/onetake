import { del, get, list, put } from "@vercel/blob";

import { StorageNotFoundError, type Storage, type StoredObject } from "./storage";

/* Vercel Blob, private store. Nothing is reachable by URL: every read goes
   through /api/media/[id], which checks the owner and then streams from here.
   The store's token comes from BLOB_READ_WRITE_TOKEN, which Vercel sets when
   the store is connected to the project. */

const ACCESS = "private" as const;

export function blobStorage(): Storage {
  return {
    async put(pathname, data, contentType): Promise<StoredObject> {
      await put(pathname, data, { access: ACCESS, contentType, addRandomSuffix: false, allowOverwrite: true });
      return { pathname, contentType, bytes: data.length };
    },

    async get(pathname, range) {
      const result = await get(pathname, {
        access: ACCESS,
        useCache: false,
        ...(range ? { headers: { Range: `bytes=${range.start}-${range.end}` } } : {}),
      });
      if (!result || !result.stream) throw new StorageNotFoundError(pathname);
      const length = Number(result.headers.get("content-length"));
      const bytes = Number.isFinite(length) && length > 0 ? length : range ? range.end - range.start + 1 : result.blob.size;
      return { stream: result.stream, bytes, contentType: result.blob.contentType || "application/octet-stream" };
    },

    // Nothing in this app hands a stored file to a third party by URL; every provider gets bytes.
    async signedUrl(pathname) {
      throw new Error(`Signed URLs are not available for ${pathname}: send the bytes instead.`);
    },

    async delete(pathname) {
      await del(pathname);
    },

    async deletePrefix(prefix) {
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        if (page.blobs.length) await del(page.blobs.map((blob) => blob.url));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    },
  };
}

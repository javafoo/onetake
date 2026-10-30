/* The storage contract. Media is private: nothing is served by public URL. Pages
   reference media by id through /api/media/[id], which checks the owner and then
   streams from here. Implementations: Vercel Blob, private, when hosted
   (`storage-blob.ts`), the local filesystem for tests and local runs
   (`storage-fs.ts`); `get-storage.ts` picks. */

export class StorageNotFoundError extends Error {
  constructor(pathname: string) {
    super(`No stored object at ${pathname}`);
    this.name = "StorageNotFoundError";
  }
}

export type StoredObject = { pathname: string; contentType: string; bytes: number };

/** Where a browser may PUT one object directly, and the headers the signature pins. */
export type UploadTarget = { url: string; method: "PUT"; headers: Record<string, string> };

export interface Storage {
  put(pathname: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(pathname: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream<Uint8Array>; bytes: number; contentType: string }>;
  /** A short-lived URL a third-party API can fetch (for example an image-to-video start frame). */
  signedUrl(pathname: string, seconds: number): Promise<string>;
  delete(pathname: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /**
   * A short-lived URL a browser can PUT `bytes` of `contentType` to, so a large
   * file never passes through a request body of ours. Optional: a driver
   * without it (the filesystem) keeps every upload on the old in-request path.
   */
  uploadUrl?(pathname: string, contentType: string, bytes: number, seconds: number): Promise<UploadTarget>;
}

export const userPrefix = (userId: string) => `users/${userId}/`;
export const mediaPathname = (userId: string, kind: string, id: string, extension: string) =>
  `${userPrefix(userId)}${kind}/${id}.${extension.replace(/^\./, "")}`;

import type { Storage } from "./storage";
import { blobStorage } from "./storage-blob";
import { fsStorage } from "./storage-fs";

/** Vercel Blob when its token is present, the filesystem otherwise (tests, and a
    checkout with no credentials). `STORAGE_DRIVER` forces one. Not cached: a
    test may point it somewhere else between cases. */
export function getStorage(): Storage {
  const driver = process.env.STORAGE_DRIVER ?? (process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "fs");
  if (driver === "blob") return blobStorage();
  if (driver === "fs") {
    /* On Vercel the filesystem is the function's own /tmp: writes succeed and
       are gone with the instance, so a deployment without a Blob store must
       fail on the first write rather than lose every upload. */
    if (process.env.VERCEL) {
      throw new Error("Blob storage is not configured (BLOB_READ_WRITE_TOKEN is unset), and the filesystem is not storage on Vercel.");
    }
    return fsStorage();
  }
  throw new Error(`Unknown STORAGE_DRIVER: ${driver}`);
}

import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { Storage, StoredObject } from "./storage";
import { nodeToWeb } from "./stream";

/* The filesystem implementation of the storage contract. It exists for tests
   and for running without a Blob token; production uses src/lib/storage-blob.ts.
   The content type is kept in a sidecar file so a put/get round-trip returns
   exactly what was stored instead of a guess from the extension. */

const TYPE_SUFFIX = ".content-type";

export function fsRoot(): string {
  // Resolved at runtime from the environment: tracing it would pull the whole project into the bundle.
  return resolve(/* turbopackIgnore: true */ process.env.STORAGE_FS_ROOT ?? join(tmpdir(), "handled-storage"));
}

export function fsStorage(root: string = fsRoot()): Storage {
  const base = resolve(root);

  /** A pathname from a database row is still untrusted input: it must not escape the root. */
  function full(pathname: string): string {
    const target = resolve(base, pathname);
    if (target !== base && !target.startsWith(base + sep)) throw new Error(`Pathname outside the storage root: ${pathname}`);
    return target;
  }

  async function walk(dir: string, found: string[]): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return found;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, found);
      else found.push(path);
    }
    return found;
  }

  return {
    async put(pathname, data, contentType): Promise<StoredObject> {
      const path = full(pathname);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
      await writeFile(path + TYPE_SUFFIX, contentType);
      return { pathname, contentType, bytes: data.byteLength };
    },

    async get(pathname, range) {
      const path = full(pathname);
      const size = (await stat(path)).size;
      if (range && (range.start < 0 || range.start >= size || range.end < range.start)) {
        throw new Error(`Range ${range.start}-${range.end} is outside ${pathname} (${size} bytes)`);
      }
      const end = range ? Math.min(range.end, size - 1) : size - 1;
      const contentType = await readFile(path + TYPE_SUFFIX, "utf8").catch(() => "application/octet-stream");
      return {
        stream: nodeToWeb(createReadStream(path, range ? { start: range.start, end } : undefined)),
        bytes: range ? end - range.start + 1 : size,
        contentType,
      };
    },

    /** There is no signing here: tests and local runs read the file directly. */
    async signedUrl(pathname) {
      return pathToFileURL(full(pathname)).href;
    },

    async delete(pathname) {
      const path = full(pathname);
      await rm(path, { force: true });
      await rm(path + TYPE_SUFFIX, { force: true });
    },

    async deletePrefix(prefix) {
      full(prefix); // reject an escaping prefix before anything is removed
      for (const path of await walk(base, [])) {
        if (relative(base, path).split(sep).join("/").startsWith(prefix)) await rm(path, { force: true });
      }
    },
  };
}

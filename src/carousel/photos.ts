import { readdir } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";

/* A spec refers to photos by a stable reference ("p22" = the 23rd photo in the
   folder, sorted by name) so a spec can be re-rendered later without carrying
   absolute paths around. */

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export async function listPhotos(dir: string): Promise<string[]> {
  const names = (await readdir(dir)).filter((name) => IMAGE_EXTENSIONS.has(extname(name).toLowerCase()));
  return names.sort((a, b) => a.localeCompare(b)).map((name) => join(dir, name));
}

export function photoRef(index: number): string {
  return `p${String(index).padStart(2, "0")}`;
}

/** Photos shot in one session sit next to each other in the folder, so walking a
    pool in order gives three covers that look like the same picture. Taking the
    ends first, then halving what is left, keeps the early picks far apart. */
export function spreadRefs(refs: string[]): string[] {
  if (refs.length < 3) return [...refs];
  const stride = Math.max(2, Math.round(refs.length / 3));
  const out: string[] = [];
  const used = new Set<number>();
  let index = 0;
  while (out.length < refs.length) {
    while (used.has(index)) index = (index + 1) % refs.length;
    used.add(index);
    out.push(refs[index]);
    index = (index + stride) % refs.length;
  }
  return out;
}

export function resolvePhotoRef(ref: string, files: string[], dir?: string): string {
  const indexed = /^p(\d{1,3})$/.exec(ref);
  if (indexed) {
    const path = files[Number(indexed[1])];
    if (!path) throw new Error(`Photo ${ref} is out of range: the folder has ${files.length} photos`);
    return path;
  }
  if (isAbsolute(ref)) return ref;
  if (dir) return join(dir, ref);
  throw new Error(`Cannot resolve photo reference "${ref}"`);
}

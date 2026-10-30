import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import type { FaceBox } from "./render";

/* The still-image twin of src/reel/faces.ts: where the face sits in a photo, so
   a title is never laid over it. The reel version samples video frames through
   ffmpeg; here one image is downscaled in-process and asked about once, then
   cached, because the same photo is reused under many carousels. */

const PROBE_WIDTH = 768;

type CacheEntry = { modified: number; box: FaceBox | null };
type Cache = Record<string, CacheEntry>;

async function probe(path: string): Promise<InlineImage> {
  const image = await loadImage(path);
  const scale = Math.min(1, PROBE_WIDTH / image.width);
  const canvas = createCanvas(Math.round(image.width * scale), Math.round(image.height * scale));
  canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  return { mimeType: "image/jpeg", data: canvas.toBuffer("image/jpeg", 82) };
}

const SCHEMA = {
  type: "object",
  properties: {
    faces: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ymin: { type: "integer" },
          ymax: { type: "integer" },
          xmin: { type: "integer" },
          xmax: { type: "integer" },
        },
        required: ["ymin", "ymax", "xmin", "xmax"],
      },
    },
  },
  required: ["faces"],
};

const PROMPT =
  "Locate every human face in this photo. For each one return its box on a 0-1000 scale of the image, where 0,0 is the top left " +
  "corner: ymin at the top of the hair above the forehead, ymax at the bottom of the chin, xmin and xmax at the outer edges of " +
  "the cheeks and ears. Return an empty list if no face is visible.";

/** Null means no face was found, or the check could not run; the caller then
    falls back to a centred crop and its default text position. Exported for
    callers that cache the answer somewhere other than a file — the app stores
    it on the photo's own `media.meta`, which is where it belongs once a photo
    is a row rather than a path. */
export async function detectFaceBox(path: string): Promise<FaceBox | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const { faces } = await generateText<{ faces: { ymin: number; ymax: number; xmin: number; xmax: number }[] }>({
    images: [await probe(path)],
    schema: SCHEMA,
    prompt: PROMPT,
  });
  const valid = faces.filter(
    (face) => face.ymax > face.ymin && face.xmax > face.xmin && face.ymin >= 0 && face.ymax <= 1000 && face.xmin >= 0 && face.xmax <= 1000,
  );
  if (!valid.length) return null;
  return {
    top: Math.min(...valid.map((face) => face.ymin)) / 1000,
    bottom: Math.max(...valid.map((face) => face.ymax)) / 1000,
    left: Math.min(...valid.map((face) => face.xmin)) / 1000,
    right: Math.max(...valid.map((face) => face.xmax)) / 1000,
  };
}

async function readCache(cachePath: string): Promise<Cache> {
  try {
    return JSON.parse(await readFile(cachePath, "utf8")) as Cache;
  } catch {
    return {};
  }
}

/** Face boxes for a set of photos, cached by path and modification time. A photo
    the model cannot be asked about is reported as null rather than failing the render. */
export async function faceBoxes(paths: string[], cachePath: string): Promise<Record<string, FaceBox | null>> {
  const cache = await readCache(cachePath);
  const result: Record<string, FaceBox | null> = {};
  let changed = false;

  for (const path of paths) {
    if (result[path] !== undefined) continue;
    const modified = (await stat(path)).mtimeMs;
    const cached = cache[path];
    if (cached && cached.modified === modified) {
      result[path] = cached.box;
      continue;
    }
    try {
      const box = await detectFaceBox(path);
      result[path] = box;
      cache[path] = { modified, box };
      changed = true;
    } catch {
      result[path] = null; // a failed look-up is not cached, so it is retried next time
    }
  }

  if (changed) {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, JSON.stringify(cache, null, 2) + "\n");
  }
  return result;
}

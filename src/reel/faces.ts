import { readFile, stat, writeFile } from "node:fs/promises";

import { type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import { ffmpeg, mediaDurationSeconds, IMAGE_FFMPEG_TIMEOUT_MS, MAX_IMAGE_OUTPUT_BYTES } from "../lib/binaries";
import type { FaceZone } from "./placement";

/* Finds where the face sits across a clip, in the 9:16 crop the reel will use,
   so the hook never covers it. Three frames are sampled because she moves. The
   answer is cached beside the clip: a clip is analysed once, then reused under
   every hook. */

const SAMPLE_POINTS = [0.1, 0.5, 0.9];

async function frameAt(clipPath: string, seconds: number): Promise<InlineImage> {
  const data = await ffmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-f", "mp4",
      "-ss", seconds.toFixed(2), "-i", clipPath, "-frames:v", "1",
      "-vf", "scale=360:640:force_original_aspect_ratio=increase,crop=360:640",
      "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
    ],
    `grab a frame from ${clipPath}`,
    { timeoutMs: IMAGE_FFMPEG_TIMEOUT_MS, maxOutputBytes: MAX_IMAGE_OUTPUT_BYTES },
  );
  if (!data.length) throw new Error("frame grab produced nothing");
  return { mimeType: "image/jpeg", data };
}

/** The analysis itself, with no cache of its own: the app stores the answer in
    the clip's media row, because its local copy is a temp file that will not
    survive the request. Null means no face was found or the check could not run. */
export async function analyseFaceZone(clipPath: string): Promise<FaceZone | null> {
  if (!process.env.GEMINI_API_KEY) return null;

  let zone: FaceZone | null = null;
  try {
    const length = await mediaDurationSeconds(clipPath);
    const frames = await Promise.all(SAMPLE_POINTS.map((point) => frameAt(clipPath, length * point)));
    const { faces } = await generateText<{ faces: { ymin: number; ymax: number }[] }>({
      images: frames,
      schema: {
        type: "object",
        properties: {
          faces: {
            type: "array",
            items: { type: "object", properties: { ymin: { type: "integer" }, ymax: { type: "integer" } }, required: ["ymin", "ymax"] },
          },
        },
        required: ["faces"],
      },
      prompt:
        "These are frames from one vertical video. For each frame that shows a person's face, return the face's vertical extent " +
        "from the top of the forehead (hairline) to the bottom of the chin, as ymin and ymax on a 0-1000 scale where 0 is the top " +
        "edge of the frame and 1000 the bottom edge. One entry per visible face. Return an empty list if no face is visible.",
    });
    const valid = faces.filter((face) => face.ymax > face.ymin && face.ymin >= 0 && face.ymax <= 1000);
    if (valid.length) {
      zone = { top: Math.min(...valid.map((face) => face.ymin)) / 1000, bottom: Math.max(...valid.map((face) => face.ymax)) / 1000 };
    }
  } catch {
    return null; // a failed check is not cached, so it is retried next time
  }
  return zone;
}

/** Null means no face was found or the check could not run; the caller then uses
    the default spot. The answer is cached beside the clip for the CLI scripts,
    which work on the long-lived files under `data/`. */
export async function faceZone(clipPath: string): Promise<FaceZone | null> {
  const cachePath = `${clipPath}.faces.json`;
  const modified = (await stat(clipPath)).mtimeMs;
  try {
    const cached = JSON.parse(await readFile(cachePath, "utf8")) as { modified: number; zone: FaceZone | null };
    if (cached.modified === modified) return cached.zone;
  } catch {
    // not analysed yet
  }
  const zone = await analyseFaceZone(clipPath);
  await writeFile(cachePath, JSON.stringify({ modified, zone }, null, 2) + "\n");
  return zone;
}

import { cropFilter, type ClipAspectRatio } from "../content/clip-options";
import { ffmpeg, IMAGE_FFMPEG_TIMEOUT_MS, MAX_IMAGE_OUTPUT_BYTES } from "../lib/binaries";
import { MAX_PIXELS } from "../lib/image-bytes";

/* The still the clip is framed from.
 *
 * Omni takes an aspect ratio, but only 9:16 or 16:9, and it frames from the
 * still. So the
 * shape the creator asked for is applied to the copy we send, as a centre
 * crop — the arithmetic is in `src/content/clip-options.ts`, where it can be read and
 * tested. `crop` is expressed in the source's own dimensions, so nothing has to
 * decode the photo first, and the scale that follows it is the one `toReference`
 * uses. No ratio means the photo travels at its own shape, which is what every
 * clip made before this did.
 */
export async function framedImage(path: string, ratio: ClipAspectRatio, maxSide: number) {
  const scale = `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`;
  const data = await ffmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-nostdin",
      "-max_pixels", String(MAX_PIXELS), "-i", path,
      "-vf", `${cropFilter(ratio)},${scale}`,
      "-frames:v", "1", "-map_metadata", "-1", "-q:v", "3", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
    ],
    `crop ${path} to ${ratio}`,
    { timeoutMs: IMAGE_FFMPEG_TIMEOUT_MS, maxOutputBytes: MAX_IMAGE_OUTPUT_BYTES },
  );
  return { mimeType: "image/jpeg" as const, data };
}

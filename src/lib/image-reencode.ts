import {
  boundedImageInput,
  ffmpeg,
  IMAGE_FFMPEG_TIMEOUT_MS,
  MAX_IMAGE_OUTPUT_BYTES,
} from "./binaries";
import { MAX_PIXELS, requireDecodableImage, UploadRejectedError, type Dimensions } from "./image-bytes";

/* Nothing a stranger uploaded is ever stored as it arrived.
 *
 * The bytes are inspected first (magic, then header dimensions), then decoded
 * once under an explicit format with a pixel ceiling and a timeout, and what
 * is stored is the JPEG that comes out. Whatever was in the original — a
 * malformed chunk aimed at a decoder, an ICC profile, EXIF with a location in
 * it, a polyglot that is also valid HTML — does not survive the round trip.
 *
 * It also means every later consumer (ffmpeg for references, canvas for
 * carousels) is handling bytes this process produced, not bytes a stranger
 * chose.
 */

/** What an accepted upload becomes. The longest side of a stored photo. */
export const STORED_MAX_SIDE = 2048;
/** JPEG quality scale, 2 is best and 31 worst; 3 is visually clean at this size. */
const QUALITY = "3";

export interface ReencodedImage extends Dimensions {
  data: Buffer;
  contentType: "image/jpeg";
  /** What the original claimed to be, for the record on the media row. */
  originalType: string;
  originalWidth: number;
  originalHeight: number;
}

/**
 * Inspect, decode once, and hand back a JPEG no larger than `maxSide`.
 *
 * Throws `UploadRejectedError` for anything refused, which the routes turn
 * straight into a status and a sentence.
 */
export async function reencodeToJpeg(
  data: Buffer,
  options: { claimedType?: string; maxSide?: number } = {},
): Promise<ReencodedImage> {
  const maxSide = options.maxSide ?? STORED_MAX_SIDE;
  const source = requireDecodableImage(data, options.claimedType);

  /* Downscale only: a small photo is not blown up to 2048. `-2` keeps the
     other side proportional and even, which the JPEG encoder needs. */
  const scale =
    `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'` +
    ":flags=bilinear";

  let out: Buffer;
  try {
    out = await ffmpeg(
      [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        ...boundedImageInput(source.type, MAX_PIXELS),
        "-vf", scale,
        "-frames:v", "1",
        // No metadata travels from the original into what we store.
        "-map_metadata", "-1",
        "-q:v", QUALITY,
        "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1",
      ],
      "read that photo",
      { input: data, timeoutMs: IMAGE_FFMPEG_TIMEOUT_MS, maxOutputBytes: MAX_IMAGE_OUTPUT_BYTES },
    );
  } catch (error) {
    /* A decoder that refused, stalled or produced too much is the file's
       problem, not the account's: say so plainly and keep the detail for the
       log rather than putting ffmpeg's wording on screen. */
    console.error("upload: could not re-encode a photo —", error instanceof Error ? error.message : error);
    throw new UploadRejectedError(400, "We could not read that photo. Try saving it again, or use a different one.");
  }

  if (!out.length) {
    throw new UploadRejectedError(400, "We could not read that photo. Try saving it again, or use a different one.");
  }

  /* Read the size back off what we produced rather than predicting it: the
     row's width and height must describe the bytes actually stored. */
  const stored = requireDecodableImage(out, "image/jpeg");
  return {
    data: out,
    contentType: "image/jpeg",
    width: stored.width,
    height: stored.height,
    originalType: source.type,
    originalWidth: source.width,
    originalHeight: source.height,
  };
}

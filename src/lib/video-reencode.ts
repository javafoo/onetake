import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ffmpeg, runFfmpeg } from "./binaries";
import { UploadRejectedError } from "./image-bytes";
import {
  checkVideoShape,
  requireDecodableVideo,
  type AcceptedVideoType,
  type VideoShape,
} from "./video-bytes";

/* Nothing a stranger uploaded is ever stored as it arrived — the same rule as
 * photos, applied to the harder case.
 *
 * The bytes are sniffed for a container we accept, probed for their real length
 * and size, refused if either is out of bounds, and only then re-muxed. What is
 * stored is the MP4 that comes out. Whatever was in the original — a malformed
 * atom aimed at a demuxer, the GPS coordinates of her house in the QuickTime
 * metadata, a second track nobody asked for — does not survive the trip.
 *
 * Re-muxed, not re-encoded: the video and audio streams are copied, so this
 * costs a second rather than a minute and loses no quality. `-map_metadata -1`
 * is the point of doing it at all, with `+faststart` as a free win since the
 * file is being rewritten anyway.
 *
 * ffmpeg works on paths here rather than pipes. A container's index can live at
 * the end of the file, so a demuxer needs to seek, and a pipe cannot. The file
 * goes to a private temp directory that is removed in a `finally`.
 */

/** Probing reads a header. It gets far less time than a render. */
export const PROBE_TIMEOUT_MS = 20_000;
/** Re-muxing copies streams, so it is bounded by disk rather than by codecs. */
export const REMUX_TIMEOUT_MS = 60_000;

export interface RemuxedVideo extends VideoShape {
  data: Buffer;
  contentType: "video/mp4";
  /** What the original was, for the record on the media row. */
  originalType: AcceptedVideoType;
  originalBytes: number;
}

const DURATION = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;
/* The video stream line, e.g.
     Stream #0:0(und): Video: h264 (avc1 / 0x31637661), yuv420p, 1080x1920, ...
   The dimensions are the first WxH on a line that declares a video stream, and
   anything after them (SAR, DAR, bitrate) is ignored. */
const VIDEO_STREAM = /Stream #\d+:\d+.*: Video:.*?(\d{2,5})x(\d{2,5})/;

/**
 * Read the length and picture size out of a container's header.
 *
 * `ffmpeg -i file` with no output always exits non-zero after printing the
 * header, so the exit code is meaningless and ignored — the same reason
 * `mediaDurationSeconds` reads stderr. Returns null when the header cannot be
 * read at all, which the caller turns into a refusal.
 */
export async function probeVideo(path: string): Promise<VideoShape | null> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", path], { timeoutMs: PROBE_TIMEOUT_MS });

  const duration = DURATION.exec(stderr);
  const stream = VIDEO_STREAM.exec(stderr);
  if (!duration || !stream) return null;

  return {
    durationSeconds: Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]),
    width: Number(stream[1]),
    height: Number(stream[2]),
  };
}

const UNREADABLE = "We could not read that video. Export it as an MP4 and try again.";

/**
 * Inspect, probe, re-mux, and hand back an MP4 with no metadata on it.
 *
 * Throws `UploadRejectedError` for everything refused, which the route turns
 * straight into a status and a sentence a person can act on.
 */
export async function remuxToMp4(data: Buffer, options: { claimedType?: string } = {}): Promise<RemuxedVideo> {
  const originalType = requireDecodableVideo(data, options.claimedType);

  const dir = await mkdtemp(join(tmpdir(), "upload-video-"));
  try {
    // The temp directory is made at runtime; tracing it would pull the project into the bundle.
    const input = join(/* turbopackIgnore: true */ dir, originalType === "video/mp4" ? "in.mp4" : "in.mov");
    const output = join(/* turbopackIgnore: true */ dir, "out.mp4");
    await writeFile(input, data);

    const shape = await probeVideo(input).catch((error) => {
      console.error("upload: could not probe a clip —", error instanceof Error ? error.message : error);
      return null;
    });
    if (!shape) throw new UploadRejectedError(400, UNREADABLE);

    /* Length and size are checked before the re-mux, not after: a
       forty-minute file should be refused on its header rather than after we
       have spent a minute rewriting it. */
    const verdict = checkVideoShape(shape);
    if (!verdict.ok) throw new UploadRejectedError(verdict.status, verdict.message);

    try {
      await ffmpeg(
        [
          "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
          "-i", input,
          /* Only the first video and, if there is one, the first audio track.
             A file with fifteen streams in it is not something to pass on. */
          "-map", "0:v:0", "-map", "0:a:0?",
          // Copy, do not re-encode: this is a container rewrite, not a transcode.
          "-c", "copy",
          // The whole reason this runs: nothing travels from the original.
          "-map_metadata", "-1",
          "-map_chapters", "-1",
          "-movflags", "+faststart",
          "-f", "mp4",
          output,
        ],
        "read that video",
        { timeoutMs: REMUX_TIMEOUT_MS },
      );
    } catch (error) {
      /* A demuxer that refused, stalled, or found no stream it could copy is
         the file's problem, not the account's: say so plainly and keep
         ffmpeg's wording for the log. */
      console.error("upload: could not re-mux a clip —", error instanceof Error ? error.message : error);
      throw new UploadRejectedError(400, UNREADABLE);
    }

    const out = await readFile(output).catch(() => null);
    if (!out?.length) throw new UploadRejectedError(400, UNREADABLE);

    /* Probe what we produced rather than trusting the input's numbers: the row
       has to describe the bytes actually stored. */
    const stored = await probeVideo(output);
    if (!stored) throw new UploadRejectedError(400, UNREADABLE);
    const storedVerdict = checkVideoShape(stored);
    if (!storedVerdict.ok) throw new UploadRejectedError(storedVerdict.status, storedVerdict.message);

    return {
      data: out,
      contentType: "video/mp4",
      durationSeconds: stored.durationSeconds,
      width: stored.width,
      height: stored.height,
      originalType,
      originalBytes: data.byteLength,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

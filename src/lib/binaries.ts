import { spawn } from "node:child_process";

import ffmpegStatic from "ffmpeg-static";

/* One place decides which ffmpeg runs, because four modules shell out to it
   (reference downscaling, face sampling, reel rendering, duration probing) and
   they must all agree.

   Locally that is the system binary on PATH, which is newer and faster to
   start. On Vercel there is no system ffmpeg, so the build shipped by
   `ffmpeg-static` inside the function bundle is used instead; it is pulled into
   the serverless output by `outputFileTracingIncludes` in next.config.ts.

   `FFMPEG_BINARY` overrides the choice: "static", "system", or an absolute
   path. That is how the bundled binary is exercised on a developer machine
   without pretending to be Vercel. */

export const IS_SERVERLESS = Boolean(process.env.VERCEL);

export class FfmpegMissingError extends Error {
  constructor(reason: string) {
    super(`No usable ffmpeg: ${reason}`);
    this.name = "FfmpegMissingError";
  }
}

function staticPath(): string {
  // The package exports the absolute path of the binary it downloaded at install time.
  if (!ffmpegStatic) throw new FfmpegMissingError("ffmpeg-static has no binary for this platform");
  return ffmpegStatic;
}

/** The ffmpeg this process should run. Never a shell string: it is passed to spawn as argv[0]. */
export function ffmpegPath(): string {
  const forced = process.env.FFMPEG_BINARY?.trim();
  if (forced === "static") return staticPath();
  if (forced === "system") return "ffmpeg";
  if (forced) return forced;
  return IS_SERVERLESS ? staticPath() : "ffmpeg";
}

export interface FfmpegRun {
  stdout: Buffer;
  stderr: string;
  code: number;
  /** True when the run was killed for taking too long or for producing too much. */
  timedOut: boolean;
}

export interface FfmpegOptions {
  /** An explicit override, as the demo script uses. */
  binary?: string;
  /** Bytes to write to the child's stdin, for `-i pipe:0`. */
  input?: Buffer;
  /** Killed after this. Every spawn gets one; see the defaults below. */
  timeoutMs?: number;
  /** Stop reading, and kill, once stdout passes this. */
  maxOutputBytes?: number;
}

/* No ffmpeg invocation may run forever.
 *
 * Decoding is where a stranger's bytes meet a C library with a long history,
 * and a crafted file that makes a decoder spin is a denial of service against
 * the whole function rather than against the person who sent it. Rendering a
 * reel is the longest legitimate run; a still image is given far less. Both
 * sit well inside the ten minutes after which a job with nothing to poll is
 * written off. */
export const DEFAULT_FFMPEG_TIMEOUT_MS = 120_000;
export const IMAGE_FFMPEG_TIMEOUT_MS = 20_000;
/** Caps what a decode may hand back, so a bomb cannot be answered with one. */
export const MAX_IMAGE_OUTPUT_BYTES = 64 * 1024 * 1024;

export class FfmpegTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`ffmpeg took longer than ${Math.round(ms / 1000)}s to ${what} and was stopped`);
    this.name = "FfmpegTimeoutError";
  }
}

/**
 * Run ffmpeg once. Resolves with the exit code rather than throwing on a
 * non-zero one, because `ffmpeg -i file` (the duration probe) always exits 1.
 *
 * A string second argument is still accepted as the binary, which is how the
 * demo script calls it.
 */
export function runFfmpeg(args: string[], options: FfmpegOptions | string = {}): Promise<FfmpegRun> {
  const settings: FfmpegOptions = typeof options === "string" ? { binary: options } : options;
  const binary = settings.binary ?? ffmpegPath();
  const timeoutMs = settings.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    /* turbopackIgnore: the binary is a variable, which made the build trace
       the whole project into every function to be safe. The ffmpeg it runs is
       bundled by name (`outputFileTracingIncludes` in next.config.ts), so the
       trace is not needed. */
    const child = spawn(/*turbopackIgnore: true*/ binary, args, { stdio: [settings.input ? "pipe" : "ignore", "pipe", "pipe"] });
    /* `spawn` types these as nullable because a different stdio choice would
       make them so; this one always gives us both pipes. */
    const stdoutPipe = child.stdout!;
    const stderrPipe = child.stderr!;
    const chunks: Buffer[] = [];
    let written = 0;
    let stderr = "";
    let stopped = false;
    let settled = false;

    /* SIGKILL after SIGTERM: a decoder stuck in a tight loop does not always
       get round to handling a polite signal, and the point of a timeout is
       that the process is gone. */
    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2000).unref?.();
    }, timeoutMs);
    timer.unref?.();

    stdoutPipe.on("data", (chunk: Buffer) => {
      written += chunk.byteLength;
      if (settings.maxOutputBytes !== undefined && written > settings.maxOutputBytes) {
        stopped = true; // same treatment: stop the process and refuse the result
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    // Bounded too: a loud decoder must not be able to fill memory with warnings.
    stderrPipe.on("data", (chunk: Buffer) => {
      if (stderr.length < 8192) stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new FfmpegMissingError(
          `could not start ${binary} (${error instanceof Error ? error.message : String(error)})`,
        ),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(chunks), stderr: stderr.trim(), code: code ?? -1, timedOut: stopped });
    });

    if (settings.input) {
      // EPIPE is normal here: ffmpeg stops reading once it has the frame it wants.
      child.stdin!.on("error", () => {});
      child.stdin!.end(settings.input);
    }
  });
}

/** Run ffmpeg and throw a readable error unless it exited cleanly. */
export async function ffmpeg(args: string[], what: string, options: FfmpegOptions | string = {}): Promise<Buffer> {
  const settings: FfmpegOptions = typeof options === "string" ? { binary: options } : options;
  const result = await runFfmpeg(args, settings);
  if (result.timedOut) throw new FfmpegTimeoutError(what, settings.timeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS);
  if (result.code !== 0) throw new Error(`ffmpeg could not ${what}: ${result.stderr || `exit ${result.code}`}`);
  return result.stdout;
}

/* The decoder ffmpeg is allowed to use for each format we accept, and the
   ceiling it may decode to. Naming the decoder means a file whose contents are
   not what they claim cannot choose its own code path: ffmpeg is told "this is
   a JPEG" and fails if it is not one. `-max_pixels` is the decoder's own
   refusal, a second line behind the header check in `image-bytes.ts`. */
const DECODERS: Record<string, string> = {
  "image/jpeg": "mjpeg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The arguments that put an image on ffmpeg's stdin under an explicit format. */
export function boundedImageInput(type: string, maxPixels: number): string[] {
  const decoder = DECODERS[type];
  if (!decoder) throw new Error(`No decoder allowed for ${type}`);
  return ["-max_pixels", String(maxPixels), "-f", "image2pipe", "-c:v", decoder, "-i", "pipe:0"];
}

const DURATION = /Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)/;

/**
 * Length of a media file in seconds, or 0 when it cannot be read.
 *
 * This used to shell out to ffprobe. There is no static ffprobe in the
 * serverless bundle and adding a second 45 MB binary to carry one number is a
 * poor trade, so the container header is read from what `ffmpeg -i` prints.
 * That invocation names no output file, so ffmpeg always exits 1 after printing
 * the header — the exit code is meaningless here and is ignored.
 */
/** Whether the file carries a sound track. A talking clip does; b-roll does not. */
export async function mediaHasAudio(path: string): Promise<boolean> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", path]);
  return /Stream #\d+:\d+.*: Audio:/.test(stderr);
}

export async function mediaDurationSeconds(path: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", path]);
  const match = DURATION.exec(stderr);
  if (!match) return 0;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

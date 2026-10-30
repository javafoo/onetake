/* The clip pipeline against real ffmpeg.
 *
 * `video-bytes.test.ts` proves the refusals with crafted headers and no
 * subprocess. This one makes actual video — ffmpeg's own test pattern — and
 * runs it through the thing the route runs, because the claims worth checking
 * here are the ones only a decoder can settle: that a real MOV is accepted,
 * that an over-long clip is refused on its probed duration rather than its
 * header, that a file which does not decode is refused, and that the metadata
 * we say we strip is actually gone.
 *
 * It skips itself when there is no usable ffmpeg.
 */

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ffmpeg, ffmpegPath, runFfmpeg } from "./binaries";
import { UploadRejectedError } from "./image-bytes";
import { probeVideo, remuxToMp4 } from "./video-reencode";

let checked: Promise<string | null> | undefined;

function unavailable(): Promise<string | null> {
  checked ??= (async () => {
    try {
      const { code } = await runFfmpeg(["-hide_banner", "-version"], { timeoutMs: 10_000 });
      return code === 0 ? null : `ffmpeg at ${ffmpegPath()} exited ${code}`;
    } catch (error) {
      return `no usable ffmpeg: ${error instanceof Error ? error.message : String(error)}`;
    }
  })();
  return checked;
}

async function inTemp<T>(body: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "video-test-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * A real clip, with a title and a location in its metadata so the stripping can
 * be checked rather than assumed. `container` picks mp4 or mov.
 */
async function makeClip(
  dir: string,
  options: { seconds: number; size?: string; container?: "mp4" | "mov" } = { seconds: 2 },
): Promise<Buffer> {
  const container = options.container ?? "mp4";
  const path = join(dir, `made.${container}`);
  await ffmpeg(
    [
      "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
      "-f", "lavfi", "-i", `testsrc=size=${options.size ?? "320x240"}:rate=15:duration=${options.seconds}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
      "-metadata", "title=her holiday",
      "-metadata", "location=+51.5074-000.1278/",
      "-metadata", "comment=shot on a phone at home",
      "-f", container,
      path,
    ],
    "make a test clip",
    { timeoutMs: 120_000 },
  );
  return readFile(path);
}

test("a real MP4 is probed for its true length and picture size", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    await makeClip(dir, { seconds: 3, size: "320x568" });
    const shape = await probeVideo(join(dir, "made.mp4"));
    assert.ok(shape, "the header should be readable");
    assert.equal(shape.width, 320);
    assert.equal(shape.height, 568);
    assert.ok(Math.abs(shape.durationSeconds - 3) < 0.35, `expected about 3s, got ${shape.durationSeconds}`);
  });
});

test("a real MP4 re-muxes to an MP4 with its metadata gone", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    const source = await makeClip(dir, { seconds: 2 });

    /* The metadata really is in the file we made: without this the stripping
       claim below would pass on a file that never had any. */
    const before = await runFfmpeg(["-hide_banner", "-i", join(dir, "made.mp4")]);
    assert.match(before.stderr, /her holiday/, "the source should carry a title");
    assert.match(before.stderr, /51\.5074/, "the source should carry a location");

    const clip = await remuxToMp4(source, { claimedType: "video/mp4" });
    assert.equal(clip.contentType, "video/mp4");
    assert.equal(clip.originalType, "video/mp4");
    assert.equal(clip.originalBytes, source.byteLength);
    assert.ok(clip.data.byteLength > 0);
    assert.ok(Math.abs(clip.durationSeconds - 2) < 0.35);
    assert.equal(clip.width, 320);
    assert.equal(clip.height, 240);

    // And what came out carries none of it.
    const out = join(dir, "out.mp4");
    await writeFile(out, clip.data);
    const after = await runFfmpeg(["-hide_banner", "-i", out]);
    assert.doesNotMatch(after.stderr, /her holiday/, "the title survived the re-mux");
    assert.doesNotMatch(after.stderr, /51\.5074/, "the location survived the re-mux");
    assert.doesNotMatch(after.stderr, /shot on a phone/, "the comment survived the re-mux");
  });
});

test("a real MOV is accepted and comes out as an MP4", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    const source = await makeClip(dir, { seconds: 2, container: "mov" });
    const clip = await remuxToMp4(source, { claimedType: "video/quicktime" });
    assert.equal(clip.originalType, "video/quicktime");
    assert.equal(clip.contentType, "video/mp4", "the library only stores MP4");
  });
});

test("a phone that calls its MOV video/mov is believed about the container", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    const source = await makeClip(dir, { seconds: 1, container: "mov" });
    // Not a real media type, but Safari and some Android pickers send it.
    const clip = await remuxToMp4(source, { claimedType: "video/mov" });
    assert.equal(clip.originalType, "video/quicktime");
  });
});

test("an over-long clip is refused on its probed duration, not on its header", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    /* 34 seconds of a tiny test pattern: a few hundred kilobytes, so it passes
       every size check and can only be caught by the probe. */
    const source = await makeClip(dir, { seconds: 34, size: "160x120" });
    await assert.rejects(
      () => remuxToMp4(source, { claimedType: "video/mp4" }),
      (error: unknown) => {
        assert.ok(error instanceof UploadRejectedError);
        assert.equal(error.status, 413);
        assert.match(error.message, /34 seconds/);
        assert.match(error.message, /30 seconds is the longest/);
        return true;
      },
    );
  });
});

test("a file that does not decode is refused, whatever its header says", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  /* A valid ftyp box in front of random bytes. It gets past the sniffer, which
     is the point: the sniffer reads twelve bytes and only a demuxer can say
     whether there is video behind them. */
  const head = Buffer.alloc(16);
  head.writeUInt32BE(16, 0);
  head.write("ftyp", 4, "ascii");
  head.write("isom", 8, "ascii");
  const junk = Buffer.alloc(32 * 1024);
  for (let i = 0; i < junk.length; i++) junk[i] = (i * 37) % 251;

  await assert.rejects(
    () => remuxToMp4(Buffer.concat([head, junk]), { claimedType: "video/mp4" }),
    (error: unknown) => {
      assert.ok(error instanceof UploadRejectedError);
      assert.equal(error.status, 400);
      assert.match(error.message, /could not read that video/);
      return true;
    },
  );
});

test("an audio-only MP4 is refused: the library holds clips, not sound", async (t) => {
  const why = await unavailable();
  if (why) return t.skip(why);

  await inTemp(async (dir) => {
    const path = join(dir, "sound.mp4");
    await ffmpeg(
      [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
        "-c:a", "aac", "-f", "mp4", path,
      ],
      "make a test sound file",
      { timeoutMs: 60_000 },
    );

    const sound = await readFile(path);
    await assert.rejects(
      () => remuxToMp4(sound, { claimedType: "video/mp4" }),
      (error: unknown) => {
        assert.ok(error instanceof UploadRejectedError);
        // No video stream, so the probe finds no picture to report.
        assert.match(error.message, /could not read that video/);
        return true;
      },
    );
  });
});

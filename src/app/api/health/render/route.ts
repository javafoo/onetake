import { mkdtemp, readFile, rm } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ffmpeg, ffmpegPath, runFfmpeg } from "@/lib/binaries";
import { assembleReel } from "@/reel/assemble";
import { layoutHook, renderOverlay } from "@/reel/overlay";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* Proves the rendering stack works where it is deployed: the ffmpeg binary
   runs, the canvas addon and the bundled font load, and a real reel assembles.
   It spends nothing and touches no user data. Locked behind HEALTH_TOKEN: with
   no token set the route does not exist. */

function allowed(request: Request): boolean {
  const expected = process.env.HEALTH_TOKEN;
  const given = request.headers.get("x-health-token");
  if (!expected || expected.length < 24 || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request): Promise<Response> {
  if (!allowed(request)) return new Response("Not found", { status: 404 });

  const checks: Record<string, { ok: boolean; detail: string }> = {};
  const check = async (name: string, run: () => Promise<string>) => {
    const started = Date.now();
    try {
      checks[name] = { ok: true, detail: `${await run()} (${Date.now() - started}ms)` };
    } catch (error) {
      checks[name] = { ok: false, detail: error instanceof Error ? error.message.slice(0, 300) : String(error) };
    }
  };

  const dir = await mkdtemp(join(tmpdir(), "health-"));
  try {
    await check("ffmpeg_runs", async () => {
      const { stdout, stderr } = await runFfmpeg(["-hide_banner", "-version"]);
      return `${ffmpegPath().includes("ffmpeg-static") ? "static" : "system"}: ${(stdout.toString() || stderr).split("\n")[0]}`;
    });
    await check("canvas_and_font", async () => {
      const layout = layoutHook("The quick brown fox checks that the bundled font really loads here");
      const png = renderOverlay(layout, 600);
      return `${layout.lines.length} lines at ${layout.fontSize}px, ${png.length} byte png`;
    });
    await check("reel_assembles", async () => {
      const clip = join(dir, "clip.mp4");
      await ffmpeg(["-y", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24:duration=1", "-pix_fmt", "yuv420p", clip], "make a test clip");
      const out = join(dir, "reel.mp4");
      // faceZone is given so the check never calls a model: it must stay free and offline.
      const result = await assembleReel({ clipPath: clip, hook: "Rendering works on this server", outPath: out, faceZone: null });
      return `${result.duration}s reel, ${(await readFile(out)).length} bytes, text ${result.placement.reason}`;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  const ok = Object.values(checks).every((item) => item.ok);
  return Response.json({ ok, runtime: process.env.VERCEL ? "vercel" : "local", region: process.env.VERCEL_REGION ?? null, checks }, { status: ok ? 200 : 500 });
}

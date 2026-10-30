import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ffmpeg, ffmpegPath, mediaDurationSeconds, mediaHasAudio } from "../lib/binaries";
import { faceZone } from "./faces";
import { localeFor } from "../content/languages";
import { normalizeTextSize, normalizeTextStyle, onScreenCase, type TextSize } from "../content/text-styles";
import { FRAME, SMALL_REEL_SCALE, layoutCue, layoutHook, renderOverlay, styleVeils, type HookLayout, type KeywordMark, type ReelStyle } from "./overlay";
import { CUE_GAP, SAFE_BOTTOM, SAFE_TOP, clearHeight, placeBlock, placeCue, type CuePlacement, type FaceZone, type Placement } from "./placement";
import { CUE_SECONDS, timeline } from "./timing";

/** Encoding a reel is the longest run we do; anything past this is stuck. */
const REEL_FFMPEG_TIMEOUT_MS = 240_000;

/* The open styles (no boxes) lay a light black veil over the whole clip: a black
   layer at a quarter strength, three-quarters transparent, which is what the
   founder settled on by hand (2026-09-24) after 50% read too heavy. An earlier version dipped the exposure instead to
   keep the colour; it read as a slightly dull clip rather than a dark one, and
   the white serif needs the dark one. */
export const ELEGANT_DIM = "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.25:t=fill";

/* Two kinds of reel. A looping reel is the product's format: a silent clip
   replays for exactly as long as the hook takes to read. A talking reel is her
   saying a line to camera, so the clip runs once at its own length with its
   own sound, and the hook sits over it as a headline. */
export type ReelMode = "loop" | "talking";

export type AssembleOptions = {
  clipPath: string;
  hook: string;
  /** A short second line that pops in once the hook has been read, such as "Read the caption". */
  cue?: string | null;
  mode?: ReelMode;
  /** One of the five text looks; a legacy "box" or "elegant" is accepted and mapped. Absent means the boxed look. */
  style?: string;
  /** "small" sets the words smaller in a narrow column, broken at the pauses. Absent means large. */
  size?: string;
  /** Every on-screen word lowercased: the hook and the cue. Absent keeps her case. */
  lowercase?: boolean;
  /** The language the words are in, for lowercasing by its rules. Absent is English. */
  language?: string;
  /** Her comment keywords and the colour she picked for them. Absent: one colour for every word. */
  keyword?: KeywordMark;
  outPath: string;
  /** Slightly flatter contrast and saturation takes the AI gloss off a clip. */
  degloss?: boolean;
  /** Overrides the binary `src/lib/binaries.ts` would pick. Only the CLI uses it. */
  ffmpegPath?: string;
  /** Where the face sits, when the caller already knows: a clip is analysed once
      and the answer reused under every later hook. Omit it to analyse now. */
  faceZone?: FaceZone | null;
};

export type CueResult = { text: string; at: number; layout: HookLayout; placement: CuePlacement };
export type AssembleResult = {
  outPath: string;
  duration: number;
  mode: ReelMode;
  style: ReelStyle;
  size: TextSize;
  lowercase: boolean;
  layout: HookLayout;
  placement: Placement;
  cue: CueResult | null;
};

/** The smallest a hook is set to keep it off her face; below this it may cover the chin instead. */
const MIN_FACE_CLEAR_SIZE = 32;

export async function assembleReel(options: AssembleOptions): Promise<AssembleResult> {
  const mode: ReelMode = options.mode ?? "loop";
  const style: ReelStyle = normalizeTextStyle(options.style);
  const size = normalizeTextSize(options.size);
  const lowercase = options.lowercase === true;
  const locale = localeFor(options.language);
  const hook = onScreenCase(options.hook, lowercase, locale);
  const cueText = options.cue ? onScreenCase(options.cue, lowercase, locale) : options.cue;
  const timing = timeline(hook, cueText);
  /* A tall hook with a second line is laid out and placed together with room
     for that line: on its own, a hook that fills the safe area leaves no gap
     above or below it, and the line would land on the hook's last words. The
     hook shrinks to fit rather than rising under Instagram's top bar. */
  const zone = options.faceZone !== undefined ? options.faceZone : await faceZone(options.clipPath);
  const safePx = (SAFE_BOTTOM - SAFE_TOP) * FRAME.height;
  const cueRoomFor = (px: number) => (cueText ? CUE_GAP * FRAME.height + layoutCue(cueText, style, px, size).blockHeight : 0);
  const fitTo = (budget: number) => {
    let fitted = layoutHook(hook, style, budget, size);
    if (fitted.blockHeight + cueRoomFor(fitted.fontSize) > budget) fitted = layoutHook(hook, style, budget - cueRoomFor(fitted.fontSize), size);
    return fitted;
  };
  // Small type is small on purpose, so the floor for staying off her face comes down with it.
  const minClear = size === "small" ? Math.round(MIN_FACE_CLEAR_SIZE * SMALL_REEL_SCALE) : MIN_FACE_CLEAR_SIZE;
  /* First try to fit the hook, and its cue, into the clear band above or below
     her face, shrinking as far as MIN_FACE_CLEAR_SIZE. Only a hook too long to
     read at that size falls back to the whole safe area, where it covers the
     chin at worst (founder, 2026-09-24: the words covered her face). */
  let layout = fitTo(clearHeight(zone) * FRAME.height);
  if (layout.fontSize < minClear || layout.blockHeight + cueRoomFor(layout.fontSize) > clearHeight(zone) * FRAME.height) {
    layout = fitTo(safePx);
  }
  const placement = placeBlock((layout.blockHeight + cueRoomFor(layout.fontSize)) / FRAME.height, zone);

  /* A talking reel is as long as what she says. The cue still waits for the
     hook to be read, but never lands in the last moment of the clip. */
  const clipSeconds = mode === "talking" ? await mediaDurationSeconds(options.clipPath) : 0;
  const duration = mode === "talking" && clipSeconds > 0 ? Math.round(clipSeconds * 100) / 100 : timing.duration;
  const cueAt = timing.cueAt === null ? null : Math.round(Math.min(timing.cueAt, Math.max(0, duration - CUE_SECONDS)) * 100) / 100;
  const withSound = mode === "talking" && (await mediaHasAudio(options.clipPath));

  let cue: CueResult | null = null;
  if (cueText && cueAt !== null && cueAt < duration) {
    const cueLayout = layoutCue(cueText, style, layout.fontSize, size);
    const hookBlock = { top: placement.top, height: layout.blockHeight / FRAME.height };
    cue = { text: cueText, at: cueAt, layout: cueLayout, placement: placeCue(hookBlock, cueLayout.blockHeight / FRAME.height, zone) };
  }

  const dir = await mkdtemp(join(tmpdir(), "reel-"));
  try {
    const hookPath = join(dir, "hook.png");
    await writeFile(hookPath, renderOverlay(layout, Math.round(placement.top * FRAME.height), options.keyword));
    const cuePath = join(dir, "cue.png");
    if (cue) await writeFile(cuePath, renderOverlay(cue.layout, Math.round(cue.placement.top * FRAME.height), options.keyword));

    const base = [
      `scale=${FRAME.width}:${FRAME.height}:force_original_aspect_ratio=increase`,
      `crop=${FRAME.width}:${FRAME.height}`,
      // An open style has no box to carry the type, so the clip is darkened under it.
      ...(styleVeils(style) ? [ELEGANT_DIM] : options.degloss === false ? [] : ["eq=contrast=0.93:saturation=0.95"]),
    ].join(",");

    /* Inputs: 0 the clip, 1 the hook, 2 the cue (when there is one), and last a
       silent track for a reel whose clip has none: Instagram rejects reels
       with no audio at all. A looping clip is looped by input, so a clip
       shorter than the reading time simply plays again. */
    const inputs = [
      ...(mode === "loop" ? ["-stream_loop", "-1"] : []), "-i", options.clipPath,
      "-loop", "1", "-i", hookPath,
      ...(cue ? ["-loop", "1", "-i", cuePath] : []),
      ...(withSound ? [] : ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]),
    ];
    const audioMap = withSound ? "0:a:0" : `${cue ? 3 : 2}:a:0`;
    const filters = [
      `[0:v]${base}[clip]`,
      `[clip][1:v]overlay=0:0:format=auto${cue ? "[hooked]" : "[out]"}`,
      ...(cue ? [`[hooked][2:v]overlay=0:0:format=auto:enable='gte(t,${cue.at})'[out]`] : []),
    ];

    await ffmpeg([
      "-y", "-hide_banner", "-loglevel", "error",
      ...inputs,
      "-t", String(duration),
      "-filter_complex", filters.join(";"),
      "-map", "[out]", "-map", audioMap,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      options.outPath,
    ], "assemble the reel", { binary: options.ffmpegPath ?? ffmpegPath(), timeoutMs: REEL_FFMPEG_TIMEOUT_MS });
    return { outPath: options.outPath, duration, mode, style, size, lowercase, layout, placement, cue };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

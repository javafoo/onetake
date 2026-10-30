/* Reel length follows the hook's reading time, so the clip replays while the
   viewer is still reading the caption. Pure functions, no I/O. */

export const WORDS_PER_SECOND = 3.3; // ~200 wpm silent reading
export const HOLD_SECONDS = 0.8; // beat after the last word lands
/* The reels we make run five to eight seconds, most of them about six. A hook
   that reads inside that gets a reel of exactly its reading time; a longer
   one, laid out in groups, does not stretch the reel: it gets the usual six
   seconds and Instagram loops it while she reads, which is why the first line
   has to stop the scroll on its own (the founder's rule, 2026-09-23). The
   clip is made as long as the reel, so nothing loops inside the file. */
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 8;
export const TARGET_SECONDS = 6;
/** The longest a hook may take to read in one sitting: the word limit follows from it, the reel never does. */
export const LONGEST_SECONDS = 15;
/** How long a second line (the cue) stays on screen after the hook has been read. */
export const CUE_SECONDS = 1.6;
/** The least a cue may be on screen when the reel is at its cap. */
export const CUE_MIN_VISIBLE_SECONDS = 1.2;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const round2 = (seconds: number) => Math.round(seconds * 100) / 100;

export function readingSeconds(text: string): number {
  if (countWords(text) === 0) throw new Error("Hook text is empty");
  const raw = countWords(text) / WORDS_PER_SECOND + HOLD_SECONDS;
  return Math.min(LONGEST_SECONDS, Math.max(MIN_SECONDS, round2(raw)));
}

export type Timeline = {
  /** How long the hook alone needs; the reel is exactly this long when there is no cue. */
  hookSeconds: number;
  /** When the cue appears: the moment the viewer has read the hook, before the hold beat. Null without a cue. */
  cueAt: number | null;
  duration: number;
};

/** The hook stays up for the whole reel. A cue (a short second line such as
    "Read the caption") pops in once the hook has been read, or, on a reel too
    short to read the hook once, late enough to be seen on every loop, and
    stays to the end. The cue may stretch the reel a little, never past eight. */
export function timeline(hook: string, cue?: string | null): Timeline {
  const hookSeconds = readingSeconds(hook);
  const base = hookSeconds <= MAX_SECONDS ? hookSeconds : TARGET_SECONDS;
  if (!cue || countWords(cue) === 0) return { hookSeconds, cueAt: null, duration: base };
  const duration = Math.min(MAX_SECONDS, round2(base + CUE_SECONDS));
  const cueAt = round2(Math.max(0, Math.min(hookSeconds - HOLD_SECONDS, duration - CUE_MIN_VISIBLE_SECONDS)));
  return { hookSeconds, cueAt, duration };
}

/** How long a clip made for this hook should be: whole seconds, the reel's
    length rounded up, five to eight, so the reel never loops it. */
export function clipSecondsFor(hook: string, cue?: string | null): number {
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.ceil(timeline(hook, cue).duration)));
}

import type { ImageAspect } from "@/content/image-options";
import { phraseLines } from "@/content/phrases";
import type { TextSize } from "@/content/text-styles";

/* Words on one of her photos: the pure half. How her words become title lines
   and what frame they are drawn in. The drawing is `renderTextOnPhoto` in
   render.ts, the job is `src/jobs/text-photo.ts`. */

/** The most words one photo carries: past this it is a caption, not words on a picture. */
export const MAX_TEXT_PHOTO_CHARS = 600;
/** A line longer than this is wrapped; shorter lines stay exactly as she broke them. */
const LINE_CHARS = 22;
/** The kit's type is sized for a frame this wide. */
const LAYOUT_WIDTH = 1080;
/** The widest the result is drawn, so a 4K upload does not make a 20 MB PNG. */
const MAX_OUTPUT_WIDTH = 2160;

/**
 * Her words as title lines. Her own line breaks are kept; a line too long for
 * one row is split into the fewest rows of even length. Nothing is added,
 * dropped, re-cased or reordered: the lines joined with spaces are her words.
 * Blank lines are dropped, because a title has no empty rows.
 *
 * Small words with no breaks of her own are broken at the pauses instead:
 * sentence ends, then commas, colons, semicolons and dashes, one phrase to a
 * line (`phraseLines`). The column is counted in characters here, which is
 * what the job knows before anything is drawn.
 */
export function textPhotoLines(text: string, size: TextSize = "large"): string[] {
  /* Large words with no breaks of her own break at the pauses too: wrapping a
     quote wherever the width runs out ("take the risk. worst / case, you…")
     reads as a paragraph, not a quote (founder, 2026-09-24). */
  if (size === "small" || !/\n/.test(text.trim())) return phraseLines(text, (line) => line.length, LINE_CHARS);
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) continue;
    lines.push(...splitEvenly(line));
  }
  return lines;
}

function splitEvenly(line: string): string[] {
  if (line.length <= LINE_CHARS) return [line];
  const words = line.split(" ");
  const rows = Math.min(words.length, Math.ceil(line.length / LINE_CHARS));
  const target = line.length / rows;
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    // Break before this word once the row would pass its even share.
    if (current && next.length > target + 3 && out.length < rows - 1) {
      out.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) out.push(current);
  return out;
}

const RATIOS: Record<ImageAspect, number> = { "4:5": 4 / 5, "5:4": 5 / 4, "1:1": 1, "9:16": 9 / 16, "16:9": 16 / 9 };

/**
 * The frame the words are drawn in: the photo's own shape, or the chosen
 * shape cut from its centre. `width` and `height` are the layout frame at the
 * kit's scale; `scale` enlarges it to the photo's own resolution, up to a cap,
 * and never shrinks it below the layout size.
 */
export function textPhotoFrame(source: { width: number; height: number }, aspect?: ImageAspect): { width: number; height: number; scale: number } {
  const ratio = aspect ? RATIOS[aspect] : source.width / source.height;
  // The widest region of that shape the photo holds.
  const cropWidth = Math.min(source.width, source.height * ratio);
  const scale = Math.max(1, Math.min(cropWidth, MAX_OUTPUT_WIDTH) / LAYOUT_WIDTH);
  return { width: LAYOUT_WIDTH, height: Math.round(LAYOUT_WIDTH / ratio), scale };
}

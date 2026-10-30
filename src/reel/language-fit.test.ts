import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas } from "@napi-rs/canvas";

import { resolveKit } from "../carousel/kits";
import { balancedLines, layoutParagraph, layoutTitle, layoutWrapped } from "../carousel/render";
import { textPhotoLines } from "../carousel/text-photo";
import { phraseLines } from "../content/phrases";
import { TEXT_STYLE_IDS, smallColumn } from "../content/text-styles";
import { layoutCue, layoutHook, renderOverlay } from "./overlay";

/* Lines in other languages: every splitter breaks on spaces, keeps accented
   letters whole, and a word too long for its column (German builds them)
   shrinks the type rather than running off the frame. */

const ROMANIAN = "Nu ai nevoie să-ți arăți fața ca să crești. Îți trebuie un avatar care postează în fiecare zi, fără să te filmezi.";
const GERMAN = "Die Datenschutzgrundverordnung ist nicht dein Problem. Deine Selbstständigkeitsversicherungsbeiträge sind es.";
/** A long real compound: 39 letters. */
const COMPOUND = "Selbstständigkeitsversicherungsbeiträge";
/** The textbook extreme, 63 letters: past what any column holds at a readable size. */
const EXTREME = "Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz";

const words = (text: string) => text.split(/\s+/).filter(Boolean);

/** How wide a reel line is drawn, measured in the face the overlay registered. */
function reelWidth(line: string, style: string, size: number): number {
  const ctx = createCanvas(10, 10).getContext("2d");
  const serif = style === "serif" || style === "serif_boxed";
  ctx.fontVariationSettings = `"wght" ${serif ? 500 : 600}`;
  ctx.font = `${size}px "${serif ? "HookSerif" : "HookSans"}"`;
  return ctx.measureText(line).width;
}

const MAX_WIDTH: Record<string, number> = { boxed: 860, serif_boxed: 860, bold: 750, pastel: 750, serif: 750 };

test("reel hooks in Romanian and German keep every word and letter, and no line runs past the column", () => {
  for (const text of [ROMANIAN, GERMAN, `Das ist ${COMPOUND}`]) {
    for (const style of TEXT_STYLE_IDS) {
      for (const size of ["large", "small"] as const) {
        const layout = layoutHook(text, style, 900, size);
        assert.deepEqual(words(layout.lines.join(" ")), words(text), `${style} ${size}`);
        const column = size === "small" ? Math.round(1080 * smallColumn(style)) : MAX_WIDTH[style];
        for (const line of layout.lines) {
          const width = reelWidth(line, style, layout.fontSize);
          assert.ok(width <= column, `${style} ${size}: "${line}" is ${Math.round(width)}px at ${layout.fontSize}px, over ${column}`);
        }
      }
    }
  }
});

test("a hook that is one very long German word is set smaller, not cut and not overflowing", () => {
  const plain = layoutHook("Das ist neu", "boxed", 900);
  const long = layoutHook(EXTREME, "boxed", 900);
  assert.deepEqual(long.lines, [EXTREME]);
  assert.ok(long.fontSize < plain.fontSize, `${long.fontSize} vs ${plain.fontSize}`);
  assert.ok(reelWidth(EXTREME, "boxed", long.fontSize) <= 860);
  // And it draws.
  assert.ok(renderOverlay(long, 400).length > 0);
});

test("a Romanian second line with diacritics lays out on one line and draws", () => {
  const cue = layoutCue("Citește descrierea", "serif");
  assert.deepEqual(cue.lines, ["Citește descrierea"]);
  assert.ok(renderOverlay(cue, 1200).length > 0);
});

test("carousel titles, wrapped titles and sentences fit their box in Romanian and German", () => {
  const kit = resolveKit("signal");
  const title = layoutTitle(kit, { lines: ["Ți-am spus", "*adevărul*"], accent: "fără fața mea." }, { maxWidth: 872, maxHeight: 700 });
  assert.ok(title.width <= 872 && title.height <= 700);
  const german = layoutTitle(kit, { lines: [COMPOUND] }, { maxWidth: 872, maxHeight: 700 });
  assert.ok(german.width <= 872, `${german.width}`);

  for (const text of ["obiceiuri care îți schimbă creierul încet", `Die ${COMPOUND} ist da`]) {
    const wrapped = layoutWrapped(kit, text, { size: 92, maxWidth: 912, maxLines: 3 });
    assert.ok(wrapped.width <= 912, `${text}: ${wrapped.width}`);
    assert.deepEqual(words(wrapped.lines.map((line) => line.runs.map((run) => run.text).join("")).join(" ")).map((word) => word.toLowerCase()), words(text).map((word) => word.toLowerCase()));
  }

  for (const text of [ROMANIAN, GERMAN, `Kurz: ${COMPOUND}.`]) {
    const paragraph = layoutParagraph(kit, text, { size: 40, maxWidth: 700, maxLines: 3 });
    assert.deepEqual(words(paragraph.lines.join(" ")), words(text));
    const ctx = createCanvas(10, 10).getContext("2d");
    ctx.font = `${paragraph.size}px "${kit.fonts.body.family}"`;
    ctx.fontVariationSettings = `"wght" ${kit.fonts.body.weight}`;
    ctx.letterSpacing = `${(kit.fonts.body.tracking * paragraph.size).toFixed(2)}px`;
    for (const line of paragraph.lines) assert.ok(ctx.measureText(line).width <= 700, `"${line}" at ${paragraph.size}px`);
  }
});

test("phrase breaking and words on a photo split on spaces and pauses, never inside an accented word", () => {
  const chars = (line: string) => line.length;
  const lines = phraseLines(ROMANIAN, chars, 22);
  assert.equal(lines.join(" "), ROMANIAN);
  for (const line of lines) for (const word of words(line)) assert.ok(words(ROMANIAN).includes(word), word);
  const photo = textPhotoLines(`Fă-o.\n${GERMAN}`);
  assert.deepEqual(words(photo.join(" ")), words(`Fă-o. ${GERMAN}`));
  assert.ok(photo.includes("Fă-o."));
  // A word longer than the column is its own line, whole.
  assert.ok(balancedLines(`ist ${COMPOUND} da`, chars, 20).includes(COMPOUND));
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { resolveKit } from "../carousel/kits";
import { renderSlideAt } from "../carousel/render";
import { carouselSpecSchema } from "../carousel/spec";
import { layoutCue, layoutHook, renderOverlay } from "../reel/overlay";
import { contrast, inkOn, keywordColorOf, keywordMarkOf, keywordPaint, keywordRuns, normalizeHex } from "./keyword-color";
import type { BrandProfile } from "./hooks";

test("colours are read as #rrggbb or not at all", () => {
  assert.equal(normalizeHex("#E8322B"), "#e8322b");
  assert.equal(normalizeHex(" #abc "), "#aabbcc");
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#12345"), null);
  assert.equal(normalizeHex(undefined), null);
  assert.equal(keywordColorOf({ keywordColor: "javascript:alert(1)" }), null);
});

test("contrast and ink follow WCAG", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(contrast("#777777", "#777777"), 1);
  assert.equal(inkOn("#ffd23f"), "#111111");
  assert.equal(inkOn("#2f3a8f"), "#ffffff");
});

test("a colour that reads is drawn as type; one that does not gets a block", () => {
  assert.deepEqual(keywordPaint("#e8322b", "#ffffff"), { kind: "text", color: "#e8322b" });
  assert.deepEqual(keywordPaint("#ffd23f", "#ffffff"), { kind: "block", fill: "#ffd23f", ink: "#111111" });
  assert.deepEqual(keywordPaint("#ffd23f", "#1c1c1c"), { kind: "text", color: "#ffd23f" });
  assert.deepEqual(keywordPaint("#1b2a6b", "#1c1c1c"), { kind: "block", fill: "#1b2a6b", ink: "#ffffff" });
});

test("runs split out her keywords as whole words and join back to the line", () => {
  const line = "Comment guide, or GUIDEBOOK: guide!";
  const runs = keywordRuns(line, ["GUIDE"]);
  assert.equal(runs.map((run) => run.text).join(""), line);
  assert.deepEqual(
    runs.filter((run) => run.keyword).map((run) => run.text),
    ["guide", "guide"],
  );
  assert.deepEqual(keywordRuns("No keyword here", ["GUIDE"]), [{ text: "No keyword here", keyword: false }]);
  assert.deepEqual(keywordRuns("Comment ȘTIU", ["știu"]).at(-1), { text: "ȘTIU", keyword: true });
});

test("a profile's mark is every keyword and the colour, or nothing without a colour", () => {
  const profile: BrandProfile = {
    niche: "n",
    audience: "a",
    offer: "Kit",
    keyword: "AVATAR",
    voice: "",
    proofPoints: [],
    offers: [{ offer: "Coaching", keyword: "COACH" }],
  };
  assert.equal(keywordMarkOf(profile), null);
  assert.deepEqual(keywordMarkOf({ ...profile, keywordColor: "#2F7BFF" }), { words: ["AVATAR", "COACH"], color: "#2f7bff" });
});

/* ------------------------------------------------------------------ */
/* Drawn                                                               */
/* ------------------------------------------------------------------ */

/** How many pixels of a PNG are within a small distance of a colour. */
async function pixelsNear(png: Buffer, hex: string, tolerance = 30): Promise<number> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 200 && Math.abs(data[i] - r) < tolerance && Math.abs(data[i + 1] - g) < tolerance && Math.abs(data[i + 2] - b) < tolerance) count += 1;
  }
  return count;
}

const RED = "#e8322b";
const YELLOW = "#ffd23f";

test("a reel cue draws her keyword in her colour, and nothing else in it", async () => {
  const cue = layoutCue("Comment GUIDE for the list", "bold");
  const plain = await pixelsNear(renderOverlay(cue, 600), RED);
  const marked = await pixelsNear(renderOverlay(cue, 600, { words: ["GUIDE"], color: RED }), RED);
  assert.equal(plain, 0);
  assert.ok(marked > 300, `expected red letters, found ${marked} red pixels`);
  // A line without her keyword is untouched.
  const other = layoutHook("I stopped filming myself", "bold");
  assert.equal(await pixelsNear(renderOverlay(other, 600, { words: ["GUIDE"], color: RED }), RED), 0);
});

test("on a white box, a pale colour becomes a block behind the word", async () => {
  const cue = layoutCue("Comment GUIDE", "boxed");
  const yellow = await pixelsNear(renderOverlay(cue, 600, { words: ["GUIDE"], color: YELLOW }), YELLOW);
  // A block is a filled shape, far more pixels than letters alone would be.
  assert.ok(yellow > 3000, `expected a yellow block, found ${yellow} yellow pixels`);
});

test("a carousel's last slide takes her colour, and a slide redrawn later keeps it", async () => {
  const spec = carouselSpecSchema.parse({
    name: "colour-set",
    caption: "Comment GUIDE for it.",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["One"] } },
      { type: "paper", title: { lines: ["Two"] }, body: "Two." },
      { type: "paper", title: { lines: ["Three"] }, body: "Three." },
      { type: "paper", title: { lines: ["Four"] }, body: "Four." },
      { type: "keyword", keyword: "GUIDE", promise: "I will send you the list." },
    ],
  });
  const purple = "#8b5cf6";
  // A flat grey photo: nothing in it is near her colour.
  const canvas = createCanvas(1080, 1350);
  const paint = canvas.getContext("2d");
  paint.fillStyle = "#808080";
  paint.fillRect(0, 0, 1080, 1350);
  const photos = { p00: { data: canvas.toBuffer("image/png"), face: null } };
  for (const kitId of ["signal", "serif", "pastel"]) {
    const kit = resolveKit(kitId, {});
    const plain = await pixelsNear(await renderSlideAt(spec, kit, photos, 4), purple, 12);
    const marked = await pixelsNear(await renderSlideAt(spec, kit, photos, 4, { keywordColor: purple }), purple, 12);
    assert.ok(marked > plain + 2000, `${kitId}: expected purple on the keyword slide (${plain} before, ${marked} after)`);
    // The other slides are not hers to colour.
    const cover = await pixelsNear(await renderSlideAt(spec, kit, photos, 0, { keywordColor: purple }), purple, 12);
    assert.equal(cover, await pixelsNear(await renderSlideAt(spec, kit, photos, 0), purple, 12), `${kitId}: slide 1 changed`);
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  beatsOf,
  clipPrompt,
  droppedNote,
  hasForbidden,
  inspectIdea,
  MAX_BEATS,
  maxTalkingSecondsFor,
  MOTION_PRESETS,
  MOTION_RULES,
  stripRules,
  spokenWords,
  SUGGESTION_COUNT,
  talkingSeconds,
} from "./motion";

/* The rules are the product here.
 *
 * Every one of these cases is a thing a video model will happily do and that
 * costs three credits to find out about, so each is checked in code rather
 * than trusted to a rewrite. The headline case is the founder's own failed
 * attempt on 2026-09-22, at the bottom.
 */

const kinds = (idea: string) => inspectIdea(idea).dropped.map((item) => item.kind);

test("the rules are still the rules, and every prompt ends with them", () => {
  // If this string ever changes, the clips change. That is the point of the test.
  assert.match(MOTION_RULES, /Two or three small, slow, natural movements flowing one into the next/);
  assert.match(MOTION_RULES, /No camera cuts, no zoom, no text/);
  assert.equal(clipPrompt("  She takes a sip.  "), `She takes a sip. ${MOTION_RULES}`);
});

test("a beat ends at a full stop or at 'then', not at every comma", () => {
  // One continuous gesture, however many commas and ands it is written with.
  assert.deepEqual(beatsOf("She lifts the cup, takes a slow sip and lowers it again."), [
    "She lifts the cup, takes a slow sip and lowers it again",
  ]);
  assert.deepEqual(beatsOf("She tucks her hair, then smiles."), ["She tucks her hair", "smiles"]);
  assert.deepEqual(beatsOf("She looks up. She smiles."), ["She looks up", "She smiles"]);
});

test("an idea that already obeys the rules survives untouched", () => {
  const { kept, dropped } = inspectIdea("She lifts the iced coffee, takes a small sip, and lowers it with a soft smile.");
  assert.deepEqual(dropped, []);
  assert.equal(kept, "She lifts the iced coffee, takes a small sip, and lowers it with a soft smile.");
});

test("camera moves are dropped, by name", () => {
  for (const [idea, expected] of [
    ["She smiles, then the camera pans left.", "camera pan"],
    ["She waves and it zooms in on her face.", "zoom"],
    ["She sits still, then tilt down to her shoes.", "camera tilt"],
    ["She stands there, then a high angle shot of her outfit.", "camera angle change"],
    ["She waits, then pull the camera back.", "camera move"],
    ["She waits, then the camera rises above her.", "camera move"],
    ["She poses for a drone shot.", "camera move"],
  ] as const) {
    const { dropped } = inspectIdea(idea);
    assert.ok(dropped.length > 0, `nothing was dropped from: ${idea}`);
    const camera = dropped.find((item) => item.kind === "camera");
    assert.ok(camera, `no camera drop in: ${idea}`);
    assert.equal(camera.note, `The ${expected} was left out: big camera moves are where faces drift.`);
  }
});

test("looking at the camera is a gaze, not a camera move", () => {
  // The check that fires on the word "camera" alone deletes the good half of
  // most honest ideas, so these have to stay.
  for (const idea of [
    "She lifts the cup and takes a slow sip, then glances at the camera.",
    "She smiles at the camera.",
    "She looks into the camera in a soft way.",
  ]) {
    assert.deepEqual(kinds(idea), [], idea);
    assert.equal(hasForbidden(idea), false, idea);
  }
});

test("a head tilt, a frying pan and a Zoom call are not camera moves", () => {
  /* All three came out of looking at what the live suggestion call actually
     writes, on 2026-09-22: the bare verbs threw away the most natural small
     movement there is. A camera move has to name a direction or the camera. */
  for (const idea of [
    "She slowly tilts her head to one side, resting against the car seat.",
    "She lifts the pan off the hob and sets it down.",
    "She glances at her Zoom call, then back down.",
    "She removes her hand from the steering wheel and rests it in her lap.",
  ]) {
    assert.deepEqual(kinds(idea), [], idea);
  }
});

test("cuts, on-screen text, outfit changes and big expressions are dropped", () => {
  assert.deepEqual(kinds("She smiles, then cut to her laptop."), ["cut"]);
  assert.deepEqual(kinds("She waves, then on-screen text appears."), ["text"]);
  assert.deepEqual(kinds("She stands up, then changes her outfit."), ["wardrobe"]);
  assert.deepEqual(kinds("She smiles, then takes off her sunglasses."), ["wardrobe"]);
  assert.deepEqual(kinds("She looks up, then bursts out laughing."), ["expression"]);
  assert.deepEqual(kinds("She stands by the window and poses."), ["vague"]);
});

test("a mood is quoted back rather than named, because there is no word for it", () => {
  const [dropped] = inspectIdea("She stands by the window and poses.").dropped;
  assert.equal(dropped.kind, "vague");
  assert.equal(dropped.note, "“poses” was left out: a video model can film a movement, not a mood.");
});

test("more than three movements loses the extra ones, after the forbidden ones", () => {
  const { kept, dropped } = inspectIdea(
    "She sips her coffee, then she tucks her hair, then she waves, then she stands up, then she sits down.",
  );
  assert.equal(kept, "She sips her coffee, then she tucks her hair, then she waves.");
  assert.deepEqual(
    dropped.map((item) => item.kind),
    ["extra", "extra"],
  );
  assert.equal(beatsOf(kept).length, MAX_BEATS);
});

test("nothing filmable left means nothing kept, rather than a prompt made up for her", () => {
  assert.equal(inspectIdea("Pan across the room at a high angle.").kept, "");
});

test("the founder's own failed attempt becomes three small motions, and says what went", () => {
  /* Typed on 2026-09-22, sent as written, and came back with a drifting face.
     The camera pan is what did it; she was never told it was in there. */
  const { kept, dropped } = inspectIdea(
    "She looks into the camera and poses, then uses one hand to flip her hair. " +
      "she smiles at the camera, then pans it sort of above her to show off her fit at a high angle",
  );

  /* "and poses" is a mood word riding on a real gaze, so the gaze stays and
     only the word goes; the smile is the third beat, which a clip now has room
     for. Before this, the whole first sentence went for the one word. */
  assert.equal(kept, "She looks into the camera, then uses one hand to flip her hair, then she smiles at the camera.");
  // The camera move first: it is the one that costs her the likeness.
  assert.deepEqual(
    dropped.map((item) => item.kind),
    ["camera", "vague"],
  );
  assert.match(droppedNote(dropped), /^The camera pan was left out: big camera moves are where faces drift\./);
});

test("a mood phrase is trimmed out of a movement rather than taking the movement with it", () => {
  /* Typed on 2026-09-22 and refused whole: "there is no movement left in
     that". There was a great deal of movement left in that. */
  const { kept, dropped } = inspectIdea(
    "She slowly raises the phone in her hand a few inches toward her face and gently brings it back down " +
      "to chest height as she tilts her head to show off her ponytail and the pony tail sways.",
  );
  assert.equal(
    kept,
    "She slowly raises the phone in her hand a few inches toward her face and gently brings it back down " +
      "to chest height as she tilts her head and the pony tail sways.",
  );
  assert.deepEqual(dropped.map((item) => item.phrase), ["show off"]);

  // A beat that is nothing but mood still has nothing to keep.
  assert.equal(inspectIdea("she poses").kept, "");
});

test("the rules echoed back into an answer are cut off, with everything after them", () => {
  /* Seen live on 2026-09-22: asked for a motion that obeys the rules, the
     model wrote the motion and then wrote the rules out again. They are
     phrased as prohibitions, so the forbidden-element check passed them. */
  const echoed =
    "She lifts one hand and slowly tucks her hair behind her ear. " +
    "Handheld smartphone video with a slight natural sway. Two or three small, slow, natural movements flowing one into the next, so she is never still.";
  assert.equal(stripRules(echoed), "She lifts one hand and slowly tucks her hair behind her ear.");

  // A sentence from the middle of the rules is cut too, not only the first.
  assert.equal(stripRules("She sips it. She keeps looking where she is looking. No zoom."), "She sips it.");
  // An answer that is nothing but the rules leaves nothing to ship.
  assert.equal(stripRules(MOTION_RULES), "");
  // And an honest answer is untouched.
  assert.equal(stripRules("She takes one slow sip."), "She takes one slow sip.");
});

/* ------------------------------------------------------------------ */
/* The presets                                                         */
/* ------------------------------------------------------------------ */

test("six presets, each a legal movement and each with a chip-sized label", () => {
  assert.equal(MOTION_PRESETS.length, 6);
  assert.equal(new Set(MOTION_PRESETS.map((preset) => preset.id)).size, 6);

  for (const preset of MOTION_PRESETS) {
    assert.ok(preset.label.length > 0 && preset.label.length <= 24, `label too long: ${preset.label}`);
    assert.ok(preset.idea.length >= 16, `idea too short: ${preset.id}`);
    // A preset that the polish step would then complain about is not a preset.
    assert.deepEqual(inspectIdea(preset.idea).dropped, [], `${preset.id} breaks the rules`);
    assert.equal(inspectIdea(preset.idea).kept, preset.idea, `${preset.id} is trimmed by its own rules`);
  }
});

test("the presets cover the six the founder asked for", () => {
  assert.deepEqual(
    MOTION_PRESETS.map((preset) => preset.id),
    ["sip", "hair", "laptop", "smile", "shoulder", "earring"],
  );
  // The drawer promises three suggestions and the presets are its floor.
  assert.ok(MOTION_PRESETS.length >= SUGGESTION_COUNT);
});

/* A talking script is written for the clip it is spoken in. An Omni talking
   clip is eight seconds, and every script the writer is asked for comes out
   exactly eight: the shortest reaches it at three words a second, and the
   longest is clamped to it. */
test("an Omni talking script is always an eight-second clip", () => {
  assert.equal(maxTalkingSecondsFor("omni"), 8);
  assert.equal(maxTalkingSecondsFor("seedance"), 12);
  assert.deepEqual(spokenWords(12), { min: 30, max: 34, cut: 36 }, "Seedance keeps the numbers it was tuned with");

  const omni = spokenWords(8);
  assert.deepEqual(omni, { min: 22, max: 26, cut: 26 });
  assert.equal(talkingSeconds("word ".repeat(omni.min), 4, 8), 8);
  assert.equal(talkingSeconds("word ".repeat(omni.cut), 4, 8), 8);
  // Seedance's longest script still asks for its twelve.
  assert.equal(talkingSeconds("word ".repeat(34)), 12);
});

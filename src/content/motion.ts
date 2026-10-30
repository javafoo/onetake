/* The motion rules, and the code that enforces them.
 *
 * `MOTION_RULES` was learned the hard way in image-to-video: small actions,
 * a handheld camera, and nothing that asks the face to change. Big moves and
 * eye movement are where faces drift. Two or three beats, not one: a single
 * sip over five seconds reads as a still with a sway and leaves her frozen at
 * the start or the end (the founder's notes, 2026-09-22 and 23), while small
 * movements that flow into each other keep the face as steady as one. Every clip prompt ends with it, and it
 * lives here — pure, no provider, no filesystem — so the drawer, the polish
 * step, the job and the tests all read the same words.
 *
 * The important half of this file is not the rules, it is `inspectIdea`.
 * Deciding what a rough idea asks for that the rules forbid is done in code,
 * not by a model: a model asked to police itself will quietly keep a camera
 * pan because the sentence reads better with it, and the creator finds out
 * three credits later. So the beats are split here, the forbidden ones are
 * named here, and the sentence the person reads about what was dropped is
 * written here. The model only rewords what survives.
 */

import { isEnglish, LANGUAGES, normaliseLanguage, spokenRange, speechWordsPerSecond } from "./languages";

export const MOTION_RULES =
  "Handheld smartphone video with a slight natural sway. Two or three small, slow, natural movements flowing one into the next, so she is never still. " +
  "Her face, hair, makeup and outfit stay exactly as in the image. She keeps looking where she is looking. " +
  "No camera cuts, no zoom, no text.";

/** The full prompt sent to the video model. Pure, so a later poll can rebuild
    it from the job's input instead of carrying a copy around. */
export function clipPrompt(motion: string): string {
  return `${motion.trim()} ${MOTION_RULES}`;
}

/* A talking clip is the other kind of clip the product makes: she says one
   line to camera, with sound. The b-roll rules above forbid exactly that, so a
   talking clip has rules of its own. Seedance is the model for it (it holds
   her face through speech and can generate the audio); Kling is b-roll. */
export const TALKING_RULES =
  "She looks into the camera and speaks the line naturally, with clear lip movement matched to the words, " +
  "small natural head and hand movement, and a calm confident delivery. Handheld smartphone video, slight natural sway. " +
  "Her face, hair, makeup and outfit stay exactly as in the image. No camera cuts, no zoom, no music, no text on screen.";

/**
 * The line she says, as the video model receives it. In any language but
 * English the language is named, so the model speaks it rather than reading
 * the words with an English voice. The rules stay in English: they are
 * instructions to the model, not words she says.
 */
export function talkingPrompt(line: string, language?: string): string {
  const spoken = line.trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (isEnglish(language)) return `She says, in a natural speaking voice: "${spoken}" ${TALKING_RULES}`;
  const { english } = LANGUAGES[normaliseLanguage(language)];
  return `She says, in ${english}, in a natural speaking voice with native ${english} pronunciation: "${spoken}" ${TALKING_RULES}`;
}

/* Words per second of natural speech, for choosing a clip length that fits
   the line. On the high side on purpose: given spare seconds the model fills
   them with pauses (heard on the first live talking clip, 2026-09-23, and
   again on a ten-second Omni clip that finished 26 words with a second and a
   half to spare); given a tight fit it simply speaks at pace. Three a second
   is the founder's measure from Google Flow: about 30 words in ten seconds
   (2026-09-25). */
export const SPEECH_WORDS_PER_SECOND = 3;

/** The longest talking clip the product sells: twelve seconds is a claim, a turn and a promise, and about twelve credits. */
export const MAX_TALKING_SECONDS = 12;

/** An Omni talking clip is eight seconds (the model stops at ten): 22 to 26 words, 6 credits. Founder, 2026-09-25. */
export const OMNI_TALKING_SECONDS = 8;

/** The longest talking clip this video model can make. */
export function maxTalkingSecondsFor(model: string): number {
  return model === "omni" ? OMNI_TALKING_SECONDS : MAX_TALKING_SECONDS;
}

/* The scripts the writer is asked for, by clip length. Both run a little
   over three words a second on purpose, so she speaks at pace instead of
   pausing: 26 words in eight seconds is 3.25. `talkingSeconds` would give 26
   words ten seconds; the model's ceiling clamps it to eight. */
const SPOKEN_WORDS: Record<number, { min: number; max: number; cut: number }> = {
  [MAX_TALKING_SECONDS]: { min: 30, max: 34, cut: 36 },
  [OMNI_TALKING_SECONDS]: { min: 22, max: 26, cut: 26 },
};

/**
 * How many words the writer is asked for, for a talking clip this long. The
 * two lengths the product sells are set by hand; any other is worked out from
 * the pace, cut where a script still fits. Outside English the range is
 * scaled by the language's pace (see ./languages.ts), so a line with longer
 * words still fits the clip.
 */
export function spokenWords(seconds: number, language?: string): { min: number; max: number; cut: number } {
  const set = SPOKEN_WORDS[seconds];
  if (set) return spokenRange(set, language);
  const cut = Math.floor((seconds - 0.5) * SPEECH_WORDS_PER_SECOND);
  return spokenRange({ min: cut - 4, max: cut, cut }, language);
}

/** How long a talking clip needs for this line: the words at speaking pace plus half a second to start. */
export function talkingSeconds(line: string, min = 4, max = MAX_TALKING_SECONDS, language?: string): number {
  const words = line.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(max, Math.max(min, Math.ceil(words / speechWordsPerSecond(SPEECH_WORDS_PER_SECOND, language) + 0.5)));
}

/* ------------------------------------------------------------------ */
/* Presets                                                             */
/* ------------------------------------------------------------------ */

export interface MotionPreset {
  /** Stable id, so a chip can be tested and logged without its wording. */
  id: string;
  /** What the chip says. Two or three words: it has to fit a phone. */
  label: string;
  /** The rough idea the chip stands for. It still goes through polish. */
  idea: string;
}

/**
 * Six movements that work on almost any photo.
 *
 * These are the ones that came back clean run after run: a hand, a head, or a
 * cup, moving once. They are a floor, not a ceiling — the per-photo
 * suggestions above them are better when we have them — and they are the
 * fallback whenever a suggestion call fails, so this list must never be empty.
 */
export const MOTION_PRESETS: readonly MotionPreset[] = [
  { id: "sip", label: "Take a sip", idea: "She lifts what she is holding, takes one slow sip, and lowers it again." },
  { id: "hair", label: "Tuck her hair", idea: "She slowly tucks one side of her hair behind her ear." },
  { id: "laptop", label: "Glance down, then up", idea: "She glances down at the laptop in front of her, then lifts her eyes again." },
  { id: "smile", label: "Slow smile", idea: "A small smile spreads slowly across her face." },
  { id: "shoulder", label: "Look over her shoulder", idea: "She turns her head slowly to look back over one shoulder." },
  { id: "earring", label: "Adjust an earring", idea: "She raises one hand and slowly adjusts the earring on that side." },
];

/** How many per-photo suggestions the drawer shows. */
export const SUGGESTION_COUNT = 3;

/* ------------------------------------------------------------------ */
/* What the rules forbid                                               */
/* ------------------------------------------------------------------ */

export type DroppedKind = "camera" | "cut" | "text" | "wardrobe" | "expression" | "vague" | "extra";

export interface Dropped {
  kind: DroppedKind;
  /** The words from her idea this came out of. Shown back so it is recognisable. */
  phrase: string;
  /** One sentence: what was left out and why. Shown before any credit is spent. */
  note: string;
}

interface Rule {
  kind: Exclude<DroppedKind, "extra">;
  re: RegExp;
  /** Names the thing in the sentence, e.g. "The camera pan was left out". A
      rule with no label quotes the creator's own words instead. */
  label?: string;
  why: string;
}

const CAMERA_WHY = "big camera moves are where faces drift.";

/* Ordered: the first rule a beat matches is the one it is refused under, so
   the most specific and most common problems come first. Every pattern is
   word-bounded — "Japan" is not a pan and "pantry" is not a camera move. */
const RULES: readonly Rule[] = [
  /* Each of these three needs a direction or the word camera, and the reason
     is what the live suggestions came back with: "she slowly tilts her head to
     one side" is the most natural small movement there is and the bare verb
     threw it away. A pan is a pan on the stove in a kitchen scene, a zoom is a
     Zoom call, and a tilt is usually her head. The camera is the exception, so
     the camera has to be visible in the words. */
  {
    kind: "camera",
    re: /\bpan(?:s|ning|ned)?\s+(?:up|down|left|right|across|around|over|out|in|to|it|the)\b|\b(?:camera|shot|frame)\b[^.]{0,20}\bpan/i,
    label: "camera pan",
    why: CAMERA_WHY,
  },
  {
    kind: "camera",
    re: /\bzoom(?:s|ing|ed)?\s+(?:in|out|on|into|up|to)\b|\b(?:slow|quick|crash|slight)\s+zoom\b/i,
    label: "zoom",
    why: CAMERA_WHY,
  },
  {
    kind: "camera",
    re: /\btilt(?:s|ing|ed)?\s+(?:up|down|back|left|right)\b|\b(?:camera|shot|frame)\b[^.]{0,20}\btilt/i,
    label: "camera tilt",
    why: CAMERA_WHY,
  },
  {
    kind: "camera",
    re: /\b(?:high|low|overhead|bird'?s[- ]eye|worm'?s[- ]eye|wide|close[- ]?up|dutch)[- ]?(?:angle|shot)\b/i,
    label: "camera angle change",
    why: CAMERA_WHY,
  },
  {
    kind: "camera",
    re: /\b(?:dolly|dollies|tracking shot|orbits?|orbiting|crane|drone|aerial|selfie stick|gimbal)\b/i,
    label: "camera move",
    why: CAMERA_WHY,
  },
  {
    kind: "camera",
    /* Both directions of the same sentence: "the camera pulls back" and "pull
       the camera back". Deliberately not "…the camera in…" or any other bare
       preposition — "she looks into the camera in a soft way" is a gaze, not a
       camera move, and a check that fires on it would delete the good half of
       most honest ideas. */
    re: /\bcamera\b[^.]{0,20}\b(?:pulls?|pushes?|circles?|swings?|rises?|lowers?|moves?|floats?|drifts?|sweeps?|glides?|travels?|follows?)\b|\b(?:pull|pulls|push|pushes|swing|swings|circle|circles|raise|raises|lower|lowers|move|moves)\b[^.]{0,20}\b(?:camera|frame)\b/i,
    label: "camera move",
    why: CAMERA_WHY,
  },
  {
    kind: "cut",
    re: /\b(?:cuts? to|jump cut|second shot|another shot|second clip|transitions? to|montage|scene change|split screen)\b/i,
    label: "cut to a second shot",
    why: "five seconds is one continuous take; a cut is a second clip.",
  },
  {
    kind: "text",
    re: /\b(?:on[- ]?screen text|text overlay|caption appears|subtitles?|title card|watermark|words? appear|text pops? up)\b/i,
    label: "on-screen text",
    why: "the hook is printed onto the reel afterwards, not by the video model.",
  },
  {
    kind: "wardrobe",
    /* "removes her hand from the wheel" is a movement, not a costume change,
       so this asks for the garment rather than for the verb alone. */
    re: /\b(?:changes? (?:her )?(?:outfit|clothes|top|dress|jacket|hair)|different outfit|new outfit|(?:puts?|takes?|pulls?) (?:on|off) (?:her|the|a)\b|lets? her hair down|ties? her hair up|dyes?)\b/i,
    label: "outfit change",
    why: "her face, hair and outfit have to stay exactly as they are in the photo.",
  },
  {
    kind: "expression",
    re: /\b(?:winks?|bursts? out laughing|laughs? out loud|sticks? (?:her )?tongue out|pulls? a face|makes? a funny face|screams?|shouts?|cries|crying|yawns?|gasps?)\b/i,
    label: "big change of expression",
    why: "a face that changes that much stops being hers.",
  },
  {
    kind: "vague",
    re: /\b(?:poses?|posing|shows? off|slays?|serving looks|vibes?|aesthetic|looks? (?:hot|amazing|gorgeous|fire))\b/i,
    why: "a video model can film a movement, not a mood.",
  },
];

/** How many beats a five-to-eight-second clip can carry: enough that she is moving from the first frame to the last. */
export const MAX_BEATS = 3;

/**
 * One idea, cut into the movements it actually asks for.
 *
 * A beat ends at a full stop or at the word "then": within a beat, commas and
 * "and" are one continuous gesture ("she lifts the cup, takes a sip and lowers
 * it" is one movement, not three), which is why this counts beats rather than
 * verbs.
 */
export function beatsOf(idea: string): string[] {
  return idea
    .split(/(?:[.!?;]+\s*)|(?:,?\s*(?:and\s+)?then\s+)|(?:,?\s*after that,?\s+)|(?:,?\s*next,?\s+)/i)
    .map((beat) =>
      beat
        .trim()
        .replace(/^(?:and|then|but|so|,)\s+/i, "")
        .replace(/[\s,;.]+$/, "")
        .trim(),
    )
    .filter((beat) => beat.length > 0);
}

function noteFor(rule: Rule, match: string): string {
  const subject = rule.label ? `The ${rule.label}` : `“${match.trim()}”`;
  return `${subject} was left out: ${rule.why}`;
}

/** The first rule this beat breaks, with the words that broke it. */
function breaks(beat: string): { rule: Rule; match: string } | null {
  for (const rule of RULES) {
    const found = rule.re.exec(beat);
    if (found) return { rule, match: found[0] };
  }
  return null;
}

/**
 * The beat with one mood phrase cut out of it. "to show off her ponytail"
 * goes as a whole — the phrase, the "to" in front of it and the thing being
 * shown off — up to the next joining word, so what is left still reads.
 */
function withoutPhrase(beat: string, phrase: string): string {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const clause = new RegExp(
    `\\s*(?:,\\s*)?(?:to|and|while)?\\s*${escaped}(?:\\s+(?!and\\b|as\\b|while\\b|then\\b)[^,]*?)?(?=\\s+(?:and|as|while|then)\\b|,|$)`,
    "i",
  );
  return beat
    .replace(clause, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*(?:and|as|while|then|,)\s+/i, "")
    .replace(/\s+(?:and|as|while|then|to|,)\s*$/i, "")
    .trim();
}

/** Enough words left to be a movement rather than a fragment. */
function isMovement(beat: string): boolean {
  return beat.split(/\s+/).filter(Boolean).length >= 3;
}

/** True when any part of this text asks for something the rules forbid. */
export function hasForbidden(text: string): boolean {
  return beatsOf(text).some((beat) => breaks(beat) !== null);
}

export interface Inspection {
  /** The beats that survive, rejoined. Empty when nothing did. */
  kept: string;
  dropped: Dropped[];
}

/**
 * What of this idea can be filmed, and what was taken out of it.
 *
 * Runs before a model is asked anything, and again over whatever the model
 * writes back, so a rewrite cannot sneak a camera move in through the side
 * door. Extra beats are dropped last, after the forbidden ones, so "pose, hair
 * flip, smile, camera pan" loses the pose and the pan and keeps the two real
 * movements — rather than keeping the pose because it happened to be first.
 */
export function inspectIdea(idea: string): Inspection {
  const dropped: Dropped[] = [];
  const surviving: string[] = [];

  for (const original of beatsOf(idea)) {
    /* A mood word is trimmed out of its beat, not the beat out of the idea.
       "she tilts her head to show off her ponytail" is a real movement with a
       purpose attached; the purpose is what the model cannot film. Taking the
       whole sentence for it was how a founder's perfectly good idea came back
       as "no movement left". Only a beat that is nothing but mood is dropped. */
    let beat = original;
    for (;;) {
      const broken = breaks(beat);
      if (!broken) break;
      if (broken.rule.kind !== "vague") {
        dropped.push({ kind: broken.rule.kind, phrase: original, note: noteFor(broken.rule, broken.match) });
        beat = "";
        break;
      }
      const trimmed = withoutPhrase(beat, broken.match);
      dropped.push({ kind: "vague", phrase: broken.match, note: noteFor(broken.rule, broken.match) });
      if (!isMovement(trimmed)) {
        beat = "";
        break;
      }
      beat = trimmed;
    }
    if (beat) surviving.push(beat);
  }

  const extra = surviving.slice(MAX_BEATS);
  for (const beat of extra) {
    dropped.push({
      kind: "extra",
      phrase: beat,
      note: `“${beat}” was left out: five seconds holds ${MAX_BEATS} small movements, not ${surviving.length}.`,
    });
  }

  /* Ordered by how much it matters that she knows, not by where it appeared in
     her sentence: a camera move is the one that costs her the likeness, so it
     is the line she reads first. Stable, so two of a kind keep her order. */
  const priority: DroppedKind[] = ["camera", "cut", "wardrobe", "expression", "text", "vague", "extra"];
  dropped.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));

  return { kept: sentence(surviving.slice(0, MAX_BEATS).join(", then ")), dropped };
}

/**
 * Cut anything the model echoed back of the rules, and everything after it.
 *
 * Seen live on 2026-09-22: asked to write a motion that obeys the rules, the
 * model wrote the motion and then wrote the rules out again, and the check
 * above let it through because the rules are phrased as prohibitions ("no
 * zoom", "no camera cuts") rather than as the things they forbid. What
 * `clipPrompt` appends would then have been the rules twice, the second copy
 * cut off mid-word. Nothing downstream should have to know that: the sentence
 * is cut where the echo starts.
 */
export function stripRules(text: string): string {
  const sentences = MOTION_RULES.split(/(?<=\.)\s+/).map((one) => one.trim().toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const one of sentences) {
    const at = lower.indexOf(one.slice(0, 28));
    if (at >= 0 && at < cut) cut = at;
  }
  return text.slice(0, cut).trim();
}

/** A beat list turned back into something a person would write. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const capitalised = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalised) ? capitalised : `${capitalised}.`;
}

/**
 * The one line the drawer shows above "Use this".
 *
 * Empty when nothing was dropped, which is the common case and deserves no
 * sentence at all: a notice that always appears is a notice nobody reads.
 */
export function droppedNote(dropped: readonly Dropped[]): string {
  return dropped.map((item) => item.note).join(" ");
}

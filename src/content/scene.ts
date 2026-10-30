import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateImage, imageModelId, type GeneratedImage, type InlineImage } from "../ai/gemini";
import { loadPack, referencesFor, type IdentityLock } from "../identity/build";
import { DEFAULT_IMAGE_ASPECT, DEFAULT_IMAGE_MODEL, type ImageAspect, type ImageModel } from "./image-options";
import type { ShotType } from "../style/house-style";
import { asksForSelfie, photoStyleOf } from "../style/photo-style";
import type { Verdict } from "../style/photo-prompt";

/* A scene is a new photo of the avatar. The user gives a rough idea; the house
   style writes the real prompt, the identity references carry her face, and a
   judge applies the accept/reject test before anything reaches the library. */

export type Take = { file: string; prompt: string; verdict: Verdict };
export type SceneResult = { kept: Take; rejected: Take[] };

/** A take before it is stored anywhere: the app puts it in Blob, the CLI writes a file. */
export type ImageTake = { image: GeneratedImage; prompt: string; verdict: Verdict };
/** `costUsd` is every take added up, including the rejected ones: the provider billed us for all of them. */
export type SceneTakes = { kept: ImageTake; rejected: ImageTake[]; costUsd: number; model: string };

/** A rejected take is redone once, so one scene can bill the provider twice. */
export const MAX_TAKES = 2;

/* How many photos of one person each model is documented to hold for character
   consistency (ai.google.dev/gemini-api/docs/image-generation, read 2026-10-03:
   four on Nano Banana 2, five on Pro). A photo past the limit is not a reference the
   model honours, so the set is cut here, after what she attached has taken its
   share, rather than sent and silently ignored. */
export const CHARACTER_REFS: Record<ImageModel, number> = { daily: 4, pro: 5 };

/** The references that go with one photo: the first of them, up to the model's limit less what she attached, and always the front one. */
export function trimReferences<T>(references: T[], model: ImageModel, sources: number): T[] {
  return references.slice(0, Math.max(1, CHARACTER_REFS[model] - sources));
}

/** How many references the judge is shown: the front, then the next two angles. */
export const JUDGE_REFS = 3;

/**
 * The sentence that binds the attached photos to the woman in the caption.
 *
 * Without it the model is handed some photos and a description and left to
 * work out that they are the same person. It drew a woman who matched the
 * words (age, build, hair, makeup) and only resembled the photos: "similar,
 * but not her". The words are for what changes between photos; her face is
 * the photos' to decide, and the prompt says so in as many words.
 */
export function referencedPrompt(prompt: string, references: number): string {
  const which = references === 1 ? "Image 1 is a reference photo" : `Images 1 to ${references} are reference photos`;
  return (
    `${prompt}\n\n${which} of the woman in this picture. She is that same person, at the same age: keep her face exactly as it is in those photos, ` +
    "the shape of her face and jaw, her eyes, brows, nose, lips, teeth, skin tone and any freckles or marks, so that someone who knows her would recognise her at once. " +
    "The caption above describes her hair, makeup, outfit, pose and the scene; where it disagrees with the photos about her face, the photos win."
  );
}

export function libraryDir(root: string, slug: string, kind: "images" | "clips" | "reels"): string {
  return join(root, "library", slug, kind);
}

/** Generation with no storage of its own: references and lock come from the
    caller, so an identity pack on disk and an avatar row work the same way. */
export async function generateSceneTakes(options: {
  references: InlineImage[];
  /**
   * Photos of her she attached to draw from, sent after the references. The
   * idea is then an instruction about them ("same outfit at a café").
   */
  sources?: InlineImage[];
  /**
   * Pictures to recreate ("make this one with her"): another person's photo,
   * sent last. Their composition, pose, light and softness are copied; the
   * person in them never is.
   */
  looks?: InlineImage[];
  /**
   * How a look is used. "match" writes a new photo that follows its shot.
   * "swap" edits the picture itself: its frame, light and blur are kept as
   * they are and only the person is replaced, so nothing is re-described.
   */
  lookMode?: LookMode;
  lock: IdentityLock;
  idea: string;
  shot?: ShotType;
  aspectRatio?: ImageAspect;
  /** Nano Banana 2 unless Pro was picked on purpose. */
  model?: ImageModel;
  label?: string;
  /** Total takes allowed, each one a paid image. A rejected take triggers a reworded retry. */
  maxTakes?: number;
}): Promise<SceneTakes> {
  if (options.references.length === 0) throw new Error("This avatar has no references yet. Finish avatar setup first.");

  /* Loaded here, not at the top: the prompt writer is server-only, and this
     module is also loaded by `src/jobs`, which the tests import. */
  const { judgePhoto, writePhotoPrompt } = await import("../style/photo-prompt");

  const sources = options.sources ?? [];
  const looks = options.looks ?? [];
  const model = options.model ?? DEFAULT_IMAGE_MODEL;
  const swap = options.lookMode === "swap" && looks.length > 0;
  /* A swap gets her front photo alone. With four, the model treated the picture as one reference among five and
     drew a scene from hers (2026-10-08); with one, it keeps the picture whole and puts her face in it. */
  const identity = swap ? options.references.slice(0, 1) : trimReferences(options.references, model, sources.length + looks.length);
  const takes: ImageTake[] = [];
  let fix: string[] | undefined;
  // A swap is one take: a reworded retry would re-describe the picture, which is what it exists to avoid.
  for (let attempt = 1; attempt <= (swap ? 1 : (options.maxTakes ?? MAX_TAKES)); attempt++) {
    const prompt = swap
      ? swapPrompt(options.idea, identity.length)
      : lookedPrompt(
          sourcedPrompt(referencedPrompt(await writePhotoPrompt({ idea: options.idea, shot: options.shot ?? "selfie", lock: options.lock, fix, looks }), identity.length), options.idea, identity.length, sources.length),
          options.idea,
          identity.length + sources.length,
          looks.length,
        );
    // The picture being edited comes first in a swap, so it is the base and her photos are what goes into it.
    const references = swap ? [...looks, ...identity] : [...identity, ...sources, ...looks];
    const aspectRatio = options.aspectRatio ?? DEFAULT_IMAGE_ASPECT;
    const image = await generateImage({
      prompt,
      references,
      model: imageModelId(model),
      aspectRatio,
      size: "2K",
      label: `${options.label ?? "scene"}:take${attempt}`,
    });
    const verdict = await judgePhoto(image, identity.slice(0, JUDGE_REFS), looks.length ? "editorial" : judgeStyleFor(options.lock, options.idea));
    takes.push({ image, prompt, verdict });
    if (verdict.keep) break;
    fix = verdict.problems;
  }

  // If every take was rejected the last one is still returned, flagged, so the user decides.
  const kept = takes.find((take) => take.verdict.keep) ?? takes[takes.length - 1];
  return {
    kept,
    rejected: takes.filter((take) => take !== kept),
    costUsd: takes.reduce((sum, take) => sum + take.image.costUsd, 0),
    model: kept.image.model,
  };
}

/** The style a photo is judged in: an editorial avatar's selfie is judged as the selfie she asked for. */
function judgeStyleFor(lock: IdentityLock, idea: string) {
  const style = photoStyleOf(lock);
  return style === "editorial" && asksForSelfie(idea) ? "everyday" : style;
}

/**
 * The prompt when she attached photos to draw from: the house prompt, then
 * which images are which and her instruction about them. Her face still comes
 * from the identity references, which come first.
 */
export function sourcedPrompt(prompt: string, instruction: string, references: number, sources: number): string {
  if (sources === 0) return prompt;
  const first = references + 1;
  const which = sources === 1 ? `Image ${first} is` : `Images ${first} to ${references + sources} are`;
  return `${prompt}\n\n${which} an earlier photo of the same woman, attached by her to work from. Follow this instruction about ${sources === 1 ? "it" : "them"}: ${instruction.trim()}. Keep what the instruction does not change (outfit, setting, framing) as it is there. Her face, body and skin come from the first ${references} images, never from anything else.`;
}

export type LookMode = "match" | "swap";

/**
 * The prompt for a swap: image 1 is the picture, images 2 on are her. Nothing
 * of the picture is described, so nothing of it can be re-imagined; only what
 * she changed is named.
 */
export function swapPrompt(instruction: string, references: number): string {
  const her = references === 1 ? "image 2" : `images 2 to ${references + 1}`;
  return (
    "Edit image 1. Keep it exactly as it is: the frame and crop, where the person sits in the frame, the pose, hands, head angle, gaze and expression, " +
    "the light and its direction, the set and background, how sharp or soft the focus is, the colour grade and grain. " +
    `Replace the person in image 1 with the woman in ${her}: keep her face exactly as it is in ${references === 1 ? "that photo" : "those photos"}, ` +
    "the shape of her face and jaw, her eyes, brows, nose, lips, teeth, skin tone and any freckles or marks, so that someone who knows her would recognise her at once. " +
    "Nothing of the original person's face, skin or age stays. Her hair colour and length also come from her photos unless the change below names them. " +
    `What to change from image 1, in her words: ${instruction.trim()}. Everything else stays as image 1 has it. No text or signs added.`
  );
}

/**
 * The sentence that binds a picture she wants recreated: copy the picture, not
 * the person. Her face stays with the identity references, which come first.
 */
export function lookedPrompt(prompt: string, instruction: string, before: number, looks: number): string {
  if (looks === 0) return prompt;
  const first = before + 1;
  const which = looks === 1 ? `Image ${first} is` : `Images ${first} to ${before + looks} are`;
  return (
    `${prompt}\n\n${which} a picture she wants recreated, of a different person. Recreate its picture, not its person: the camera distance and crop, ` +
    "where the subject sits in the frame and the space around her, the pose and hand placement, the head angle and gaze, the expression, " +
    "the furniture and the wall and floor colours, the light and its direction, how sharp or soft the focus is, the colour grade and grain. Do not copy that person: her face, skin, age, body, hair and styling come from the reference photos of her and her wardrobe. " +
    `Where her instruction says something different (hair, outfit), the instruction wins: ${instruction.trim()}.`
  );
}

/** The file-backed wrapper the CLI scripts still use against `data/`. */
export async function generateScene(options: {
  root: string;
  slug: string;
  idea: string;
  shot?: ShotType;
  aspectRatio?: ImageAspect;
  model?: ImageModel;
  maxTakes?: number;
}): Promise<SceneResult> {
  const pack = await loadPack(options.root, options.slug);
  if (!pack) throw new Error(`No identity pack for ${options.slug}`);
  if (!pack.lock) throw new Error("This avatar has no identity lock yet. Finish avatar setup first.");
  const references = await referencesFor(options.root, options.slug);

  const { kept, rejected } = await generateSceneTakes({ ...options, references, lock: pack.lock, label: `scene:${options.slug}` });

  const dir = libraryDir(options.root, options.slug, "images");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const write = async (take: ImageTake, attempt: number): Promise<Take> => {
    // A rejected take is kept out of the library folder listing by its name.
    const file = join(dir, `${take.verdict.keep ? "scene" : "rejected"}-${stamp}-take${attempt}.png`);
    await writeFile(file, take.image.data);
    await writeFile(
      file.replace(/\.png$/, ".json"),
      JSON.stringify(
        { idea: options.idea, shot: options.shot ?? "selfie", prompt: take.prompt, verdict: take.verdict, createdAt: new Date().toISOString() },
        null,
        2,
      ) + "\n",
    );
    return { file, prompt: take.prompt, verdict: take.verdict };
  };

  const rejectedFiles = await Promise.all(rejected.map((take, index) => write(take, index + 1)));
  return { kept: await write(kept, rejected.length + 1), rejected: rejectedFiles };
}

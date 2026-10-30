import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { generateImage, IMAGE_MODEL_PRO, toReference, type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import type { PhotoStyle } from "../style/photo-style";

/* An identity pack is what stands in for a trained character model: a fixed set
   of canonical views plus a written description, attached to every later
   generation. The front view is made first and anchors the other three. */

export const VIEWS = ["front", "three_quarter", "profile", "full_body"] as const;
export type View = (typeof VIEWS)[number];

export type Descriptor = {
  summary: string;
  hair: string;
  eyes: string;
  skin: string;
  faceShape: string;
  distinguishing: string[];
  apparentAgeRange: string;
  build: string;
};

/** The fixed description of one avatar, written into every photo prompt. It is
    agreed with the user during avatar setup and overrides anything a vision model
    guesses from the photos (a model will happily "see" freckles she must not have). */
export type IdentityLock = {
  subject: string;
  hair: string;
  skinMakeup: string;
  accessories: string;
  expressions: string;
  wardrobe: string[];
  scenes: string[];
  /** Words that push this particular face off-model, on top of the house list. */
  bannedWords: string[];
  /** How her photos are made. Absent is "everyday", what every avatar was before the choice existed. */
  photoStyle?: PhotoStyle;
};

/** An original photo kept as-is because it already covers a role well. */
export type CuratedPhoto = { role: View | "expression"; path: string };

export type IdentityPack = {
  slug: string;
  createdAt: string;
  sources: string[];
  descriptor: Descriptor;
  lock?: IdentityLock;
  /* Originals are preferred over generated views: every regeneration loses a
     little likeness, so views are generated only for angles no original covers. */
  curated: CuratedPhoto[];
  views: Partial<Record<View, { file: string; approved: boolean }>>;
};

const MAX_CHARACTER_REFS = 5; // Nano Banana Pro's documented character-reference limit

/* This preserves an existing look; it must not restyle her. An earlier version asked
   for "pores and fine lines" and "no makeup": it aged her a decade, cut her hair to
   the shoulders and thinned her lips. Texture is requested, ageing is ruled out. */
const STYLE =
  "Phone-camera realism, not a studio render: natural skin texture, no plastic smoothing, soft even daylight, " +
  "plain light-grey wall behind her. Plain white crew-neck t-shirt, no glasses, no hat. " +
  "This is the same woman as in the reference images, at the same age: do not age her, do not add wrinkles, " +
  "forehead lines or under-eye bags. Keep her exact facial structure, eye shape and colour, brows, nose, " +
  "lip fullness, skin tone and freckles. Keep her hair exactly as in the references: same colour, same length, " +
  "same wave, worn down. Keep the same soft everyday makeup she wears in the references.";

const VIEW_PROMPT: Record<View, string> = {
  front:
    "Head-and-shoulders portrait facing the camera straight on, neutral relaxed expression, mouth closed, eyes to camera.",
  three_quarter:
    "Head-and-shoulders portrait, head turned about 35 degrees to her left (three-quarter view), neutral expression, eyes following the head direction.",
  profile:
    "Head-and-shoulders portrait in full side profile, facing left, 90 degrees to the camera, neutral expression, ear and jawline visible.",
  full_body:
    "Full-body standing shot, head to toe fully in frame with space above and below, arms relaxed at her sides, " +
    "plain white t-shirt, straight-leg blue jeans and white trainers, facing the camera.",
};

const DESCRIPTOR_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    hair: { type: "string" },
    eyes: { type: "string" },
    skin: { type: "string" },
    faceShape: { type: "string" },
    distinguishing: { type: "array", items: { type: "string" } },
    apparentAgeRange: { type: "string" },
    build: { type: "string" },
  },
  required: ["summary", "hair", "eyes", "skin", "faceShape", "distinguishing", "apparentAgeRange", "build"],
};

export function packDir(root: string, slug: string): string {
  return join(root, "identity", slug);
}

export async function loadPack(root: string, slug: string): Promise<IdentityPack | null> {
  try {
    return JSON.parse(await readFile(join(packDir(root, slug), "pack.json"), "utf8")) as IdentityPack;
  } catch {
    return null;
  }
}

export async function approveView(root: string, slug: string, view: View): Promise<IdentityPack> {
  const pack = await loadPack(root, slug);
  if (!pack?.views[view]) throw new Error(`No ${view} view to approve for ${slug}`);
  pack.views[view]!.approved = true;
  await savePack(root, pack);
  return pack;
}

export async function setLock(root: string, slug: string, lock: IdentityLock): Promise<IdentityPack> {
  const pack = await loadPack(root, slug);
  if (!pack) throw new Error(`No identity pack for ${slug}`);
  pack.lock = lock;
  await savePack(root, pack);
  return pack;
}

export async function setCurated(root: string, slug: string, curated: CuratedPhoto[]): Promise<IdentityPack> {
  const pack = await loadPack(root, slug);
  if (!pack) throw new Error(`No identity pack for ${slug}`);
  pack.curated = curated;
  await savePack(root, pack);
  return pack;
}

/** The references every later generation attaches: curated originals first, then
    approved generated views, capped at the model's character-reference limit.
    Order matters: the first reference sets the overall look. With the bare-faced
    generated front leading, scenes lost her hair volume, makeup and lip fullness. */
export async function referencesFor(root: string, slug: string): Promise<InlineImage[]> {
  const pack = await loadPack(root, slug);
  if (!pack) throw new Error(`No identity pack for ${slug}`);
  const dir = packDir(root, slug);
  const approved = (view: View) => (pack.views[view]?.approved ? [join(dir, pack.views[view]!.file)] : []);
  const curatedRoles = new Set((pack.curated ?? []).map((photo) => photo.role));
  const paths = [
    ...(pack.curated ?? []).map((photo) => photo.path),
    // a generated view only earns a slot for an angle no original covers
    ...VIEWS.filter((view) => !curatedRoles.has(view)).flatMap(approved),
  ].slice(0, MAX_CHARACTER_REFS);
  if (paths.length === 0) throw new Error(`Identity pack ${slug} has no approved or curated references`);
  return Promise.all(paths.map((path) => toReference(path)));
}

async function savePack(root: string, pack: IdentityPack): Promise<void> {
  await mkdir(packDir(root, pack.slug), { recursive: true });
  await writeFile(join(packDir(root, pack.slug), "pack.json"), JSON.stringify(pack, null, 2) + "\n");
}

export async function describe(sources: InlineImage[]): Promise<Descriptor> {
  return generateText<Descriptor>({
    images: sources,
    schema: DESCRIPTOR_SCHEMA,
    system:
      "You write appearance notes for a fictional, AI-generated character so an image model can redraw her consistently. " +
      "Describe only what is visible. Do not guess ethnicity, nationality, name or identity.",
    prompt:
      "These images all show the same AI-generated character. Write compact, concrete appearance notes that stay true " +
      "across all of them. Ignore clothing, makeup intensity, location and pose. `summary` is one sentence usable inside " +
      "an image prompt. `distinguishing` lists up to five stable marks or traits (for example freckle placement, brow shape).",
  });
}

/** Builds the requested views. Front must exist before any other view. */
export async function buildViews(options: {
  root: string;
  slug: string;
  sourcePaths: string[];
  views: View[];
}): Promise<IdentityPack> {
  const sources = await Promise.all(options.sourcePaths.slice(0, MAX_CHARACTER_REFS).map((p) => toReference(p)));
  if (sources.length === 0) throw new Error("At least one source photo is required");

  const pack: IdentityPack =
    (await loadPack(options.root, options.slug)) ?? {
      slug: options.slug,
      createdAt: new Date().toISOString(),
      sources: options.sourcePaths,
      descriptor: await describe(sources),
      curated: [],
      views: {},
    };
  pack.curated ??= [];
  await savePack(options.root, pack);

  const ordered = [...options.views].sort((a, b) => VIEWS.indexOf(a) - VIEWS.indexOf(b));
  for (const view of ordered) {
    let references = sources;
    if (view !== "front") {
      const front = pack.views.front;
      if (!front) throw new Error("Build and approve the front view before the others");
      const anchor: InlineImage = {
        mimeType: "image/png",
        data: await readFile(join(packDir(options.root, options.slug), front.file)),
      };
      references = [anchor, ...sources].slice(0, MAX_CHARACTER_REFS);
    }

    // The reference views anchor every later photo, so they stay on Pro whatever the default becomes.
    const image = await generateImage({
      model: IMAGE_MODEL_PRO(),
      prompt:
        `${VIEW_PROMPT[view]} ${STYLE} Character notes: ${pack.descriptor.summary} ` +
        `Apparent age ${pack.descriptor.apparentAgeRange}. Hair: ${pack.descriptor.hair}`,
      references,
      aspectRatio: view === "full_body" ? "9:16" : "3:4",
      size: "2K",
      label: `identity:${options.slug}:${view}`,
    });

    const file = `${view}.png`;
    await writeFile(join(packDir(options.root, options.slug), file), image.data);
    pack.views[view] = { file, approved: false };
    await savePack(options.root, pack);
  }
  return pack;
}

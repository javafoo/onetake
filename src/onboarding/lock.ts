import { type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import type { IdentityLock } from "../identity/build";
import { matchWords } from "../style/match-words";
import type { PhotoStyle } from "../style/photo-style";

/** A model call, injected so the tests never touch the network. */
export type ModelCall = <T>(options: {
  prompt: string;
  system?: string;
  schema?: Record<string, unknown>;
  images?: InlineImage[];
}) => Promise<T>;

/* The first draft of an avatar's identity lock, read off her reference photos.
   The user edits it afterwards: this only has to be close enough that editing
   beats writing from scratch.

   Two hard rules. Only what is visible goes in, because a vision model will
   happily invent a detail and then it is written into every photo prompt
   forever. And no race, ethnicity or nationality word ever appears, which is
   checked in code rather than hoped for: the model is told, then the result is
   tested, then it is told again with the offending words named. */

const SCHEMA = {
  type: "object",
  properties: {
    subject: { type: "string" },
    hair: { type: "string" },
    skinMakeup: { type: "string" },
    accessories: { type: "string" },
    expressions: { type: "string" },
    wardrobe: { type: "array", items: { type: "string" } },
    scenes: { type: "array", items: { type: "string" } },
  },
  required: ["subject", "hair", "skinMakeup", "accessories", "expressions", "wardrobe", "scenes"],
};

const system = (words: readonly string[]) => `You write the fixed description of one AI-generated persona so that an image model can draw her the same way in every photo. The description is pasted into photo prompts, so it must be concrete, visual and short.

Rules:
- Describe only what is visible in the photographs. If you cannot see it, leave it out. Never guess a name, a job, a personality, a place of origin or an identity.
- Never name or imply a race, ethnicity, nationality, region or heritage. Not in any field, not as a comparison, not as an adjective. Describe hair, skin tone, eye colour and features directly instead.
- Never use these words: ${words.join(", ")}.
- Hair is described as styled. Skin and makeup are described softly and explicitly, the way a beauty writer would, never as flawless or poreless.
- Plain words, lower case, no marketing language, no emoji.`;

/* The two lines of the draft that depend on the style of her photos. A set
   shot on a styled shoot has no phone selfies or kitchen counters in it, so
   asking for "somewhere a phone photo happens" would write the wrong places and
   outfits into every picture that follows. */
const STYLE_LINES: Record<PhotoStyle, { expressions: string; scenes: string }> = {
  everyday: {
    expressions: "- `expressions`: three or four expressions she actually makes in these photos, and the overall attitude. She is a real person, not a model posing.",
    scenes: "- `scenes`: 6 to 9 everyday places these photos are taken, or places that fit them: a room, a car, a street, with the detail that makes it that place. Somewhere a phone photo happens, never a studio.",
  },
  editorial: {
    expressions: "- `expressions`: three or four expressions and poses she actually makes in these photos (calm, direct, a half smile), and the overall attitude.",
    scenes: "- `scenes`: 6 to 9 places or sets that fit these photos: a styled lounge, a plain wall with a lamp and a cushion, a director's chair on a pale floor, with the colours and materials that make each one. Simple and real. No readable text on any wall or prop.",
  },
};

const prompt = (style: PhotoStyle) => [
  "These photographs are all the same AI-generated persona. Write her identity lock.",
  "",
  "- `subject`: one short phrase for who is in frame: apparent age range and build only. Example shape: \"a young woman in her mid 20s, slender\".",
  "- `hair`: length, colour, cut and how it is styled, as one sentence.",
  "- `skinMakeup`: skin tone and finish, then the makeup she is actually wearing, item by item, softly. Nothing about her features: her face comes from her photos, so leave out its shape, her eyes, nose, lips and any marks.",
  "- `accessories`: the jewellery and small items she wears in these photos, each with its placement. Say \"none\" if she wears nothing.",
  STYLE_LINES[style].expressions,
  "- `wardrobe`: 6 to 9 specific garments she wears in these photos or would plainly wear: fabric, cut and colour. One garment per line.",
  STYLE_LINES[style].scenes,
].join("\n");

function textOf(lock: Omit<IdentityLock, "bannedWords">): string {
  return [lock.subject, lock.hair, lock.skinMakeup, lock.accessories, lock.expressions, ...lock.wardrobe, ...lock.scenes].join(
    " \n ",
  );
}

/** The house style's lists, loaded when needed: that module is server-only,
    and a test hands in its own words instead. */
async function houseWords(photoStyle: PhotoStyle): Promise<readonly string[]> {
  const style = await import("../style/house-style");
  return [...style.ETHNICITY_WORDS, ...style.bannedWordsFor(photoStyle)];
}

/** Drafts an identity lock from the avatar's reference photos. The per-avatar
    banned list starts empty: it is filled in later, from photos that went wrong. */
export async function draftLock(
  images: InlineImage[],
  deps: { model?: ModelCall; words?: readonly string[]; style?: PhotoStyle } = {},
): Promise<IdentityLock> {
  if (images.length === 0) throw new Error("draftLock needs at least one reference photo.");
  const model = deps.model ?? generateText;
  const style = deps.style ?? "everyday";
  const PROMPT = prompt(style);
  const words = deps.words ?? (await houseWords(style));
  const systemPrompt = system(words);

  let extra = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const draft = await model<Omit<IdentityLock, "bannedWords">>({
      images,
      schema: SCHEMA,
      system: systemPrompt,
      prompt: extra ? `${PROMPT}\n\n${extra}` : PROMPT,
    });

    const lock: IdentityLock = {
      subject: draft.subject.trim(),
      hair: draft.hair.trim(),
      skinMakeup: draft.skinMakeup.trim(),
      accessories: draft.accessories.trim(),
      expressions: draft.expressions.trim(),
      wardrobe: (draft.wardrobe ?? []).map((item) => item.trim()).filter(Boolean),
      scenes: (draft.scenes ?? []).map((item) => item.trim()).filter(Boolean),
      bannedWords: [],
      // Written only for the editorial style: an absent field is the everyday one, as it always was.
      ...(style === "everyday" ? {} : { photoStyle: style }),
    };

    const banned = matchWords(textOf(lock), words);
    if (banned.length === 0) return lock;
    if (attempt === 1) {
      throw new Error(`The drafted identity lock still uses words that are not allowed: ${banned.join(", ")}.`);
    }
    extra =
      `Your previous answer used these words, which are not allowed: ${banned.join(", ")}. ` +
      "Write it again without them. Describe the visible feature itself instead of naming a group, a film look or a camera.";
  }

  throw new Error("draftLock could not produce a usable identity lock.");
}

/** A lock drafted again from new reference photos, for an avatar that already
    has one. What the photos describe comes from the draft, including the style
    it was drafted in; the one thing that is not read off photos is kept: the
    words that pushed her off-model, learned from her past photos. */
export function rebuildLock(existing: IdentityLock | null, drafted: IdentityLock): IdentityLock {
  return { ...drafted, bannedWords: existing?.bannedWords ?? [] };
}

import "server-only";

import { type InlineImage } from "../ai/gemini";
import { generateText } from "../ai/text";
import type { IdentityLock } from "../identity/build";
import { CAPTION_ORDER, HARD_FAILURES, HOUSE, bannedWordsFor, findBanned, keepIfFor, lookFor, shotOpeningFor, styleOf, tasteNotesFor, type ShotType } from "./house-style";
import { asksForSelfie, photoStyleOf, type PhotoStyle } from "./photo-style";

/* Step one of every image: turn a rough idea into a finished caption-style
   prompt in the house style, carrying this avatar's identity lock verbatim. */

function system(lock: IdentityLock, selfie = false, looks = false): string {
  const style = photoStyleOf(lock);
  return `You write image-generation prompts for photos of one recurring character. Each prompt is a rich caption of the finished photo, written as flowing sentences, never as a list of rules or keywords.

THE LOOK (understand it, never quote it):
${lookFor(style)}

CAPTION ORDER (keep it):
${CAPTION_ORDER.map((item, index) => `${index + 1}. ${item}`).join("\n")}

THE CHARACTER (use these descriptions closely; they do not change between photos):
- Subject: ${lock.subject}
- Hair: ${lock.hair}
- Skin and makeup: ${lock.skinMakeup}
- Accessories: ${lock.accessories}
- Expressions she makes: ${lock.expressions}
- Her wardrobe: ${lock.wardrobe.join("; ")}

RULES:
${styleOf(style).rules.map((rule) => `- ${rule}`).join("\n")}
${looks ? HOUSE.lookRule : selfie ? HOUSE.selfieRule : styleOf(style).styleRule}- Never name a race, ethnicity or nationality. Never write photography buzzwords or quality tags.
- Never write any of these words: ${findBannedList(lock)}.
- 110 to 190 words. End with exactly: No text or signs in frame.`;
}

const findBannedList = (lock: IdentityLock) => [...bannedWordsFor(photoStyleOf(lock)), ...lock.bannedWords].join(", ");

export async function writePhotoPrompt(options: {
  idea: string;
  shot: ShotType;
  lock: IdentityLock;
  /** Problems a judge found in the previous take: change the words, not the seed. */
  fix?: string[];
  /** Pictures she attached to recreate; the writer sees them, so it describes them rather than guessing from her words. */
  looks?: InlineImage[];
}): Promise<string> {
  const style = photoStyleOf(options.lock);
  const looks = options.looks ?? [];
  // An editorial avatar still gets a real selfie when the idea asks for one.
  const selfie = style === "editorial" && asksForSelfie(options.idea);
  const openingStyle = selfie ? "everyday" : style;
  const ask = (extra = "") =>
    generateText({
      system: system(options.lock, selfie, looks.length > 0),
      ...(looks.length ? { images: looks } : {}),
      prompt:
        `Scene idea: ${options.idea.trim()}\n` +
        (looks.length
          ? `Begin the prompt with "A photo of ${options.lock.subject}", then describe the attached reference picture's shot with her in it.\n`
          : `Shot type: begin the prompt with "${shotOpeningFor(openingStyle, options.shot)} ${options.lock.subject}".\n`) +
        (options.shot === "wide_selfie" && !looks.length ? `${styleOf(openingStyle).wideSelfie}\n` : "") +
        (options.fix?.length
          ? `The last photo from this idea was rejected because: ${options.fix.join("; ")}. Reword the prompt so the next take avoids that.\n`
          : "") +
        extra +
        "Reply with the prompt only.",
    });

  let prompt = (await ask()).trim();
  let hits = findBanned(prompt, options.lock.bannedWords, style);
  if (hits.length) {
    prompt = (await ask(`Your previous draft used banned words (${hits.join(", ")}). Write it again without them.\n`)).trim();
    hits = findBanned(prompt, options.lock.bannedWords, style);
  }
  if (hits.length) throw new Error(`Prompt writer kept using banned words: ${hits.join(", ")}`);
  return prompt;
}

export type Verdict = { keep: boolean; problems: string[]; notes: string[] };

/** The five-second test, applied before the user sees the photo. The references
    come first, the front one leading; the candidate is the last image. */
export async function judgePhoto(candidate: InlineImage, references: InlineImage[], style: PhotoStyle = "everyday"): Promise<Verdict> {
  if (references.length === 0) throw new Error("judgePhoto needs at least one reference photo.");
  const which = references.length === 1 ? "Image 1 is a reference photo" : `Images 1 to ${references.length} are reference photos`;
  const verdict = await generateText<Verdict>({
    images: [...references, candidate],
    schema: {
      type: "object",
      properties: {
        keep: { type: "boolean" },
        problems: { type: "array", items: { type: "string" } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["keep", "problems", "notes"],
    },
    system:
      "You check generated photos of a fictional, AI-generated character before they are shown to her creator. " +
      `${which} of the character. The last image is the candidate. Judge only what is visible and be brief.`,
    prompt:
      `A candidate passes if ${keepIfFor(style)}.\n` +
      `HARD FAILURES. Set keep=false only if one of these is unmistakable, and list it in \`problems\`:\n${HARD_FAILURES.map((rule) => `- ${rule}`).join("\n")}\n` +
      `TASTE NOTES. These never fail a photo. If one applies, add a short remark to \`notes\`:\n${tasteNotesFor(style).map((rule) => `- ${rule}`).join("\n")}\n` +
      HOUSE.judge,
  });
  return { keep: verdict.keep, problems: verdict.problems ?? [], notes: verdict.notes ?? [] };
}

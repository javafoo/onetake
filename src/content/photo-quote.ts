import { generateText } from "../ai/text";

import { brandOff } from "./brand-scope";
import type { BrandProfile } from "./hooks";
import { withLanguage } from "./languages";

/* Words for her own photo, written when she says what they should be rather
 * than giving them: "a trending, relatable, slightly unhinged life quote".
 *
 * Not the hook writer. A hook is pulled toward her niche and opens a reel;
 * this is the line she asked for, on the subject she asked for, in her voice.
 * The rules that keep every writer honest still hold: no personal history the
 * story does not give, no numbers, nothing that pretends to be someone else's
 * words. One model call, one line back. */

const SYSTEM = `You write the words that go on one photo a creator posts on Instagram: a single line of text over her own picture.

Write exactly what she asked for, on the subject she asked for, in her voice. It is not an ad and not about her business, content creation, posting, filming or money unless she asked for that: with no subject named, it is about everyday life.

Rules:
- One line, 6 to 18 words. It is read in two seconds over a photo.
- Plain words, the way people caption their own photos. No hashtags, no emoji, no quotation marks around it.
- Relatable beats clever. A specific, true-to-life detail beats a generic platitude.
- Match the tone she names, fully: "unhinged" is funny, a little chaotic and self-aware, the thing people say to their friends; "soft" is gentle; "savage" is blunt. Not a motivational poster unless she asked for one.
- Never invent personal history: nothing about what happened to her, how long anything took, or who she knows. General truths and observations are fine.
- No numbers.
- Never attribute it to anyone or copy a known quote; it is her own line.`;

/** The writer's rules, in her language when it is not English. */
export function photoWordsSystem(profile: Pick<BrandProfile, "language">): string {
  return withLanguage(SYSTEM, profile.language, "the line");
}

/** The line as it goes on the photo: one line, no wrapping quotes, no trailing hashtags. */
export function tidyPhotoWords(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/(\s#\S+)+$/, "")
    .trim();
}

/**
 * What the line's writer is told about her. With the brand off, nothing: no
 * voice notes, no story. The house knowledge (`referenceBlock`) is craft, not
 * brand, so it comes after either, and only when there is some.
 */
export function photoWordsPrompt(profile: BrandProfile, brief: string, knowledge?: string): string {
  const about = brandOff(profile)
    ? ["Written without her brand: no voice notes and no story. Write no personal history at all."]
    : [
        // Her voice, not her audience: the audience pulls every line back to her niche, which a life quote is not about.
        `Her voice: ${profile.voice}`,
        profile.story?.trim() ? `Her story (the only personal history that exists): ${profile.story.trim().slice(0, 800)}` : "She has no story on file: write no personal history at all.",
      ];
  const reference = knowledge?.trim();
  return [`What she asked for: ${brief.trim().slice(0, 400)}`, ...about, ...(reference ? ["", reference] : [])].join("\n");
}

export async function writePhotoWords(profile: BrandProfile, brief: string, model: typeof generateText = generateText, knowledge?: string): Promise<string> {
  const answer = await model<{ words: string }>({
    system: photoWordsSystem(profile),
    schema: { type: "object", properties: { words: { type: "string" } }, required: ["words"] },
    thinking: "low",
    prompt: photoWordsPrompt(profile, brief, knowledge),
  });
  const words = tidyPhotoWords(answer?.words ?? "");
  if (!words) throw new Error("The words could not be written. Try again, or type your own in quotes.");
  return words;
}

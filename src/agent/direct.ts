import { generateText } from "@/ai/text";
import type { PostIdea } from "@/content/hooks";
import { readTheCaption, startsWithComment, withLanguage, widenLimit } from "@/content/languages";
import { countWords } from "@/reel/timing";

import type { AgentRequest, Direction } from "./plan";

/* After the post is written, the director makes the two production calls a
   person would make: is there footage in the library that already shows this
   scene (which saves a paid photo and a paid clip), and does this hook want a
   second line pointing the viewer to the caption, or does it land on its own. */

export const MAX_CUE_WORDS = 5;

/** A clip she already has, described in the words a scene idea uses. */
export type DescribedClip = { mediaId: string; description: string };

const SCHEMA = {
  type: "object",
  properties: {
    cueText: { type: "string" },
    cueWhy: { type: "string" },
    clipId: { type: "string" },
    clipWhy: { type: "string" },
  },
  required: ["cueText", "cueWhy", "clipId", "clipWhy"],
};

const SYSTEM = `You direct short Instagram reels for one creator's AI avatar. The reel is 3 to 12 seconds: the hook is on screen the whole time, over a clip of her. The value is in the caption under the video.

Two decisions.

1. THE SECOND LINE. A short line (at most ${MAX_CUE_WORDS} words) that pops in under the hook once it has been read and stays until the end. Its only job is to send the viewer to the caption or the comments.
- Add one when the hook makes a promise the caption keeps: it asks how, what, why, or hints at steps, a list, a mistake, a number, a story with an ending. Then the viewer needs to know the answer is under the video. Write it plainly: "Read the caption", "How? Read the caption", "Steps in the caption", "The list is in the caption", "Comment KEYWORD for it".
- Skip it when the hook is a complete thought that lands on its own (a confession, an observation about the reader, a bold statement with no open loop), when the hook already says "caption" or names the keyword, or when a second line would feel like a sales push over an honest moment.
- The creator's wish overrides you: "yes" means add one, "no" means none.
Set cueText to the line, or "" for none. Set cueWhy to one short plain sentence a creator would understand, whichever way you decided.

2. THE FOOTAGE. The library lists clips the creator already has, each with a one-line description. Pick one only if it shows the same place AND the same kind of activity or prop as the visual brief (a car with an iced coffee matches "in the driver's seat with an iced latte"; a bedroom mirror with a laptop does not match "at a cafe table"). The clip must not contradict the hook (no makeup scene under a "no makeup" hook). If the creator asked for new footage, if this is a talking reel, or if nothing fits, set clipId to "". Set clipWhy to one short sentence.`;

export type DirectInput = {
  post: PostIdea;
  keyword: string;
  request: Extract<AgentRequest, { kind: "reel" }>;
  library: DescribedClip[];
  /** Her content language: the second line is read by viewers, so it is written in it. Absent is English. */
  language?: string;
};

/** The director's rules. The second line is read by viewers, so it is written in her language; the reasons are for her, in English. */
export function directSystem(language?: string): string {
  return withLanguage(SYSTEM, language, "cueText");
}

/** The director's brief, as a plain string so it can be tested. No keyword (the brand is off): no "Comment" line is offered. */
export function directPrompt(input: DirectInput): string {
  const { post, request } = input;
  const keyword = input.keyword.trim();
  return [
      `HOOK (on screen): ${post.hook}`,
      post.spoken ? `WHAT SHE SAYS (talking reel): ${post.spoken}` : "",
      `CAPTION:\n${post.caption}\n${post.cta}`,
      keyword ? `Comment keyword: ${keyword}` : 'This reel has no comment keyword: never write a "Comment" line. "Read the caption" and the like are fine.',
      `Visual brief for a new clip: ${post.visual ? `${post.visual.scene}. Motion: ${post.visual.motion}` : "(none)"}`,
      `Creator's wish for the second line: ${request.cue}`,
      `Creator's wish for footage: ${request.talking ? "a talking reel, so a new clip is always made" : request.footage === "new" ? "new footage, do not reuse a clip" : "reuse a clip if one fits"}`,
      `LIBRARY (id: description)\n${input.library.map((clip) => `${clip.mediaId}: ${clip.description}`).join("\n") || "(empty)"}`,
    ]
      .filter(Boolean)
      .join("\n\n");
}

export async function direct(input: DirectInput): Promise<Direction> {
  const { request } = input;
  const result = await generateText<{ cueText: string; cueWhy: string; clipId: string; clipWhy: string }>({
    system: directSystem(input.language),
    schema: SCHEMA,
    thinking: "low",
    prompt: directPrompt(input),
  });

  return {
    ...decideCue(result.cueText, result.cueWhy, request.cue, input.keyword, input.language),
    clip: request.talking ? null : chooseClip(result.clipId, result.clipWhy, request.footage, input.library),
  };
}

/**
 * The creator's wish wins over the model, and a cue is always short and plain.
 * With no keyword (a run with the brand off) a "Comment …" cue is not
 * offered: there is nothing to comment for.
 */
export function decideCue(text: string, why: string, wish: "auto" | "yes" | "no", keyword?: string, language?: string): Pick<Direction, "cue" | "noCueWhy"> {
  const said = text.trim().replace(/^["'“”]+|["'“”.]+$/g, "").replace(/\s+/g, " ");
  const dropped = keyword !== undefined && !keyword.trim() && startsWithComment(said, language);
  const cleaned = dropped ? "" : said;
  const reason = dropped ? "Written without your brand, so there is no keyword to comment." : why.trim() || null;
  if (wish === "no") return { cue: null, noCueWhy: "You asked for no second line." };
  if (!cleaned) {
    return wish === "yes"
      ? { cue: { text: readTheCaption(language), why: "You asked for a second line." }, noCueWhy: null }
      : { cue: null, noCueWhy: reason ?? "The hook lands on its own." };
  }
  const most = widenLimit(MAX_CUE_WORDS, language);
  const short = countWords(cleaned) > most ? cleaned.split(/\s+/).slice(0, most).join(" ") : cleaned;
  return { cue: { text: short, why: reason ?? "It sends the viewer to the caption." }, noCueWhy: null };
}

/** Only a clip that is really in the library can be chosen. */
export function chooseClip(id: string, why: string, footage: "auto" | "new", library: DescribedClip[]): Direction["clip"] {
  if (footage === "new") return null;
  const chosen = library.find((clip) => clip.mediaId === id.trim());
  return chosen ? { mediaId: chosen.mediaId, why: why.trim() || "It already shows this scene." } : null;
}

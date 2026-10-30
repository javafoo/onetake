import "server-only";

import { type InlineImage } from "@/ai/gemini";
import { generateText } from "@/ai/text";

import { ROLE_ORDER, type RoleProposal } from "./roles";

/* The curation pass: one vision call that looks at the photos she uploaded and
   says which one plays which part. Free (text and vision only), and advisory —
   src/app/onboarding/roles.ts decides what is stored and she can overrule all
   of it by tapping. The model is told to describe what it can see and nothing
   else, because a guess about who is in the photo would end up written into
   every prompt for the rest of the account's life. */

const SCHEMA = {
  type: "object",
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          role: { type: "string", enum: [...ROLE_ORDER, "none"] },
          confidence: { type: "number" },
          note: { type: "string" },
        },
        required: ["index", "role", "confidence", "note"],
      },
    },
  },
  required: ["photos"],
};

const SYSTEM =
  "You sort reference photographs of one person into camera angles so an image model can be given the right " +
  "picture for the right job. Judge only what you can see: how the head is turned, how much of the body is in " +
  "frame, how sharp the face is, what the expression is doing. Never guess who the person is, where they are " +
  "from, or anything about their life. Plain words, lower case, no marketing language.";

const PROMPT = [
  "These photographs are all the same person, numbered from 0 in the order they are given.",
  "For each photograph, pick the one part it plays best:",
  "- front: face square to the camera, both eyes visible, head not turned.",
  "- three_quarter: head turned part way, roughly 30 to 60 degrees.",
  "- profile: head turned all the way to the side.",
  "- full_body: the whole person, head to feet, in frame.",
  "- expression: a clear feeling on the face, laughing, talking, mid-sentence.",
  "- none: blurred, cropped past the chin, the face not visible, or a second person in frame.",
  "",
  "Rules:",
  "- Every photograph gets exactly one entry, with its own `index`.",
  "- `confidence` is 0 to 1: how well this photograph plays that part, not how sure you are of the person.",
  "- A full-body photograph is `full_body` even when the face is also square to the camera.",
  "- `note` is at most eight words, describing the photograph so she can tell them apart in a list, for example \"looking straight at camera, soft light\".",
].join("\n");

type ModelPhoto = { index: number; role: string; confidence: number; note: string };

/** Proposes a role for each photo, in the order the photos were given. */
export async function proposeRoles(
  photos: { mediaId: string; image: InlineImage }[],
  deps: { model?: typeof generateText } = {},
): Promise<RoleProposal[]> {
  if (photos.length === 0) return [];
  const model = deps.model ?? generateText;
  const result = await model<{ photos?: ModelPhoto[] }>({
    system: SYSTEM,
    schema: SCHEMA,
    prompt: PROMPT,
    images: photos.map((photo) => photo.image),
  });

  return (result.photos ?? []).flatMap((item) => {
    const photo = photos[item.index];
    if (!photo) return [];
    return [
      {
        mediaId: photo.mediaId,
        role: item.role === "none" ? null : (item.role as RoleProposal["role"]),
        confidence: Number(item.confidence),
        note: item.note ?? "",
      },
    ];
  });
}

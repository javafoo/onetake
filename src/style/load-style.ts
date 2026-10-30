import type { ShotType } from "./shot-types";

/* The photo style the prompt writer and the judge follow. The repository ships
   the plain style below. A deployment can supply its own as JSON in the
   HOUSE_STYLE environment variable (plain or base64, which survives env-file
   quoting), so a tuned style never has to be published with the code. */

export type StyleLook = {
  look: string;
  keepIf: string;
  tasteNotes: string[];
  shotOpening: Record<ShotType, string>;
  /** The writer's style-specific rules, one bullet each. */
  rules: string[];
  /** Extra rule lines, already formatted as bullets ending in a newline. */
  styleRule: string;
  wideSelfie: string;
  bannedWords: string[];
};

export type HouseStyle = {
  everyday: StyleLook;
  editorial: StyleLook;
  captionOrder: string[];
  hardFailures: string[];
  selfieRule: string;
  lookRule: string;
  judge: string;
};

const SHARED_RULES = [
  "Follow the scene the user asks for. If they leave the outfit open, choose one from her wardrobe.",
  "Her face is never described: it comes from her reference photos. Describe skin tone and makeup, not features.",
];

const SHARED_BANNED = ["photorealistic", "hyperrealistic", "8k", "4k", "masterpiece", "render"];

export const PLAIN_STYLE: HouseStyle = {
  everyday: {
    look: `A natural photo of a real person, taken on a phone.
- Light: natural daylight.
- Framing: casual, eye level.
- No readable text, signs or labels.`,
    keepIf: "it looks like a real, natural photo",
    tasteNotes: ["the light looks artificial", "the pose looks stiff"],
    shotOpening: {
      selfie: "A smartphone selfie of",
      wide_selfie: "A wide-angle smartphone selfie of",
      mirror: "A mirror selfie of",
      friend: "A candid phone photo of",
    },
    rules: [...SHARED_RULES, "Name the light source. Natural daylight only.", "End with a short list of the colours in the scene."],
    styleRule: "",
    wideSelfie: "Include that the frame is wide and shows the room around her.",
    bannedWords: [...SHARED_BANNED, "studio", "editorial"],
  },
  editorial: {
    look: `A professional photograph from a styled shoot.
- Light: soft and directional, never flash.
- Composition: planned, with clean space around her.
- No readable text, signs or labels.`,
    keepIf: "it looks like a polished professional photo of a real person",
    tasteNotes: ["the light is flat", "the pose is stiff"],
    shotOpening: {
      selfie: "A professional photograph of",
      wide_selfie: "A full-length professional photograph of",
      mirror: "A professional photograph with a mirror in the set of",
      friend: "A candid behind-the-scenes photograph of",
    },
    rules: [...SHARED_RULES, "Name the light source. Soft window light or a diffused key light.", "End with a short list of the colours in the scene."],
    styleRule: "",
    wideSelfie: "Include that the frame is wide: she is full-length with the set around her.",
    bannedWords: [...SHARED_BANNED],
  },
  captionOrder: ["shot type and subject", "hair", "outfit", "skin tone and makeup", "pose and expression", "setting", "light", "colours", "mood", 'the closing sentence "No text or signs in frame."'],
  hardFailures: [
    "letters, signs, labels or logos are clearly readable in the frame",
    "hands, fingers or limbs are malformed, duplicated or missing",
    "she is clearly not the woman in the reference photos",
  ],
  selfieRule: "- The scene idea asks for a selfie: write a real smartphone selfie.\n",
  lookRule: "- A reference picture of a different person is attached. Describe its shot, pose and light with her as the subject. Never describe the other person's face.\n",
  judge: "When unsure, keep the photo.",
};

const isText = (value: unknown): value is string => typeof value === "string";
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

function isLook(value: unknown): value is StyleLook {
  if (!value || typeof value !== "object") return false;
  const look = value as Record<string, unknown>;
  const openings = look.shotOpening as Record<string, unknown> | undefined;
  return (
    isText(look.look) && isText(look.keepIf) && isTextList(look.tasteNotes) && isTextList(look.rules) &&
    isText(look.styleRule) && isText(look.wideSelfie) && isTextList(look.bannedWords) &&
    !!openings && ["selfie", "wide_selfie", "mirror", "friend"].every((shot) => isText(openings[shot]))
  );
}

/** The style in `raw` (HOUSE_STYLE, JSON or base64 JSON), or the plain style if it is missing or malformed. */
export function parseHouseStyle(raw: string | undefined): HouseStyle {
  if (!raw?.trim()) return PLAIN_STYLE;
  try {
    const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw.trim(), "base64").toString("utf8");
    const style = JSON.parse(text) as Record<string, unknown>;
    if (
      isLook(style.everyday) && isLook(style.editorial) && isTextList(style.captionOrder) && isTextList(style.hardFailures) &&
      isText(style.selfieRule) && isText(style.lookRule) && isText(style.judge)
    ) {
      return style as HouseStyle;
    }
  } catch {
    // Fall through: a broken value must not stop photos being made.
  }
  console.warn("HOUSE_STYLE is not a valid style; using the plain style.");
  return PLAIN_STYLE;
}

/* A style kit is data, not a code path. It names the fonts, the palette and the
   handful of numbers the renderer needs, so a new customer look is a new record
   here instead of a new branch in render.ts. Every kit must render every slide
   type; nothing in a kit is optional at render time. */

export type PaletteKey = "paper" | "panel" | "ink" | "accent" | "muted" | "contrast";
export type Palette = Record<PaletteKey, string>;

/** How an *emphasised* word is set apart from the rest of its line. */
export type EmphasisRule = "italic" | "highlight" | "underline" | "color";

export type FontSpec = {
  /** File name inside assets/fonts. */
  file: string;
  /** Family alias the renderer registers the file under. Unique per file. */
  family: string;
  /** Variable-font weight, applied through ctx.fontVariationSettings. Static faces ignore it. */
  weight: number;
  /** Variable-font slant in degrees (negative leans right), for a face with a "slnt" axis and no italic file. */
  slant?: number;
  /** Letter spacing as a fraction of the font size. Negative tightens. */
  tracking: number;
};

export type StyleKit = {
  id: string;
  /** Shown to the customer when they pick a look. */
  name: string;
  /** One line a human can use to tell the kits apart. */
  character: string;
  /** A private kit is never offered to anyone but its owner. */
  private?: boolean;
  /** Kept so rows made before the five looks still render; never offered in the picker. */
  internal?: boolean;
  /** Profile slug allowed to use a private kit. */
  owner?: string;
  palette: Palette;
  fonts: { title: FontSpec; emphasis: FontSpec; accent: FontSpec; body: FontSpec };
  /** Title lines are upper-cased before measuring. */
  titleUppercase: boolean;
  margins: {
    /** Side margin on paper and keyword slides. */
    side: number;
    /** Side margin on photo slides; usually tighter, the photo already frames the text. */
    photoSide: number;
    top: number;
    bottom: number;
  };
  /** The shared size every caps line in one title uses, before it shrinks to fit. */
  titleSize: { min: number; max: number };
  /** Accent line size as a multiple of the caps size. */
  accentScale: number;
  /** Space between caps lines, and before an accent line, as a fraction of the caps size. */
  lineGap: number;
  accentGap: number;
  emphasis: EmphasisRule;
  /** An emphasised word's size as a multiple of the line's, for a face that reads small beside the rest. Default 1. */
  emphasisScale?: number;
  /** Palette key for emphasised words, or "same" to keep the line colour. */
  emphasisColor: PaletteKey | "same";
  paper: {
    background: PaletteKey;
    /** Alternate background, used on every other paper slide for rhythm. */
    alternate: PaletteKey;
    titleColor: PaletteKey;
    accentColor: PaletteKey;
    bodyColor: PaletteKey;
    bodySize: number;
    /** Hairline above the closing sentence. */
    rule: boolean;
    /** Small slide number in the accent colour. */
    index: boolean;
    /** 0 = flat, 1 = visible paper noise. */
    grain: number;
  };
  photo: {
    /** Flat darkening over the whole photo, 0-1. */
    dim: number;
    /** Extra gradient behind the text band so the title stays readable. */
    scrim: number;
    titleColor: PaletteKey;
    accentColor: PaletteKey;
    subColor: PaletteKey;
    subSize: number;
    /** Every line of text sits in its own rounded box of this colour, the photo left as it is. Null: type straight on the photo. */
    boxes: PaletteKey | null;
    /** The accent line is drawn after the sub, as a payoff, rather than under the title. */
    accentAfterSub: boolean;
  };
  /** An emphasised word keeps the case it was written in, even in a caps title: an italic serif shouts badly. */
  emphasisKeepsCase?: boolean;
  keyword: {
    background: PaletteKey;
    /** The word itself. */
    color: PaletteKey;
    /** The small "comment" label above it. */
    labelColor: PaletteKey;
    promiseColor: PaletteKey;
    promiseSize: number;
    /** Draw the keyword inside a block of the accent colour. */
    block: boolean;
  };
  brandSize: number;
};

const INTER: Omit<FontSpec, "weight" | "tracking"> = { file: "Inter-Variable.ttf", family: "KitInter" };

const ARCHIVO = { file: "ArchivoBlack-Regular.ttf", family: "KitArchivo" };
const INSTRUMENT = { file: "InstrumentSerif-Regular.ttf", family: "KitInstrument" };
const INSTRUMENT_ITALIC = { file: "InstrumentSerif-Italic.ttf", family: "KitInstrumentItalic" };
const PLAYFAIR_ITALIC = { file: "PlayfairDisplay-Italic-Variable.ttf", family: "KitPlayfairItalic" };
const CAVEAT = { file: "Caveat-Variable.ttf", family: "KitCaveat" };
/* TikTok Sans (Open Font License) at semibold is the sans for every on-image
   look. Its "slnt" axis stands in for an italic file. */
const TIKTOK = { file: "TikTokSans-Variable.ttf", family: "KitTikTokSans" };
const TIKTOK_WEIGHT = 600;
const TIKTOK_SLANT = -6;
const GARAMOND = { file: "EBGaramond-Variable.ttf", family: "KitGaramond" };
/* The veil the open looks lay over a photo: the reel assembler's quarter-strength black, so a carousel and a reel in the same look match. */
const VEIL = 0.25;

/* --- the three house kits ----------------------------------------------- */

/** Loud modern sans. Reads like a studio that sells software. */
const signal: StyleKit = {
  id: "signal",
  name: "Signal",
  character: "Loud black sans on bone, one electric accent. Confident, modern, a little startup.",
  internal: true,
  palette: {
    paper: "#F1EEE8",
    panel: "#E3DED4",
    ink: "#141312",
    accent: "#F0451B",
    muted: "#8B857B",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...ARCHIVO, weight: 400, tracking: -0.022 },
    emphasis: { ...ARCHIVO, weight: 400, tracking: -0.022 },
    accent: { ...INTER, weight: 250, tracking: -0.01 },
    body: { ...INTER, weight: 480, tracking: -0.004 },
  },
  titleUppercase: true,
  margins: { side: 104, photoSide: 92, top: 108, bottom: 108 },
  titleSize: { min: 54, max: 126 },
  accentScale: 0.94,
  lineGap: 0.14,
  accentGap: 0.3,
  emphasis: "highlight",
  emphasisColor: "contrast",
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 40,
    rule: true,
    index: true,
    grain: 0.16,
  },
  photo: { dim: 0.34, scrim: 0.62, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 34, boxes: null, accentAfterSub: false },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: true,
  },
  brandSize: 22,
};

/** Quiet serif editorial. Reads like a fashion or interiors magazine. */
const atelier: StyleKit = {
  id: "atelier",
  name: "Atelier",
  character: "Serif caps on bone paper with a burgundy italic. Quiet, editorial, expensive.",
  internal: true,
  palette: {
    paper: "#EDE6DA",
    panel: "#E0D6C6",
    ink: "#24201C",
    accent: "#6E2434",
    muted: "#93887A",
    contrast: "#FBF8F2",
  },
  fonts: {
    title: { ...INSTRUMENT, weight: 400, tracking: 0.012 },
    emphasis: { ...PLAYFAIR_ITALIC, weight: 500, tracking: 0.004 },
    accent: { ...PLAYFAIR_ITALIC, weight: 420, tracking: -0.004 },
    body: { ...INTER, weight: 400, tracking: 0 },
  },
  titleUppercase: true,
  margins: { side: 128, photoSide: 112, top: 130, bottom: 120 },
  titleSize: { min: 58, max: 142 },
  accentScale: 0.92,
  lineGap: 0.1,
  accentGap: 0.26,
  emphasis: "italic",
  emphasisColor: "accent",
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 36,
    rule: true,
    index: false,
    grain: 0.24,
  },
  photo: { dim: 0.38, scrim: 0.6, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 30, boxes: null, accentAfterSub: false },
  keyword: {
    background: "accent",
    color: "contrast",
    labelColor: "contrast",
    promiseColor: "contrast",
    promiseSize: 32,
    block: false,
  },
  brandSize: 21,
};

/** Clean sans with a handwritten aside. Reads like a friend's notebook. */
const notebook: StyleKit = {
  id: "notebook",
  name: "Notebook",
  character: "Tight Inter caps on warm white, green handwriting for the payoff line. Friendly, close, practical.",
  internal: true,
  palette: {
    paper: "#FBF8F1",
    panel: "#EDF0E7",
    ink: "#1C231F",
    accent: "#2E6A54",
    muted: "#8D948B",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...INTER, weight: 830, tracking: -0.036 },
    emphasis: { ...INTER, weight: 830, tracking: -0.036 },
    accent: { ...CAVEAT, weight: 640, tracking: -0.005 },
    body: { ...INTER, weight: 450, tracking: -0.003 },
  },
  titleUppercase: false,
  margins: { side: 112, photoSide: 96, top: 116, bottom: 112 },
  titleSize: { min: 52, max: 122 },
  accentScale: 1.42,
  lineGap: 0.16,
  accentGap: 0.22,
  emphasis: "underline",
  emphasisColor: "accent",
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 38,
    rule: false,
    index: true,
    grain: 0.08,
  },
  photo: { dim: 0.36, scrim: 0.64, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 31, boxes: null, accentAfterSub: false },
  keyword: {
    background: "panel",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "ink",
    promiseSize: 34,
    block: true,
  },
  brandSize: 22,
};

/** The everyday look: bold sans in white rounded boxes over an untouched
    photo, the way most creators caption a selfie. Founder's ask, 2026-09-23. */
const boxed: StyleKit = {
  id: "boxed",
  name: "Bold box",
  character: "Black sans in white rounded boxes over the photo as it is. Direct, familiar, the everyday Instagram caption look.",
  palette: {
    paper: "#FFFFFF",
    panel: "#F2F0EC",
    ink: "#111111",
    accent: "#1E6FE8",
    muted: "#7B7873",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.02 },
    emphasis: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.02 },
    accent: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.015 },
    body: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.01 },
  },
  titleUppercase: true,
  margins: { side: 96, photoSide: 72, top: 108, bottom: 104 },
  titleSize: { min: 44, max: 90 },
  accentScale: 0.84,
  lineGap: 0.36,
  accentGap: 0.5,
  emphasis: "color",
  emphasisColor: "accent",
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "ink",
    bodyColor: "ink",
    bodySize: 40,
    rule: false,
    index: false,
    grain: 0,
  },
  photo: { dim: 0, scrim: 0, titleColor: "ink", accentColor: "ink", subColor: "ink", subSize: 52, boxes: "contrast", accentAfterSub: true },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: true,
  },
  brandSize: 22,
};

/** Pastel yellow type straight on a photo a stop darker: bold sans caps for the
    line, a light sans for the sentence, Instrument Serif italic for the word
    that turns it and for the payoff. Founder's ask, 2026-09-23. */
const pastel: StyleKit = {
  id: "pastel",
  name: "Pastel",
  character: "Pastel yellow sans on the photo, a serif italic for the emphasised word and the payoff line. Warm, soft, a little glossy-magazine.",
  palette: {
    paper: "#F8F4EA",
    panel: "#EFE7D3",
    ink: "#23211E",
    accent: "#B8922A",
    muted: "#8C8577",
    contrast: "#F9F4AC",
  },
  fonts: {
    title: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.015 },
    emphasis: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.004 },
    accent: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.006 },
    // Semi-bold, not light: the sentence under the headline has to hold its own on a photo.
    body: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.008 },
  },
  titleUppercase: true,
  margins: { side: 110, photoSide: 84, top: 110, bottom: 104 },
  titleSize: { min: 48, max: 96 },
  accentScale: 0.82,
  lineGap: 0.16,
  accentGap: 0.34,
  emphasis: "italic",
  emphasisColor: "same",
  emphasisKeepsCase: true,
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 38,
    rule: false,
    index: false,
    grain: 0.1,
  },
  photo: { dim: 0.2, scrim: 0.3, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 56, boxes: null, accentAfterSub: true },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: false,
  },
  brandSize: 22,
};

/** White sans straight on the photo under the light veil, no boxes: the
    reel's "bold" look on a slide. The emphasised word leans instead of
    changing colour, so the line stays one voice. */
const bold: StyleKit = {
  id: "bold",
  name: "Bold",
  character: "White sans on the photo under a light veil, no boxes. Plain, direct, the reel's bold look on a slide.",
  palette: {
    paper: "#F4F2EE",
    panel: "#E8E5DF",
    ink: "#141312",
    accent: "#1E6FE8",
    muted: "#7B7873",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.015 },
    emphasis: { ...TIKTOK, weight: TIKTOK_WEIGHT, slant: TIKTOK_SLANT, tracking: -0.015 },
    accent: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.01 },
    body: { ...TIKTOK, weight: TIKTOK_WEIGHT, tracking: -0.008 },
  },
  titleUppercase: false,
  margins: { side: 110, photoSide: 84, top: 110, bottom: 104 },
  titleSize: { min: 48, max: 96 },
  accentScale: 0.82,
  lineGap: 0.16,
  accentGap: 0.34,
  emphasis: "italic",
  emphasisColor: "same",
  emphasisKeepsCase: true,
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 38,
    rule: false,
    index: false,
    grain: 0,
  },
  photo: { dim: VEIL, scrim: 0.3, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 56, boxes: null, accentAfterSub: true },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: true,
  },
  brandSize: 22,
};

/** White EB Garamond straight on the veiled photo, no boxes: the reel's
    "serif" look on a slide. Sentence case, because a caps serif shouts. */
const serif: StyleKit = {
  id: "serif",
  name: "Serif",
  character: "White serif on the photo under a light veil, no boxes. Quiet, editorial, the reel's serif look on a slide.",
  palette: {
    paper: "#F3EFE7",
    panel: "#E6E0D4",
    ink: "#221F1C",
    accent: "#6E2434",
    muted: "#8F877B",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...GARAMOND, weight: 500, tracking: 0 },
    emphasis: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.004 },
    accent: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.006 },
    body: { ...GARAMOND, weight: 500, tracking: 0 },
  },
  titleUppercase: false,
  margins: { side: 120, photoSide: 96, top: 116, bottom: 108 },
  titleSize: { min: 52, max: 104 },
  accentScale: 0.9,
  lineGap: 0.12,
  accentGap: 0.3,
  emphasis: "italic",
  emphasisColor: "same",
  emphasisKeepsCase: true,
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "accent",
    bodyColor: "ink",
    bodySize: 40,
    rule: true,
    index: false,
    grain: 0.12,
  },
  photo: { dim: VEIL, scrim: 0.3, titleColor: "contrast", accentColor: "contrast", subColor: "contrast", subSize: 58, boxes: null, accentAfterSub: true },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: false,
  },
  brandSize: 22,
};

/** Black EB Garamond in square white boxes over the photo as it is: the
    reel's "serif box" look on a slide. The boxed layout with the serif's type. */
const serifBoxed: StyleKit = {
  id: "serif_boxed",
  name: "Serif box",
  character: "Black serif in square white boxes over the photo as it is. The caption look, set in a serif.",
  palette: {
    paper: "#FFFFFF",
    panel: "#F2F0EC",
    ink: "#111111",
    accent: "#6E2434",
    muted: "#7B7873",
    contrast: "#FFFFFF",
  },
  fonts: {
    title: { ...GARAMOND, weight: 500, tracking: 0 },
    emphasis: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.004 },
    accent: { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.006 },
    body: { ...GARAMOND, weight: 500, tracking: 0 },
  },
  titleUppercase: false,
  margins: { side: 96, photoSide: 72, top: 108, bottom: 104 },
  titleSize: { min: 50, max: 100 },
  accentScale: 0.9,
  lineGap: 0.36,
  accentGap: 0.5,
  emphasis: "italic",
  emphasisColor: "same",
  emphasisKeepsCase: true,
  paper: {
    background: "paper",
    alternate: "panel",
    titleColor: "ink",
    accentColor: "ink",
    bodyColor: "ink",
    bodySize: 42,
    rule: false,
    index: false,
    grain: 0,
  },
  photo: { dim: 0, scrim: 0, titleColor: "ink", accentColor: "ink", subColor: "ink", subSize: 56, boxes: "contrast", accentAfterSub: true },
  keyword: {
    background: "ink",
    color: "contrast",
    labelColor: "muted",
    promiseColor: "contrast",
    promiseSize: 34,
    block: true,
  },
  brandSize: 22,
};

/* Picker order is the five text-style ids (src/content/text-styles.ts); the internal kits follow. */
const KITS: StyleKit[] = [bold, pastel, boxed, serif, serifBoxed, signal, atelier, notebook];

export type KitOverrides = {
  /** A customer may retune the palette; the rest of the kit is ours. */
  palette?: Partial<Palette>;
};

/** Kits a customer may choose from. Private kits never appear here; internal kits neither. */
export function listKits(profileSlug?: string): StyleKit[] {
  return KITS.filter((kit) => !kit.internal && (!kit.private || (profileSlug !== undefined && kit.owner === profileSlug)));
}

export function kitIds(profileSlug?: string): string[] {
  return listKits(profileSlug).map((kit) => kit.id);
}

/**
 * A kit's display name, internal kits included: sets made before a kit was
 * retired from the picker still name it. Another account's private kit, or an
 * unknown id, has no name here.
 */
export function kitName(id: string, profileSlug?: string): string | null {
  const kit = KITS.find((candidate) => candidate.id === id);
  if (!kit || (kit.private && kit.owner !== profileSlug)) return null;
  return kit.name;
}

/** Throws rather than silently falling back, so a typo never ships a different look. */
export function resolveKit(id: string, options: KitOverrides & { profileSlug?: string } = {}): StyleKit {
  const kit = KITS.find((candidate) => candidate.id === id);
  if (!kit) throw new Error(`Unknown style kit "${id}". Available: ${kitIds(options.profileSlug).join(", ")}`);
  if (kit.private && kit.owner !== options.profileSlug) {
    throw new Error(`Style kit "${id}" is private to another account.`);
  }
  if (!options.palette) return kit;
  for (const [key, value] of Object.entries(options.palette)) {
    if (value !== undefined && !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new Error(`Palette override ${key} must be a #rrggbb colour, got "${value}"`);
    }
  }
  return { ...kit, palette: { ...kit.palette, ...options.palette } };
}

const ITALIC_SERIFS = new Set([INSTRUMENT_ITALIC.family, PLAYFAIR_ITALIC.family]);

/** The face for the one word a creator marks on a four-photo cover: the kit's
    own italic serif where it has one, Instrument Serif italic where it is all sans. */
export function serifWordFont(kit: StyleKit): FontSpec {
  if (ITALIC_SERIFS.has(kit.fonts.emphasis.family)) return kit.fonts.emphasis;
  if (ITALIC_SERIFS.has(kit.fonts.accent.family)) return kit.fonts.accent;
  return { ...INSTRUMENT_ITALIC, weight: 400, tracking: -0.004 };
}

/** Every font file a kit needs, de-duplicated, for registration. */
export function kitFonts(kit: StyleKit): FontSpec[] {
  const seen = new Map<string, FontSpec>();
  for (const spec of Object.values(kit.fonts)) if (!seen.has(spec.family)) seen.set(spec.family, spec);
  return [...seen.values()];
}

export function paletteColor(kit: StyleKit, key: PaletteKey): string {
  return kit.palette[key];
}

/* The content language: the one language her posts are written in.
 *
 * A setting on each avatar's brand profile (`BrandProfile.language`), stored
 * as a code. Absent means English, which is every profile written before this
 * existed, so nothing about an English account changes: the helpers below
 * return English prompts untouched, byte for byte.
 *
 * Only what a viewer reads or hears changes language: hooks, captions, calls
 * to action, spoken lines, slide text, words on a photo. What the app says to
 * her (buttons, notes, errors, the agent's replies) stays English for now, and
 * so does everything internal: scene and motion descriptions for the image and
 * video models, the identity lock, logs.
 *
 * Every language here uses the Latin alphabet, and every font in assets/fonts
 * has every letter each one needs (checked 2026-09-29, font by font). The text
 * model can write many more languages than this; the list is what the app can
 * DRAW. Vietnamese, Russian, Ukrainian and Greek are missing from the display
 * fonts, so a slide would show empty boxes. Arabic, Hebrew, Hindi, Chinese,
 * Japanese, Korean and Thai are in none of the fonts, and they also need right
 * to left layout or line breaking without spaces, which the renderers do not do.
 *
 * Pure and browser-safe: no database, no Node built-ins. The setup screen and
 * the Brand page import it to draw the select. */

export const LANGUAGE_CODES = [
  "en", "es", "pt", "fr", "de", "it", "nl", "ro", "pl",
  "ca", "sv", "da", "nb", "fi", "cs", "sk", "hu", "hr", "sl", "lt", "lv", "et", "tr", "id", "tl",
] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export const DEFAULT_LANGUAGE: LanguageCode = "en";

/**
 * How far talking reels are known to work in a language.
 *
 * Source: Google's Gemini Omni Flash documentation (read 2026-09-29) says
 * English is fully supported and other languages "have not been evaluated, so
 * they may work but results can vary". Romanian was spoken correctly in one
 * live 6 second clip on 2026-09-29. Move a language to "tested" when a clip in
 * it has been checked by a native speaker.
 */
export type VoiceLevel = "supported" | "tested" | "untested";

type Language = {
  /** Its name in English, for prompts and the interface. */
  english: string;
  /** Its name in itself, so she recognises it in the list. */
  native: string;
  /** The BCP 47 tag for case changes. */
  locale: string;
  /**
   * Spoken words per English word in the same time. Estimates, to be tuned
   * against real clips: these languages carry more syllables per word, so a
   * line that fills eight seconds has fewer words than it would in English.
   */
  speechPace: number;
  /**
   * Written words per English word for the same thought. Estimates: the
   * Romance languages spend more small words (articles, "de", "que"), so a
   * word limit tuned on English is widened for them. Never below one: German
   * and Polish use fewer words, and their limits stay as they are.
   */
  textWords: number;
  voice: VoiceLevel;
  /** The reel's standard second lines, which a viewer reads. To be checked by a native speaker (W4 step 6). */
  readTheCaption: string;
  /** "Comment" as in "Comment AVATAR": the verb before her keyword. */
  comment: string;
  /** The last slide's ask on a set written without her brand. */
  asks: Record<GenericAsk, string>;
};

/** The three asks a set written without her brand ends on (src/carousel/spec.ts). */
export type GenericAsk = "save" | "share" | "follow";

export const LANGUAGES: Record<LanguageCode, Language> = {
  en: { english: "English", native: "English", locale: "en", speechPace: 1, textWords: 1, voice: "supported", readTheCaption: "Read the caption", comment: "Comment", asks: { save: "Save this", share: "Share this", follow: "Follow for more" } },
  es: { english: "Spanish", native: "Español", locale: "es", speechPace: 0.9, textWords: 1.2, voice: "untested", readTheCaption: "Lee la descripción", comment: "Comenta", asks: { save: "Guárdalo", share: "Compártelo", follow: "Sígueme para más" } },
  pt: { english: "Portuguese", native: "Português", locale: "pt", speechPace: 0.9, textWords: 1.2, voice: "untested", readTheCaption: "Leia a legenda", comment: "Comente", asks: { save: "Salve este post", share: "Compartilhe", follow: "Siga para mais" } },
  fr: { english: "French", native: "Français", locale: "fr", speechPace: 0.9, textWords: 1.2, voice: "untested", readTheCaption: "Lis la légende", comment: "Commente", asks: { save: "Enregistre-le", share: "Partage-le", follow: "Abonne-toi pour plus" } },
  de: { english: "German", native: "Deutsch", locale: "de", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Lies die Beschreibung", comment: "Kommentiere", asks: { save: "Speichere es", share: "Teile es", follow: "Folge für mehr" } },
  it: { english: "Italian", native: "Italiano", locale: "it", speechPace: 0.9, textWords: 1.2, voice: "untested", readTheCaption: "Leggi la didascalia", comment: "Commenta", asks: { save: "Salvalo", share: "Condividilo", follow: "Seguimi per altri" } },
  nl: { english: "Dutch", native: "Nederlands", locale: "nl", speechPace: 0.9, textWords: 1.05, voice: "untested", readTheCaption: "Lees het bijschrift", comment: "Reageer met", asks: { save: "Bewaar dit", share: "Deel dit", follow: "Volg voor meer" } },
  ro: { english: "Romanian", native: "Română", locale: "ro", speechPace: 0.85, textWords: 1.1, voice: "tested", readTheCaption: "Citește descrierea", comment: "Comentează", asks: { save: "Salvează", share: "Distribuie", follow: "Urmărește pentru mai mult" } },
  pl: { english: "Polish", native: "Polski", locale: "pl", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Przeczytaj opis", comment: "Skomentuj", asks: { save: "Zapisz", share: "Udostępnij", follow: "Obserwuj po więcej" } },
  ca: { english: "Catalan", native: "Català", locale: "ca", speechPace: 0.9, textWords: 1.2, voice: "untested", readTheCaption: "Llegeix la descripció", comment: "Comenta", asks: { save: "Desa-ho", share: "Comparteix-ho", follow: "Segueix-me per a més" } },
  sv: { english: "Swedish", native: "Svenska", locale: "sv", speechPace: 0.9, textWords: 1, voice: "untested", readTheCaption: "Läs bildtexten", comment: "Kommentera", asks: { save: "Spara detta", share: "Dela detta", follow: "Följ för mer" } },
  da: { english: "Danish", native: "Dansk", locale: "da", speechPace: 0.9, textWords: 1, voice: "untested", readTheCaption: "Læs billedteksten", comment: "Kommentér", asks: { save: "Gem dette", share: "Del dette", follow: "Følg for mere" } },
  nb: { english: "Norwegian", native: "Norsk", locale: "nb", speechPace: 0.9, textWords: 1, voice: "untested", readTheCaption: "Les bildeteksten", comment: "Kommenter", asks: { save: "Lagre dette", share: "Del dette", follow: "Følg for mer" } },
  fi: { english: "Finnish", native: "Suomi", locale: "fi", speechPace: 0.8, textWords: 1, voice: "untested", readTheCaption: "Lue kuvateksti", comment: "Kommentoi", asks: { save: "Tallenna tämä", share: "Jaa tämä", follow: "Seuraa, niin näet lisää" } },
  cs: { english: "Czech", native: "Čeština", locale: "cs", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Přečti si popisek", comment: "Napiš do komentáře", asks: { save: "Ulož si to", share: "Sdílej to", follow: "Sleduj pro víc" } },
  sk: { english: "Slovak", native: "Slovenčina", locale: "sk", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Prečítaj si popis", comment: "Napíš do komentára", asks: { save: "Ulož si to", share: "Zdieľaj to", follow: "Sleduj pre viac" } },
  hu: { english: "Hungarian", native: "Magyar", locale: "hu", speechPace: 0.8, textWords: 1, voice: "untested", readTheCaption: "Olvasd el a leírást", comment: "Írd kommentbe:", asks: { save: "Mentsd el", share: "Oszd meg", follow: "Kövess be még többért" } },
  hr: { english: "Croatian", native: "Hrvatski", locale: "hr", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Pročitaj opis", comment: "Komentiraj", asks: { save: "Spremi ovo", share: "Podijeli ovo", follow: "Prati za više" } },
  sl: { english: "Slovenian", native: "Slovenščina", locale: "sl", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Preberi opis", comment: "Komentiraj", asks: { save: "Shrani to", share: "Deli to", follow: "Sledi za več" } },
  lt: { english: "Lithuanian", native: "Lietuvių", locale: "lt", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Perskaityk aprašymą", comment: "Komentuok", asks: { save: "Išsaugok", share: "Pasidalink", follow: "Sek, kad matytum daugiau" } },
  lv: { english: "Latvian", native: "Latviešu", locale: "lv", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Izlasi aprakstu", comment: "Komentē", asks: { save: "Saglabā šo", share: "Dalies ar šo", follow: "Seko, lai redzētu vairāk" } },
  et: { english: "Estonian", native: "Eesti", locale: "et", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Loe kirjeldust", comment: "Kommenteeri", asks: { save: "Salvesta see", share: "Jaga seda", follow: "Jälgi, et näha rohkem" } },
  tr: { english: "Turkish", native: "Türkçe", locale: "tr", speechPace: 0.8, textWords: 1, voice: "untested", readTheCaption: "Açıklamayı oku", comment: "Yoruma yaz:", asks: { save: "Kaydet", share: "Paylaş", follow: "Daha fazlası için takip et" } },
  id: { english: "Indonesian", native: "Bahasa Indonesia", locale: "id", speechPace: 0.85, textWords: 1, voice: "untested", readTheCaption: "Baca caption", comment: "Komentar", asks: { save: "Simpan ini", share: "Bagikan ini", follow: "Ikuti untuk lainnya" } },
  tl: { english: "Filipino", native: "Filipino", locale: "fil", speechPace: 0.85, textWords: 1.1, voice: "untested", readTheCaption: "Basahin ang caption", comment: "I-comment ang", asks: { save: "I-save ito", share: "I-share ito", follow: "I-follow para sa iba pa" } },
};

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && (LANGUAGE_CODES as readonly string[]).includes(value);
}

/** Any stored or submitted value as a supported code. Unknown, empty or missing is English. */
export function normaliseLanguage(value: unknown): LanguageCode {
  if (typeof value !== "string") return DEFAULT_LANGUAGE;
  const code = value.trim().toLowerCase();
  return isLanguageCode(code) ? code : DEFAULT_LANGUAGE;
}

/** The profile's language, whatever the row holds. */
export function contentLanguage(profile: { language?: unknown } | null | undefined): LanguageCode {
  return normaliseLanguage(profile?.language);
}

/** The field to store on a profile: nothing for English, so an English profile keeps the shape it always had. */
export function languageField(value: unknown): { language?: LanguageCode } {
  const code = normaliseLanguage(value);
  return code === DEFAULT_LANGUAGE ? {} : { language: code };
}

export function isEnglish(value: unknown): boolean {
  return normaliseLanguage(value) === DEFAULT_LANGUAGE;
}

/** The select's option text: "Romanian (Română)", or "English". */
export function languageLabel(code: LanguageCode): string {
  const { english, native } = LANGUAGES[code];
  return english === native ? english : `${english} (${native})`;
}

export function localeFor(value: unknown): string {
  return LANGUAGES[normaliseLanguage(value)].locale;
}

/** What the viewers read and hear, when a writer is not told otherwise. */
const VIEWER_WORDS = "every word a viewer will read or hear";

/**
 * The one sentence every writer is given when her language is not English.
 * `what` names the fields that are written in her language; every other field
 * stays English, because those are read by the app or by the image and video
 * models. English returns "", so English prompts do not change.
 */
export function languageRule(value: unknown, what: string = VIEWER_WORDS): string {
  const code = normaliseLanguage(value);
  if (code === DEFAULT_LANGUAGE) return "";
  const { english, native } = LANGUAGES[code];
  return (
    `Language: write ${what} in ${english} (${native}), the way a native speaker writes for Instagram, not translated word for word from English. ` +
    `The rules above are written in English and apply to the ${english} text in the same way; a word count means ${english} words. ` +
    "Never translate: the comment keyword, words the creator gave to be used exactly, and names of people, brands and products. " +
    "Write every other field in English."
  );
}

/** A writer's instructions with her language rule appended. English comes back exactly as given. */
export function withLanguage(text: string, value: unknown, what?: string): string {
  const rule = languageRule(value, what);
  return rule ? `${text}\n\n${rule}` : text;
}

/**
 * For the readers and planners whose output feeds the image and video models
 * or the app itself: when she writes in another language, those fields still
 * come back in English. English returns the text unchanged.
 */
export function withEnglishFields(text: string, value: unknown, what: string, verbatim?: string): string {
  if (isEnglish(value)) return text;
  const keep = verbatim ? ` Copy ${verbatim} exactly as written, in the language they are in.` : "";
  return `${text}\n\nWrite ${what} in English, even when her words are in another language.${keep}`;
}

/**
 * The sentence a speaking clip's prompt carries so the video model speaks her
 * language, not English with her words in it. English returns "", so an
 * English prompt does not change. Used by the storyboard's clips; a single
 * talking reel names it inside `talkingPrompt`.
 */
export function spokenIn(value: unknown): string {
  const code = normaliseLanguage(value);
  if (code === DEFAULT_LANGUAGE) return "";
  const { english } = LANGUAGES[code];
  return `Every word is spoken in ${english}, with native ${english} pronunciation.`;
}

/** A spoken word range for this language: fewer words where words are longer. English is returned as given. */
export function spokenRange(range: { min: number; max: number; cut: number }, value: unknown): { min: number; max: number; cut: number } {
  const pace = LANGUAGES[normaliseLanguage(value)].speechPace;
  if (pace === 1) return range;
  const max = Math.floor(range.max * pace);
  const cut = Math.max(max, Math.floor(range.cut * pace));
  return { min: Math.min(max, Math.round(range.min * pace)), max, cut };
}

/** Spoken words a second in this language, for fitting a clip to a line. */
export function speechWordsPerSecond(base: number, value: unknown): number {
  return base * LANGUAGES[normaliseLanguage(value)].speechPace;
}

/**
 * A written limit (words or characters) tuned on English, widened where the language spends
 * more words on the same thought. Never narrowed, and English is unchanged.
 */
export function widenLimit(limit: number, value: unknown): number {
  const factor = LANGUAGES[normaliseLanguage(value)].textWords;
  return factor <= 1 ? limit : Math.max(limit, Math.round(limit * factor));
}

/** The line shown under the select, or null when talking reels are supported in it. Interface text, so English. */
export function voiceNote(value: unknown): string | null {
  const code = normaliseLanguage(value);
  const { voice, english } = LANGUAGES[code];
  if (voice === "supported") return null;
  if (voice === "tested") return `Talking reels have been tested in ${english}.`;
  return "Writing works in this language. Talking reels have not been tested in it yet, so her speech may vary.";
}

/** "Read the caption" in her language: a second line the viewer reads. */
export function readTheCaption(value: unknown): string {
  return LANGUAGES[normaliseLanguage(value)].readTheCaption;
}

/** "Comment AVATAR" in her language. The keyword itself is never translated. */
export function commentLine(word: string, value: unknown): string {
  return `${LANGUAGES[normaliseLanguage(value)].comment} ${word}`;
}

/** The last slide's ask on a set written without her brand: "Save this", in her language. */
export function genericAsk(action: GenericAsk, value: unknown): string {
  return LANGUAGES[normaliseLanguage(value)].asks[action];
}

/** Whether a line opens with "Comment" in English or in her language. */
export function startsWithComment(text: string, value: unknown): boolean {
  const verb = LANGUAGES[normaliseLanguage(value)].comment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /^comment\b/i.test(text.trim()) || new RegExp(`^${verb}(?![\\p{L}\\p{N}])`, "iu").test(text.trim());
}

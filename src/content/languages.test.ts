import assert from "node:assert/strict";
import { test } from "node:test";

import { decideCue, directSystem } from "../agent/direct";
import { scenesSystem } from "../agent/scenes";
import { secondLineText } from "../agent/second-line";
import { readerSystem } from "../agent/understand";
import { checkSpec, moneyLanguage, type CheckSources } from "../carousel/check";
import { resolveKit } from "../carousel/kits";
import { askText, parseSpec, type CarouselSpec } from "../carousel/spec";
import { topicsKey, topicsSystem } from "../carousel/topics";
import { carouselPrompt, toSpec } from "../carousel/write";
import { compile } from "../onboarding/compile";
import { start } from "../onboarding/state";
import { writerProfile } from "./brand-scope";
import { factCheckPrompt, writerPrompt, type BrandProfile } from "./hooks";
import {
  commentLine,
  contentLanguage,
  isLanguageCode,
  LANGUAGE_CODES,
  LANGUAGES,
  languageField,
  languageLabel,
  languageRule,
  localeFor,
  normaliseLanguage,
  readTheCaption,
  spokenRange,
  startsWithComment,
  voiceNote,
  widenLimit,
  withEnglishFields,
  withLanguage,
} from "./languages";
import { OMNI_TALKING_SECONDS, MAX_TALKING_SECONDS, spokenWords, talkingPrompt, talkingSeconds } from "./motion";
import { photoWordsSystem } from "./photo-quote";
import { onScreenCase } from "./text-styles";

/* No network. Every writer is exercised through the pure function that
   builds its prompt, or through an injected model that only records what it
   was asked. */

const PROFILE: BrandProfile = {
  personaName: "Ioana",
  story: "Am postat un an fără rezultate. Apoi am făcut un avatar.",
  niche: "Instagram fără față",
  audience: "Femei care nu vor să apară la cameră",
  offer: "Ghidul de 7 zile",
  keyword: "AVATAR",
  voice: "Cald, direct",
  proofPoints: ["12.000 de urmăritori în 5 luni"],
  language: "ro",
};

/* --- the module ----------------------------------------------------------- */

test("the list: Latin-alphabet languages only, English first and the default", () => {
  assert.equal(LANGUAGE_CODES[0], "en");
  assert.equal(new Set(LANGUAGE_CODES).size, LANGUAGE_CODES.length, "no code twice");
  // Scripts the fonts cannot draw stay out until the fonts and the renderers can.
  for (const code of ["vi", "ru", "uk", "el", "ar", "he", "hi", "zh", "ja", "ko", "th"]) assert.equal((LANGUAGE_CODES as readonly string[]).includes(code), false, code);
  for (const code of LANGUAGE_CODES) {
    const { english, native } = LANGUAGES[code];
    // No right-to-left or non-Latin script: the fonts and renderers were not checked for them.
    assert.match(`${english}${native}`, /^[\p{Script=Latin} ]+$/u, code);
  }
  assert.equal(LANGUAGES.ro.native, "Română");
  assert.equal(languageLabel("ro"), "Romanian (Română)");
  assert.equal(languageLabel("en"), "English");
});

test("validation and normalising: a code is checked against the list, anything else is English", () => {
  assert.ok(isLanguageCode("ro"));
  assert.ok(!isLanguageCode("RO"));
  assert.ok(!isLanguageCode("ar"));
  assert.ok(!isLanguageCode(undefined));
  assert.equal(normaliseLanguage(" RO "), "ro");
  for (const odd of [undefined, null, "", "xx", "ar", "ja", "Romanian", 7, {}]) assert.equal(normaliseLanguage(odd), "en", String(odd));
  assert.equal(contentLanguage({}), "en");
  assert.equal(contentLanguage(null), "en");
  assert.equal(contentLanguage({ language: "de" }), "de");
});

test("stored shape: English is no field at all, so English rows keep the shape they always had", () => {
  assert.deepEqual(languageField("en"), {});
  assert.deepEqual(languageField("nonsense"), {});
  assert.deepEqual(languageField("ro"), { language: "ro" });
});

test("locales follow the code", () => {
  assert.equal(localeFor("ro"), "ro");
  assert.equal(localeFor("de"), "de");
  assert.equal(localeFor(undefined), "en");
  assert.equal(localeFor("zz"), "en");
});

test("the language rule: empty for English, one fixed sentence otherwise", () => {
  assert.equal(languageRule("en"), "");
  assert.equal(languageRule(undefined), "");
  const rule = languageRule("ro", "the line");
  assert.ok(rule.startsWith("Language: write the line in Romanian (Română)"), rule);
  assert.match(rule, /Never translate: the comment keyword, words the creator gave to be used exactly/);
  assert.match(rule, /Write every other field in English/);
  assert.match(languageRule("de"), /every word a viewer will read or hear in German \(Deutsch\)/);
});

test("withLanguage and withEnglishFields hand English back exactly as given", () => {
  const text = "Some rules.\nMore rules.";
  assert.equal(withLanguage(text, "en", "x"), text);
  assert.equal(withLanguage(text, undefined), text);
  assert.equal(withEnglishFields(text, "en", "brief"), text);
  assert.equal(withLanguage(text, "es", "x"), `${text}\n\n${languageRule("es", "x")}`);
  assert.match(withEnglishFields(text, "es", "brief", "words"), /Write brief in English, even when her words are in another language\. Copy words exactly as written/);
});

test("voice levels: English supported, Romanian tested, the rest untested", () => {
  assert.equal(LANGUAGES.en.voice, "supported");
  assert.equal(LANGUAGES.ro.voice, "tested");
  for (const code of LANGUAGE_CODES.filter((code) => code !== "en" && code !== "ro")) assert.equal(LANGUAGES[code].voice, "untested", code);
  assert.equal(voiceNote("en"), null);
  assert.equal(voiceNote("ro"), "Talking reels have been tested in Romanian.");
  assert.equal(voiceNote("pl"), "Writing works in this language. Talking reels have not been tested in it yet, so her speech may vary.");
});

test("limits widen only for languages that spend more words, and never narrow", () => {
  assert.equal(widenLimit(4, "en"), 4);
  assert.equal(widenLimit(4, "de"), 4);
  assert.equal(widenLimit(4, "pl"), 4);
  assert.equal(widenLimit(4, "es"), 5);
  assert.equal(widenLimit(26, "ro"), 29);
  for (const code of LANGUAGE_CODES) assert.ok(widenLimit(10, code) >= 10, code);
});

/* --- every writer is told her language ----------------------------------- */

test("hooks and captions: the writer and the fact-checker are told Romanian, for loops, talking reels and with the brand off", () => {
  for (const options of [{}, { visual: true }, { visual: true, format: "talking" as const, talkingSeconds: 8 }, { hook: "Cârligul meu exact" }]) {
    const { system } = writerPrompt(PROFILE, 1, options);
    assert.ok(system.includes(languageRule("ro", options.format === "talking" ? "the hook, the caption, the call to action and the spoken line" : "the hook, the caption, the call to action")), JSON.stringify(options));
  }
  assert.ok(writerPrompt(writerProfile(PROFILE, false), 1).system.includes("in Romanian (Română)"), "brand off keeps her language");
  assert.ok(factCheckPrompt(PROFILE, [{ hook: "h", caption: "c" }]).system.includes("every hook and caption you return, including any sentence you rewrite in Romanian"));
  assert.ok(factCheckPrompt(writerProfile(PROFILE, false), [{ hook: "h", caption: "c" }]).system.includes("in Romanian"));
});

test("the claims rule stands in any language: the fact-check still reads her story and her proof points", () => {
  const { system, prompt } = factCheckPrompt(PROFILE, [{ hook: "Am 50.000 de urmăritori", caption: "c" }]);
  assert.match(system, /a number that is not in the proof points/);
  assert.ok(prompt.includes("- 12.000 de urmăritori în 5 luni"));
  assert.ok(prompt.includes(PROFILE.story as string));
});

test("her exact hook and her keyword stay hers: the writer is told so in Romanian too", () => {
  const { system, prompt } = writerPrompt(PROFILE, 1, { hook: "Cârligul meu exact" });
  assert.match(prompt, /used EXACTLY as given, word for word/);
  assert.match(system, /Never translate: the comment keyword, words the creator gave to be used exactly/);
  assert.ok(prompt.includes("Comment keyword: AVATAR"));
});

test("a talking reel's script asks for fewer words in Romanian than in English", () => {
  const en = writerPrompt({ ...PROFILE, language: undefined }, 1, { visual: true, format: "talking", talkingSeconds: 8 }).system;
  const ro = writerPrompt(PROFILE, 1, { visual: true, format: "talking", talkingSeconds: 8 }).system;
  assert.match(en, /22 to 26 words and never more than 26/);
  const { min, max, cut } = spokenWords(8, "ro");
  assert.ok(ro.includes(`${min} to ${max} words and never more than ${cut}`));
});

test("carousels: every slide's words and the caption are written in her language", () => {
  const kit = resolveKit("signal");
  for (const layout of [undefined, "photos", "split", "grid"] as const) {
    const { system } = carouselPrompt({ topic: "5 obiceiuri", profile: PROFILE, brief: null, kit, skeleton: "list", format: "carousel", layout, name: "t", photoRefs: ["p1"] });
    assert.ok(system.endsWith(languageRule("ro", "every slide's titleLines, accent, sub, body and promise, and the caption")), String(layout));
  }
});

test("the carousel spec records its language, so every later draw knows it; English records nothing", () => {
  const draft = { caption: "Comentează AVATAR", slides: [{ type: "cover", titleLines: ["A"], sub: "b" }, { type: "keyword", keyword: "AVATAR", promise: "p" }] };
  assert.equal((toSpec(draft, { photoRefs: ["p1"], profile: PROFILE, name: "t", format: "carousel" }) as { language?: string }).language, "ro");
  assert.ok(!("language" in (toSpec(draft, { photoRefs: ["p1"], profile: { ...PROFILE, language: undefined }, name: "t", format: "carousel" }) as object)));
});

test("words on a photo, the director, the topics: each is told her language", () => {
  assert.ok(photoWordsSystem(PROFILE).endsWith(languageRule("ro", "the line")));
  assert.ok(directSystem("ro").endsWith(languageRule("ro", "cueText")));
  assert.ok(topicsSystem("ro").endsWith(languageRule("ro", "each topic")));
  assert.equal(directSystem(undefined), directSystem("en"));
  assert.equal(topicsSystem(undefined), topicsSystem("en"));
});

test("the reader and the scene planner keep their internal fields in English whatever she wrote in", () => {
  assert.match(readerSystem("ro"), /Write brief, scene, framing and reply in English, even when her words are in another language\. Copy words, exact, template and reference exactly as written/);
  assert.match(scenesSystem("ro"), /Write every idea and every why in English/);
  assert.equal(readerSystem("en"), readerSystem(undefined));
  assert.ok(!readerSystem("en").includes("even when her words are in another language"));
});

test("setup: the language she picked on the first screen is carried onto her brand profile", () => {
  const state = start({ avatarKind: "avatar", personaName: "Ioana", niche: "fitness", language: "ro" }, "2026-09-29T10:00:00.000Z");
  assert.equal(state.setup.language, "ro");
  const english = start({ avatarKind: "avatar", personaName: "Mia", niche: "fitness" }, "2026-09-29T10:00:00.000Z");
  assert.equal(english.setup.language, undefined);
  const T = "2026-09-29T10:00:00.000Z";
  const answered = (base: typeof state) => {
    let s = base;
    const answers: [string, object][] = [
      ["audience", { text: "Mame ocupate" }],
      ["problem", { text: "Nu au timp" }],
      ["offer", { text: "Plan de 20 de lei", keyword: "PLAN" }],
      ["story", { before: "Eram obosită", turn: "Am început", now: "Mă antrenez" }],
      ["proof", { points: ["3 clienți"] }],
      ["pov", { text: "Puțin e destul" }],
      ["voice", { label: "direct", caption: "c", is: ["scurt"], isNot: ["hype"] }],
    ];
    for (const [id, value] of answers) s = { ...s, answers: { ...s.answers, [id]: { ...value, source: "typed", at: T } } };
    return s;
  };
  assert.equal(compile(answered(state), T).profile.language, "ro");
  assert.ok(!("language" in compile(answered(english), T).profile));
});

test("topic suggestions are asked again when the language changes, and English keys are unchanged", () => {
  const english = { ...PROFILE, language: undefined };
  assert.equal(topicsKey(english), topicsKey({ ...english, language: "en" }));
  assert.notEqual(topicsKey(english), topicsKey(PROFILE));
});

/* --- talking reels --------------------------------------------------------- */

test("the talking prompt names the language outside English and is unchanged in English", () => {
  const english = talkingPrompt("You do not need to show your face.");
  assert.ok(english.startsWith('She says, in a natural speaking voice: "You do not need to show your face." '));
  assert.equal(talkingPrompt("x", "en"), talkingPrompt("x"));
  assert.equal(talkingPrompt("x", "zz"), talkingPrompt("x"));
  const romanian = talkingPrompt("„Nu trebuie să-ți arăți fața.”", "ro");
  assert.ok(romanian.startsWith("She says, in Romanian, in a natural speaking voice with native Romanian pronunciation: "), romanian);
  assert.ok(romanian.includes("Nu trebuie să-ți arăți fața."));
  assert.match(talkingPrompt("Hola", "es"), /in Spanish/);
});

test("spoken word ranges: English exactly as before, every other language no longer and always consistent", () => {
  assert.deepEqual(spokenWords(OMNI_TALKING_SECONDS), { min: 22, max: 26, cut: 26 });
  assert.deepEqual(spokenWords(MAX_TALKING_SECONDS), { min: 30, max: 34, cut: 36 });
  assert.deepEqual(spokenWords(OMNI_TALKING_SECONDS, "en"), { min: 22, max: 26, cut: 26 });
  for (const code of LANGUAGE_CODES) {
    for (const seconds of [OMNI_TALKING_SECONDS, 10, MAX_TALKING_SECONDS]) {
      const range = spokenWords(seconds, code);
      const english = spokenWords(seconds);
      assert.ok(range.min <= range.max && range.max <= range.cut, `${code} ${seconds}s ${JSON.stringify(range)}`);
      assert.ok(range.max <= english.max && range.cut <= english.cut, `${code} ${seconds}s is no longer than English`);
    }
  }
  assert.deepEqual(spokenWords(OMNI_TALKING_SECONDS, "ro"), { min: 19, max: 22, cut: 22 });
  assert.deepEqual(spokenRange({ min: 22, max: 26, cut: 26 }, "de"), { min: 19, max: 22, cut: 22 });
});

test("a Romanian line of the same length needs a little longer to say", () => {
  const line = Array.from({ length: 24 }, (_, i) => `cuvânt${i}`).join(" ");
  assert.equal(talkingSeconds(line), 9);
  assert.equal(talkingSeconds(line, undefined, undefined, "ro"), 10);
  assert.equal(talkingSeconds(line, undefined, 8, "ro"), 8);
});

/* --- words a viewer reads that the app itself supplies -------------------- */

test("the stock second lines and the carousel ask are in her language; her keyword never changes", () => {
  assert.equal(secondLineText({ kind: "caption" }), "Read the caption");
  assert.equal(secondLineText({ kind: "caption" }, "ro"), "Citește descrierea");
  assert.equal(secondLineText({ kind: "comment", word: "avatar" }, "ro"), "Comentează AVATAR");
  assert.equal(secondLineText({ kind: "own", text: "Al meu" }, "ro"), "Al meu");
  assert.equal(askText({ keyword: "AVATAR" }, "ro"), "Comentează AVATAR");
  assert.equal(askText({ keyword: "SAVE", action: "save" }, "es"), "Guárdalo");
  assert.equal(askText({ keyword: "AVATAR" }), "Comment AVATAR");
  assert.equal(readTheCaption("de"), "Lies die Beschreibung");
  assert.equal(commentLine("GUIDE", "fr"), "Commente GUIDE");
});

test("the director's own fallback line is in her language, and a comment line is dropped with the brand off in any language", () => {
  assert.equal(decideCue("", "", "yes", "AVATAR", "ro").cue?.text, "Citește descrierea");
  assert.equal(decideCue("Comentează AVATAR", "why", "auto", "", "ro").cue, null);
  assert.equal(decideCue("Comment AVATAR", "why", "auto", "", "ro").cue, null);
  assert.ok(startsWithComment("Comentează", "ro"));
  assert.ok(!startsWithComment("Comentariile", "ro"));
});

test("a keyword may carry an accent; the spec records a language code", () => {
  const spec = parseSpec({
    name: "t-ro",
    caption: "Comentează ȘTIU",
    language: "ro",
    slides: [
      { type: "cover", photo: "p", title: { lines: ["A"] } },
      { type: "paper", title: { lines: ["B"] }, body: "c" },
      { type: "paper", title: { lines: ["D"] }, body: "e" },
      { type: "paper", title: { lines: ["F"] }, body: "g" },
      { type: "keyword", keyword: "ȘTIU", promise: "h" },
    ],
  });
  assert.equal(spec.language, "ro");
  assert.throws(() => parseSpec({ ...spec, language: "xx" }));
});

/* --- lowercase with the right locale ------------------------------------- */

test("lowercase uses the locale it is given, English when none is", () => {
  assert.equal(onScreenCase("ÎNCEPE ACUM, ȘTIU", true, localeFor("ro")), "începe acum, știu");
  assert.equal(onScreenCase("GRÜẞE AN ÖSTERREICH", true, localeFor("de")), "grüße an österreich");
  assert.equal(onScreenCase("ZAŻÓŁĆ", true, "pl"), "zażółć");
  assert.equal(onScreenCase("Keep ME", false, "ro"), "Keep ME");
  // The locale is really used: Turkish (not offered) lowercases I to a dotless ı.
  assert.equal(onScreenCase("I", true, "tr"), "ı");
  assert.equal(onScreenCase("I", true), "i");
});

/* --- the checks that assumed English ------------------------------------- */

const sourcesFor = (profile: BrandProfile): CheckSources => ({ profile });

function romanianSet(overrides: Partial<CarouselSpec> = {}): CarouselSpec {
  return parseSpec({
    name: "set-ro",
    caption: "Comentează AVATAR și îți trimit ghidul.",
    language: "ro",
    slides: [
      { type: "cover", photo: "p00", title: { lines: ["Am ajuns la", "*12.000*"], accent: "fără fața mea." }, sub: "Iată cum →" },
      { type: "paper", title: { lines: ["Camera nu era", "problema"] }, body: "Aveam idei, dar altceva mă oprea. Dar nu asta a contat." },
      { type: "paper", title: { lines: ["Așa că am", "făcut-o pe *ea*"] }, body: "Apare în fiecare zi, cu vocea mea. Apoi s-a schimbat totul." },
      { type: "paper", title: { lines: ["Postez zilnic"] }, body: "Și nu mai filmez nimic." },
      { type: "keyword", keyword: "AVATAR", promise: "Comentează și primești ghidul gratuit." },
    ],
    ...overrides,
  });
}

test("a Romanian set that follows the rules passes: no English-only pull or ask rule sends it back", () => {
  assert.deepEqual(checkSpec(romanianSet(), sourcesFor(PROFILE)), []);
});

test("the same flat set in English is still sent back: the English rules did not weaken", () => {
  const problems = checkSpec(romanianSet({ language: undefined }), sourcesFor({ ...PROFILE, language: undefined }));
  assert.ok(problems.some((problem) => problem.rule === "no-pull"), JSON.stringify(problems));
});

test("numbers in any language come only from her proof points: an invented one is caught, hers in either grouping is not", () => {
  const invented = romanianSet({
    slides: [...romanianSet().slides.slice(0, 3), { type: "paper", title: { lines: ["În 30 de zile"] }, body: "Am câștigat 4.500 de urmăritori." }, romanianSet().slides[4]],
  });
  const problems = checkSpec(invented, sourcesFor(PROFILE));
  assert.ok(problems.some((problem) => problem.rule === "unsupported-number" && problem.detail.includes("30")), JSON.stringify(problems));
  assert.ok(problems.some((problem) => problem.rule === "unsupported-number" && problem.detail.includes("4,500")), JSON.stringify(problems));
  // Her proof says 12.000; a slide that writes 12,000 or 12.000 is the same number.
  const hers = romanianSet({ slides: [...romanianSet().slides.slice(0, 3), { type: "paper", title: { lines: ["12,000 de oameni"] }, body: "Și nu mai filmez nimic." }, romanianSet().slides[4]] });
  assert.ok(!checkSpec(hers, sourcesFor(PROFILE)).some((problem) => problem.rule === "unsupported-number"));
});

test("money: amounts with a currency are caught in every language, English words still in English; other languages' money words are a known gap", () => {
  assert.equal(moneyLanguage("Am făcut 500 € luna trecută", "ro"), "500 €");
  assert.equal(moneyLanguage("Am făcut 2.000 lei", "ro"), "2.000 lei");
  assert.equal(moneyLanguage("€500 in a month", "de"), "€500");
  assert.equal(moneyLanguage("Mein side hustle", "de"), "side hustle");
  assert.equal(moneyLanguage("I made money while I slept"), "made money");
  assert.equal(moneyLanguage("€500 in a month"), null, "English is exactly as it was");
  // Documented gap: a money phrase in the language itself, with no amount, is left to the writer's instruction.
  assert.equal(moneyLanguage("venit pasiv în fiecare lună", "ro"), null);
  const paid = romanianSet({ caption: "Am făcut 3.000 € cu asta. Comentează AVATAR." });
  assert.ok(checkSpec(paid, sourcesFor(PROFILE)).some((problem) => problem.rule === "money-language"));
});

test("word limits tuned on English give a Spanish title line one more word, and none more in English", () => {
  const spanish = { ...PROFILE, language: "es" };
  const five = romanianSet({
    language: "es",
    slides: [...romanianSet().slides.slice(0, 3), { type: "paper", title: { lines: ["La parte de la historia"] }, body: "Y ya no grabo nada." }, romanianSet().slides[4]],
  });
  assert.ok(!checkSpec(five, sourcesFor(spanish)).some((problem) => problem.rule === "title-line-length"));
  assert.ok(checkSpec({ ...five, language: undefined }, sourcesFor({ ...spanish, language: undefined })).some((problem) => problem.rule === "title-line-length"));
});

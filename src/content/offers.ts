import type { Brief } from "../brief/build";
import type { BrandProfile, Offer } from "./hooks";

/* More than one offer (first paying user, F3 in docs/MASTER-PLAN.md).
 *
 * The profile's own `offer` and `keyword` stay the default offer, so every
 * profile saved before this existed is a one-offer profile and every writer
 * keeps reading the two fields it always read. The other offers sit in
 * `offers`. A request picks one from her own words; the writers are then handed
 * a profile whose `offer` and `keyword` are that one, and never learn there
 * were others.
 *
 * Pure: no database, no model call. */

/** The most offers one avatar can hold, the default included. */
export const MAX_OFFERS = 5;

/** A comment keyword: one word, letters and digits, any Latin language. */
const KEYWORD = /^[\p{L}\p{N}]+$/u;

export function isKeyword(value: string): boolean {
  return KEYWORD.test(value);
}

const same = (a: string, b: string) => a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/**
 * Every offer, the default first. A malformed or repeated extra (the row is
 * json) is skipped rather than trusted.
 */
export function offersOf(profile: BrandProfile): Offer[] {
  const all: Offer[] = [{ offer: profile.offer, keyword: profile.keyword }];
  for (const item of Array.isArray(profile.offers) ? profile.offers : []) {
    if (!item || typeof item.offer !== "string" || typeof item.keyword !== "string") continue;
    const offer = item.offer.trim();
    const keyword = item.keyword.trim();
    if (!offer || !isKeyword(keyword) || all.some((known) => same(known.keyword, keyword))) continue;
    all.push({ offer, keyword });
    if (all.length === MAX_OFFERS) break;
  }
  return all;
}

/** Every comment keyword she uses, the default first. */
export function keywordsOf(profile: BrandProfile): string[] {
  return offersOf(profile)
    .map((offer) => offer.keyword.trim())
    .filter(Boolean);
}

/** The offer whose keyword this is, or -1. */
export function offerIndexOfKeyword(profile: BrandProfile, keyword: string): number {
  return offersOf(profile).findIndex((offer) => offer.keyword && same(offer.keyword, keyword));
}

/** The profile as a writer sees it with offer `index` chosen: that offer and keyword up front, the rest behind. */
export function withOffer(profile: BrandProfile, index: number | undefined): BrandProfile {
  const all = offersOf(profile);
  if (!index || index < 0 || index >= all.length) return profile;
  const chosen = all[index];
  return { ...profile, offer: chosen.offer, keyword: chosen.keyword, offers: all.filter((_, at) => at !== index) };
}

/**
 * The profile with the keyword she named for this one post ("Comment CASH")
 * in place of the offer's. Anything that is not one plain word is ignored,
 * and so is a profile written without her brand, which asks for no comment.
 */
export function withKeyword(profile: BrandProfile, keyword: string | undefined): BrandProfile {
  const word = keyword?.trim();
  if (!word || !isKeyword(word) || profile.brandOff === true) return profile;
  return { ...profile, keyword: word };
}

/* Words too common to tell two offers apart. */
const COMMON = new Set([
  "about", "after", "also", "been", "best", "from", "free", "have", "here", "into", "just", "like", "make", "more", "most",
  "only", "over", "post", "reel", "some", "that", "their", "them", "then", "they", "this", "what", "when", "will", "with",
  "your", "yours", "guide", "course", "program", "programme", "offer", "link",
]);

function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    out.add(raw);
    // "templates" in her message finds "template" in the offer, and the other way round.
    if (raw.length > 4 && raw.endsWith("s")) out.add(raw.slice(0, -1));
  }
  return out;
}

/**
 * Which offer a request is about, from her own words: the one whose keyword
 * she names, else the one sharing the most words with her message that no
 * other offer has. Nothing clear is the default, 0: a guess that sells the
 * wrong thing is worse than the offer she put first.
 */
export function pickOffer(profile: BrandProfile, text: string | null | undefined): number {
  const all = offersOf(profile);
  if (all.length < 2 || !text?.trim()) return 0;
  const said = words(text);
  // Her keyword, as a word on its own: "send me a COACH reel" names the COACH offer.
  const named = all.findIndex((offer) => offer.keyword && said.has(offer.keyword.toLocaleLowerCase()));
  if (named >= 0) return named;

  const meaningful = all.map((offer) => [...words(offer.offer)].filter((word) => word.length >= 4 && !COMMON.has(word)));
  const scores = meaningful.map((own, index) => {
    const others = new Set(meaningful.filter((_, at) => at !== index).flat());
    return new Set(own.filter((word) => !others.has(word) && said.has(word))).size;
  });
  const best = Math.max(...scores);
  if (best === 0 || scores.filter((score) => score === best).length > 1) return 0;
  return scores.indexOf(best);
}

/** `pickOffer` and `withOffer` together: the profile a request's writers see. */
export function profileForRequest(profile: BrandProfile, text: string | null | undefined): BrandProfile {
  return withOffer(profile, pickOffer(profile, text));
}

/**
 * The brief to hand the writers with offer `index` chosen. The brief was built
 * around the default offer, and a writer told to sell one thing while the
 * brief sells another would mix them: the offer section is that offer, and the
 * one-liner and positioning lines name it in place of the default.
 */
export function briefForOffer(brief: Brief | null, profile: BrandProfile, index: number | undefined): Brief | null {
  const all = offersOf(profile);
  if (!brief || !index || index < 0 || index >= all.length) return brief;
  const from = all[0];
  const to = all[index];
  const offerText = (text: string) => text.trim().replace(/[.!?]+$/, "");
  const swap = (text: string) => {
    let out = text;
    const old = offerText(from.offer);
    if (old) out = out.split(old).join(offerText(to.offer));
    if (from.keyword) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(from.keyword)}(?![\\p{L}\\p{N}])`, "gu"), to.keyword);
    return out;
  };
  const source = "Brand page, other offers";
  return {
    ...brief,
    offer: [
      { text: to.offer, source },
      { text: `They comment ${to.keyword} to get it.`, source },
    ],
    oneLiner: { ...brief.oneLiner, text: swap(brief.oneLiner.text) },
    positioningLines: brief.positioningLines.map((line) => ({ ...line, text: swap(line.text) })),
  };
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One line per offer for a prompt that has to know them all, the default marked. */
export function offerLines(profile: BrandProfile): string[] {
  return offersOf(profile).map((offer, index) => `${index === 0 ? "Default offer" : "Other offer"}: "${offer.offer}", comment keyword ${offer.keyword}`);
}

/**
 * The other offers from the Brand page's rows, checked: each row needs both
 * boxes or neither, a keyword is one word, and no keyword is used twice. The
 * default keyword is passed in so a row cannot repeat it. Rows come back in
 * the order typed, empty rows dropped.
 */
export function readOfferRows(rows: readonly Offer[], defaultKeyword: string): { offers: Offer[] } | { error: string } {
  const offers: Offer[] = [];
  const seen = [defaultKeyword.trim()].filter(Boolean);
  for (const [index, row] of rows.entries()) {
    const offer = row.offer.trim();
    const keyword = row.keyword.trim().toLocaleUpperCase();
    const name = `Offer ${index + 2}`;
    if (!offer && !keyword) continue;
    if (!offer) return { error: `${name} has a keyword but no offer. Say what it is, or clear the keyword.` };
    if (!keyword) return { error: `${name} needs its own comment keyword.` };
    if (!isKeyword(keyword)) return { error: `The keyword for ${name.toLowerCase()} has to be one word, letters and numbers only.` };
    if (seen.some((word) => same(word, keyword))) return { error: `${keyword} is used twice. Each offer needs its own keyword.` };
    seen.push(keyword);
    offers.push({ offer, keyword });
  }
  if (offers.length > MAX_OFFERS - 1) return { error: `Up to ${MAX_OFFERS} offers in all.` };
  return { offers };
}

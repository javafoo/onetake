/* How closely a post she points at is followed, read off her own words.
 *
 * EXACT: she said so ("exact", "word for word", "same words", "copy this
 * exactly") or quoted the words: they go on screen untouched.
 * ADAPT: she points at a screenshot's words ("with this hook", "this hook",
 * "like this", "for me"): every line is kept in place and only the personal
 * details (a name, a brand, a number, a life detail) are swapped for hers.
 * SHAPE: "make my version", "something like this but about…", or a screenshot
 * with no instruction: the post is a model for its shape only.
 *
 * The reader (a model) fills `exact`, `template` and `reference`; this puts
 * what it read in the field her words asked for, so the level never rests on
 * the model's reading of a phrase. Pure. */

export type HookLevel = "exact" | "adapt" | "shape" | "none";

const EXACT = /\b(exact(ly)?|word[- ]for[- ]word|verbatim|same words|as (it is|written))\b/i;
/* A quotation of two words or more is her words, given to be used. */
const QUOTED = /["“][^"“”]*\S\s+\S[^"“”]*["”]/;
const SHAPE = /\b(my (own )?version|version of (this|that|it)|something like (this|that) but|like (this|that) but|in my own words|inspired by)\b/i;
const ADAPT = /\b(with|use|using|take|same) (this|that|the same|these) (hook|text|title|cover|words|lines?)\b|\bthis hook\b|\blike (this|that)\b|\bfor me\b|\bcopy (this|that|it)\b|\bthese words\b/i;

export function hookLevel(message: string): HookLevel {
  if (EXACT.test(message) || QUOTED.test(message)) return "exact";
  if (SHAPE.test(message)) return "shape";
  if (ADAPT.test(message)) return "adapt";
  return "none";
}

export type HookFields = { exact?: string; template?: string; reference?: string };

/**
 * The reader's three fields, moved to the level her words chose. Adapt takes
 * the words the reader copied, whichever field it put them in; shape keeps
 * only the reference; exact keeps her words. With no instruction and a
 * screenshot, the screenshot is a model for shape; with no screenshot, what
 * she typed is hers and the reader's `exact` stands.
 */
export function routeHookFields(message: string, hasImages: boolean, fields: HookFields): HookFields {
  const level = hookLevel(message);
  const { exact, template, reference } = fields;
  switch (level) {
    case "exact":
      return { exact: exact ?? template, reference };
    case "adapt":
      return { template: template ?? exact, reference };
    case "shape":
      return { reference: reference ?? template ?? exact };
    case "none":
      return hasImages ? { reference: reference ?? template ?? exact } : { exact, template, reference };
  }
}

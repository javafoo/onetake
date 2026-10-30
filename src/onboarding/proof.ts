/* Rules for proof points. Every line here becomes a claim the writers may put
   in a caption, so a line has to be one short, checkable fact. A paragraph of
   speech once went in whole, including a revenue figure its author said in
   the same breath she did not want to promote. */

export const MAX_PROOF_POINTS = 8;
export const MAX_PROOF_CHARS = 140;

const CURRENCY = /(\$|€|£)\s?\d/;
const MONEY_WORD = /\b(dollars|bucks|usd|pounds|quid|gbp|euros?|eur|revenue|sales|income|profit|earned|earning|earnings|payout|paid me|mrr)\b/i;
const FIGURES = /\b(four|five|six|seven|multi)[- ]figures?\b/i;
const HAS_NUMBER = /\d/;

function isMoneyClaim(line: string): boolean {
  return CURRENCY.test(line) || FIGURES.test(line) || (HAS_NUMBER.test(line) && MONEY_WORD.test(line));
}

export type ProofProblem = { line: string; reason: string };

/** Lines that cannot be accepted as written, with the reason in plain words. */
export function proofProblems(points: string[]): ProofProblem[] {
  const problems: ProofProblem[] = [];
  for (const line of points) {
    if (line.length > MAX_PROOF_CHARS) {
      problems.push({ line, reason: `Keep each fact under ${MAX_PROOF_CHARS} characters: one number, one fact. Split it into lines.` });
    } else if (/[.!?]\s+\S.*[.!?]/.test(line)) {
      problems.push({ line, reason: "That is several sentences. One fact per line." });
    } else if (isMoneyClaim(line)) {
      problems.push({
        line,
        reason: "Money claims cannot be used in captions. Followers, views, posts, days: yes. Revenue, income or sales figures: no.",
      });
    }
  }
  return problems;
}

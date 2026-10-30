import { numbersIn } from "@/onboarding/compile";
import { typedMaterial, type InterviewState } from "@/onboarding/state";

/* The number check, applied one suggestion at a time.

   src/onboarding/compile.ts runs the same test over the finished brief and
   refuses to build one containing a number nobody typed. That is the backstop.
   This is the same rule moved forward to the moment it can still be a sentence
   rather than an error: if she taps an option with a follower count in it, she
   is told there and then, while the option is still on screen and deleting the
   number is one keystroke. */

export function untracedIn(state: InterviewState, text: string): string[] {
  const typed = new Set(typedMaterial(state).flatMap(numbersIn));
  return [...new Set(numbersIn(text).filter((number) => !typed.has(number)))];
}

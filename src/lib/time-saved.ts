/* The homepage's time-saved calculator, pure so its arithmetic can be tested.

   Today: every post costs her the minutes she says it takes (thinking of
   it, writing, making the picture or clip, editing). With OneTake: a week
   costs the voice note and a read-through of what comes back, whatever the
   number of posts. The figures shown are hers; the only assumption of ours is
   that weekly time, and it is stated on the page. */

/** Talking about the week, plus reading and approving what comes back. */
export const ONETAKE_MINUTES_PER_WEEK = 15;
export const WEEKS_PER_MONTH = 52 / 12;

export type TimeSavedInput = { postsPerWeek: number; minutesPerPost: number; hourlyValue: number };
export type TimeSaved = { hoursPerWeek: number; hoursPerMonth: number; valuePerMonth: number; daysPerYear: number };

export function timeSaved(input: TimeSavedInput): TimeSaved {
  const posts = Math.max(0, input.postsPerWeek);
  const today = posts * Math.max(0, input.minutesPerPost);
  const saved = Math.max(0, today - (posts > 0 ? ONETAKE_MINUTES_PER_WEEK : 0)) / 60;
  const month = saved * WEEKS_PER_MONTH;
  return {
    hoursPerWeek: round1(saved),
    hoursPerMonth: round1(month),
    valuePerMonth: Math.round(month * Math.max(0, input.hourlyValue)),
    // Eight-hour working days a year: the number that lands.
    daysPerYear: Math.round((saved * 52) / 8),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

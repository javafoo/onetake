/* The credit ledger, said in words a person recognises.

   The ledger stores a reason and a delta; neither means anything to the
   creator. "job_reserve −1" is "Photo generated −1". Pure, so the wording is
   tested rather than eyeballed. The reader that fetches the rows lives in
   `store.db.ts`; this only turns a row into a line. */

import type { LedgerReason } from "./store";

/** The job kinds a ledger row can point at. Anything else is treated as unknown. */
export type MovementJobKind = "image" | "clip" | "reel" | "carousel";

export interface Movement {
  id: string;
  delta: number;
  reason: LedgerReason;
  createdAt: Date;
  /** The kind of job this row belongs to, when it belongs to one. */
  jobKind: MovementJobKind | null;
}

const MADE: Record<MovementJobKind, string> = {
  image: "Photo generated",
  clip: "Clip generated",
  reel: "Reel assembled",
  carousel: "Carousel made",
};

const FAILED: Record<MovementJobKind, string> = {
  image: "Photo failed, credits returned",
  clip: "Clip failed, credits returned",
  reel: "Reel failed, credits returned",
  carousel: "Carousel failed, credits returned",
};

/** What happened, with no number attached. */
export function describeMovement(movement: Pick<Movement, "reason" | "delta" | "jobKind">): string {
  switch (movement.reason) {
    case "job_reserve":
      return movement.jobKind ? MADE[movement.jobKind] : "Generated";
    case "job_refund":
      return movement.jobKind ? FAILED[movement.jobKind] : "Did not finish, credits returned";
    case "free_grant":
      return "Free credits";
    case "adjustment":
      return movement.delta < 0 ? "Credits removed by support" : "Credits added by support";
  }
}

/** The number, signed and grouped: "−3", "+1,200". A true minus sign, not a hyphen.
    Zero carries no sign: there is nothing for one to point at. */
export function formatDelta(delta: number): string {
  if (delta === 0) return "0";
  return `${delta < 0 ? "−" : "+"}${Math.abs(delta).toLocaleString("en-US")}`;
}

/** One whole line: "Photo generated −1". */
export function movementLine(movement: Pick<Movement, "reason" | "delta" | "jobKind">): string {
  return `${describeMovement(movement)} ${formatDelta(movement.delta)}`;
}

/**
 * A calendar day, written out: "3 Oct 2026". Fixed to UTC and to one format so
 * the server and the browser render the same string and React does not warn
 * about a mismatch it cannot fix.
 */
export function formatDay(at: Date): string {
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

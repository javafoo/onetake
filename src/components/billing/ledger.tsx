import { describeMovement, formatDay, formatDelta } from "@/billing/history";
import type { Movement } from "@/billing/history";
import { EmptyState } from "@/components/ui";

/* The last few credit movements, one line each: what happened, when, and how
   many credits it moved. Every word comes from `history.ts`, which is tested,
   so nothing here can quietly start saying "job_reserve". */

export function LedgerList({ movements }: { movements: Movement[] }) {
  if (movements.length === 0) {
    return (
      <EmptyState title="Nothing has moved yet">
        Credits arriving, and every photo and clip you generate, will be listed here.
      </EmptyState>
    );
  }

  return (
    <ol className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      {movements.map((movement, index) => (
        <li
          key={movement.id}
          className={`flex min-h-14 items-center justify-between gap-4 px-4 py-3 sm:px-5 ${
            index > 0 ? "border-t border-line" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm text-ink">{describeMovement(movement)}</span>
            <span className="block text-xs text-muted">{formatDay(movement.createdAt)}</span>
          </span>
          <span
            className={`shrink-0 text-sm font-semibold tabular-nums ${movement.delta < 0 ? "text-ink-soft" : "text-good"}`}
          >
            {formatDelta(movement.delta)}
          </span>
        </li>
      ))}
    </ol>
  );
}

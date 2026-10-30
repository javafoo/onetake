"use client";

import type { OfferView } from "./thread-view";
import { Button, creditWord } from "@/components/ui";

/* Something that costs credits, offered and waiting for her tap. The button
   says what it does and what it costs; nothing is spent until it is pressed,
   and a second tap cannot charge twice (the server's request id sees to that). */

export function OfferCard({ offer, busy, onAccept, onDecline }: { offer: OfferView; busy: boolean; onAccept: () => void; onDecline: () => void }) {
  return (
    <div className="rounded-lg border border-spend-line bg-spend-soft/40 p-3">
      <p className="text-sm text-ink">{offer.label}</p>
      {offer.status === "open" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="spend" size="sm" disabled={busy} onClick={onAccept}>
            {busy ? "Starting…" : `Make it, ${creditWord(offer.credits)}`}
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onDecline}>
            Not now
          </Button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-muted">{offer.status === "accepted" ? `Started. ${creditWord(offer.credits)}.` : "Not made. Nothing was charged."}</p>
      )}
    </div>
  );
}

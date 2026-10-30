import type { StartJobRequest } from "@/jobs";

/* The thread and the stream, as docs/AGENT-V2.md 3.7 fixes them. Browser-safe:
   the chat imports these, so nothing here may pull in server code (the job
   request is a type only).

   Two optional fields were added to 3.7, both additive: `thoughtSignature` on
   a tool message, because Gemini 3 refuses a history whose function calls lost
   the signature it gave them, and `draftId` on a job, so the chat can heart a
   set or a reel by its draft. */

export type ThreadMessage =
  | { role: "her"; text: string; at: string; requestId: string; material?: { photos: string[]; clip?: string }; /** Screenshots she pasted, read once and not kept: only their number stays. */ screenshots?: number }
  | { role: "agent"; text: string; at: string }
  | { role: "tool"; name: string; label: string; args: unknown; result: unknown; at: string; thoughtSignature?: string }
  | { role: "offer"; offer: Offer; at: string }
  | { role: "job"; jobId: string; kind: string; credits: number; at: string; draftId?: string };

export type Offer = { id: string; label: string; credits: number; request: StartJobRequest; status: "open" | "accepted" | "declined" };

/** What the SSE stream sends. One JSON object per `data:` line. */
export type TurnEvent =
  | { type: "text"; delta: string }
  | { type: "tool"; label: string } // "Searching the playbooks", "Reading your library"
  | { type: "offer"; offer: Omit<Offer, "request"> } // the button: label + credits
  | { type: "job"; jobId: string; kind: string; credits: number; draftId?: string }
  | { type: "fact"; text: string } // "Remembered: ..."
  | { type: "error"; message: string }
  | { type: "done"; threadId: string };

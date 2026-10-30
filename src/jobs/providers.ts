import type { ClipState } from "@/ai/clips";

import type { CarouselJobInput, ClipJobInput, ImageJobInput, JobRecord, ReelJobInput, TextPhotoJobInput } from "./types";

/* Everything a job does to the outside world, behind one interface.

   The state machine in `runner.ts` decides what happens next and the store
   records it; this is the only place that calls a model, downloads bytes or
   runs ffmpeg. Keeping it separate is what lets the whole machine be tested
   with fakes and no network. `providers.live.ts` is the real one. */

export interface StepOutcome {
  mediaIds: string[];
  message: string;
  /**
   * What the provider actually billed us, replacing the estimate we reserved.
   * Left out when the estimate is the best figure there is — an agent run's
   * model calls were estimated up front and are never billed as one line — so
   * the reserved amount stands and keeps counting toward the daily cap.
   */
  costUsd?: number;
  meta?: Record<string, unknown>;
}

export interface SubmittedClip {
  provider: string;
  requestId: string;
  statusUrl: string;
  /** The price we now expect, once the real duration is known. */
  costUsd: number;
}

export interface JobProviders {
  /** One house-style photo, judged and stored. Runs to completion. */
  generateImage(job: JobRecord, input: ImageJobInput): Promise<StepOutcome>;

  /** Hand the clip to its video service (Higgsfield, or Google for Omni) and return its request id. Does not wait. */
  submitClip(job: JobRecord, input: ClipJobInput): Promise<SubmittedClip>;

  /** Ask the video service how the clip is going. One question, no waiting. */
  clipStatus(job: JobRecord): Promise<ClipState>;

  /** Download the finished clip and store it. */
  storeClip(job: JobRecord, input: ClipJobInput, videoUrl: string): Promise<StepOutcome>;

  /** Render the hook over the clip with ffmpeg and store the reel. Runs to completion. */
  assembleReel(job: JobRecord, input: ReelJobInput): Promise<StepOutcome>;

  /** Write the spec, check it, find the faces and draw the slides. Runs to completion. */
  renderCarousel(job: JobRecord, input: CarouselJobInput): Promise<StepOutcome>;

  /** Draw her words on one of her photos and store the result beside it. Runs to completion. */
  renderTextPhoto(job: JobRecord, input: TextPhotoJobInput): Promise<StepOutcome>;

  /** Undo a stored output that lost the race to another poll, so only one survives. */
  discardMedia(userId: string, mediaIds: string[]): Promise<void>;
}

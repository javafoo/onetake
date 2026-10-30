"use client";

import { useEffect, useState, useTransition } from "react";

import type { ActionState, MotionIdeasState, PolishState } from "@/app/actions";
import { ActionForm } from "@/components/action-form";
import { Fieldset, MediaChoice, Textarea } from "@/components/ui";
import { buttonClass, creditWord } from "@/components/ui/button";
import { ResultMessage } from "@/components/ui/message";
import {
  CLIP_MODELS,
  CLIP_RATIOS,
  DEFAULT_CLIP_MODEL,
  DEFAULT_CLIP_RATIO,
  framingNote,
  ratiosFor,
  type ClipAspectRatio,
  type ClipModel,
} from "@/content/clip-options";
import { MOTION_PRESETS, type Dropped } from "@/content/motion";

/* The Animate drawer.
 *
 * A client component for two reasons now. The first is unchanged: the price on
 * the button has to be the price of what is currently selected, and both
 * numbers come from `creditsFor` on the server (see the Library page) so
 * nothing here decides what anything costs.
 *
 * The second is the prompt builder. Tapping a photo asks the server what would
 * look good on *that* photo; tapping a suggestion, a preset or "Check this
 * movement" sends the rough idea through polish; and the result is shown for
 * review — with whatever the rules took out of it, and why — before the brass
 * button is ever pressed. Both of those calls are free and neither starts a
 * job, which is the point: the only thing that spends credits here is the last
 * button, and by the time she reaches it she has read the sentence that will
 * be sent.
 */

export type AnimatablePhoto = {
  id: string;
  src: string;
  width: number | null;
  height: number | null;
  /** Suggestions already on the row. Empty means this photo has not been looked at. */
  ideas: string[];
};

type Review = { idea: string; motion: string; dropped: Dropped[] };

const CHIP = "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm transition-colors cursor-pointer";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

export function AnimateForm({
  photos,
  credits,
  action,
  folder,
  defaultPhotoId,
  polish,
  suggest,
}: {
  photos: AnimatablePhoto[];
  /** What each model costs, from `creditsFor({ kind: "clip", model, seconds: 5 })`. */
  credits: Record<ClipModel, number>;
  action: (state: ActionState, form: FormData) => Promise<ActionState>;
  /** The folder that is open, so the clip is filed there. Absent: filed with its photo. */
  folder?: string;
  /** Already ticked on arrival, for the viewer's "Animate this photo". */
  defaultPhotoId?: string;
  /** Free: rewrites a rough idea into the line that will be sent. */
  polish: (state: PolishState, form: FormData) => Promise<PolishState>;
  /** Free: three movements that suit one photo, looked at once and remembered. */
  suggest: (mediaId: string) => Promise<MotionIdeasState>;
}) {
  const [model, setModel] = useState<ClipModel>(DEFAULT_CLIP_MODEL);
  const [ratio, setRatio] = useState<ClipAspectRatio>(DEFAULT_CLIP_RATIO);
  const [photoId, setPhotoId] = useState<string | null>(defaultPhotoId ?? null);
  const [measured, setMeasured] = useState<Record<string, { width: number; height: number }>>({});

  /* Suggestions are per photo and are kept for the life of the drawer, so
     tapping back to a photo she already looked at is instant and asks the
     server nothing. The server's own cache is what makes it free the *next*
     time the page is opened. */
  const [suggested, setSuggested] = useState<Record<string, string[]>>(
    Object.fromEntries(photos.filter((photo) => photo.ideas.length > 0).map((photo) => [photo.id, photo.ideas])),
  );
  /* True from the first paint when a tile arrives ticked and has not been
     looked at: the effect below asks for its suggestions straight away. */
  const [looking, setLooking] = useState(
    Boolean(defaultPhotoId && !photos.some((photo) => photo.id === defaultPhotoId && photo.ideas.length > 0)),
  );
  const [idea, setIdea] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [, startLook] = useTransition();

  const photo = photos.find((item) => item.id === photoId) ?? null;
  const size = photo && photo.width && photo.height
    ? { width: photo.width, height: photo.height }
    : (photoId && measured[photoId]) || null;
  const ideas = (photoId && suggested[photoId]) || [];

  /* Photos generated before the job started recording their size have no
     width or height on the row, and that is most of an existing library. The
     browser already has the file — it is the tile that was just tapped — so
     asking it how big that file is costs nothing and turns "your photo is
     cropped" into "about a quarter of this photo is trimmed off the sides". */
  function measure(id: string) {
    const known = photos.find((item) => item.id === id);
    if (!known || (known.width && known.height) || measured[id]) return;
    const probe = new window.Image();
    probe.onload = () =>
      setMeasured((seen) => ({ ...seen, [id]: { width: probe.naturalWidth, height: probe.naturalHeight } }));
    probe.src = known.src;
  }

  function look(id: string) {
    startLook(async () => {
      const result = await suggest(id);
      setLooking(false);
      if (!result) return;
      if (result.ok) setSuggested((seen) => ({ ...seen, [result.mediaId]: result.ideas }));
      else setProblem(result.message);
    });
  }

  function choose(id: string) {
    setPhotoId(id);
    measure(id);
    /* A polished line belongs to the photo it was written for: "she lifts the
       iced coffee" is nonsense on a photo with no coffee in it. Switching
       tiles clears the review rather than carrying it across. */
    setReview(null);
    setConfirmed(false);
    setProblem(null);
    if (suggested[id]) return;
    setLooking(true);
    look(id);
  }

  /* Arriving from the viewer's "Animate this photo" ticks a tile without a
     tap, so the tap's work — measuring it and asking for its suggestions —
     is done once on arrival. `looking` was already set at first paint. */
  useEffect(() => {
    if (!defaultPhotoId) return;
    measure(defaultPhotoId);
    if (!suggested[defaultPhotoId]) look(defaultPhotoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on arrival only
  }, []);

  function check(rough: string) {
    if (!photoId) {
      setProblem("Tap the photo the movement starts from first.");
      return;
    }
    setIdea(rough);
    setProblem(null);
    setConfirmed(false);
    startCheck(async () => {
      const form = new FormData();
      form.set("idea", rough);
      form.set("image", photoId);
      const result = await polish(null, form);
      if (!result) return;
      if (result.ok) setReview({ idea: result.idea, motion: result.motion, dropped: result.dropped });
      else {
        setReview(null);
        setProblem(result.message);
      }
    });
  }

  return (
    <ActionForm
      action={action}
      submitLabel="Animate photo"
      pendingLabel="Generating the clip…"
      cost={credits[model]}
      disabled={!confirmed}
      hint={
        confirmed
          ? "Two to four minutes."
          : "Pick a photo and a movement first. Checking the movement is free."
      }
      className="space-y-6"
    >
      {folder && <input type="hidden" name="folder" value={folder} />}
      <Fieldset
        legend="Start photo"
        hint={defaultPhotoId ? "The photo you opened is ticked. Tap another to change it." : "Tap the photo the movement starts from."}
      >
        {/* Capped and scrolled past two rows: a library of eighty photos must
            not push the movement box and the price off the bottom of a phone. */}
        <ul className={`grid grid-cols-3 gap-2.5 sm:grid-cols-6 ${photos.length > 12 ? "max-h-72 overflow-y-auto rounded-lg border border-line bg-sunken/50 p-2 sm:max-h-80" : ""}`}>
          {photos.map((item, index) => (
            <li key={item.id}>
              <MediaChoice
                name="image"
                value={item.id}
                kind="image"
                src={item.src}
                ratio="3:4"
                label={`Photo ${index + 1}`}
                defaultChecked={item.id === defaultPhotoId}
                onChange={choose}
                required
              />
            </li>
          ))}
        </ul>
      </Fieldset>

      <section>
        <h3 className="text-sm font-medium text-ink">The movement</h3>
        <p className="mt-1 text-xs text-muted">One small, slow thing she does.</p>

        {/* Suggestions for this photo. Nothing here until a photo is chosen:
            "good for this photo" is a promise that needs a photo. */}
        {photoId && (
          <div className="mt-4">
            <p className="eyebrow text-muted">Good on this photo</p>
            {looking && ideas.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Looking at this photo…</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {ideas.map((line) => (
                  <li key={line}>
                    <button
                      type="button"
                      onClick={() => check(line)}
                      disabled={checking}
                      className="w-full rounded-lg border border-line-strong bg-surface px-3.5 py-3 text-left text-sm text-ink transition-colors hover:border-ink hover:bg-sunken/40 disabled:opacity-55"
                    >
                      {line}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* The six that work on anything. Below the per-photo ones on purpose:
            they are the floor, not the recommendation. */}
        <div className="mt-4">
          <p className="eyebrow text-muted">Always works</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {MOTION_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => check(preset.idea)}
                disabled={checking}
                className={`${CHIP} ${CHIP_OFF} disabled:opacity-55`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="mt-5 block">
          <span className="block text-sm font-medium text-ink">Or your own idea</span>
          <span className="mt-1 block text-xs text-muted">Rough is fine. We tidy it up.</span>
          {/* Three rows, not two: the sentence this is built for — the founder's
              four-beat one — was cut off mid-word in a two-row box, which is
              the worst place to hide what you are about to send. */}
          <Textarea
            rows={3}
            className="mt-2"
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            placeholder="She lifts the iced coffee, takes a small sip, then lowers it with a soft smile."
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => check(idea)}
            disabled={checking || idea.trim().length < 8}
            className={buttonClass("quiet", "md")}
          >
            {checking ? "Checking…" : "Check this movement"}
          </button>
          <span className="text-xs text-muted">Free. No credits until you press Animate.</span>
        </div>

        {problem && (
          <div className="mt-3">
            <ResultMessage ok={false}>{problem}</ResultMessage>
          </div>
        )}

        {/* The review. Everything that was taken out of her idea is named here,
            in her own words, while the button below still says three credits. */}
        {review && (
          <div
            aria-live="polite"
            className={`mt-4 rounded-lg border p-3.5 ${confirmed ? "border-good/30 bg-good-soft" : "border-line-strong bg-sunken/40"}`}
          >
            <p className="eyebrow text-muted">{confirmed ? "This is what will be sent" : "What we would send"}</p>
            <p className="mt-1.5 text-sm text-ink">{review.motion}</p>

            {review.dropped.length > 0 && (
              <ul className="mt-3 space-y-1 border-t border-line pt-2.5">
                {review.dropped.map((item) => (
                  <li key={item.note} className="text-xs text-ink-soft">
                    {item.note}
                  </li>
                ))}
              </ul>
            )}

            {confirmed ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmed(false);
                  setIdea(review.motion);
                  setReview(null);
                }}
                className={`${buttonClass("ghost", "sm")} mt-3 -ml-3`}
              >
                Change it
              </button>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setConfirmed(true)} className={buttonClass("primary", "sm")}>
                  Use this
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIdea(review.motion);
                    setReview(null);
                  }}
                  className={buttonClass("quiet", "sm")}
                >
                  Edit
                </button>
              </div>
            )}
          </div>
        )}

        {/* What the server actually animates, and the words it came from. Both
            are stored on the job, so a clip that came out wrong can be traced
            back to what she asked for. */}
        <input type="hidden" name="motion" value={confirmed && review ? review.motion : ""} />
        <input type="hidden" name="idea" value={confirmed && review ? review.idea : ""} />
      </section>

      <fieldset>
        <legend className="block text-sm font-medium text-ink">Video model</legend>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          {CLIP_MODELS.map((option) => (
            <label
              key={option.id}
              className={`block cursor-pointer rounded-lg border p-3.5 transition-colors ${
                option.id === model ? "border-accent ring-1 ring-accent bg-surface" : "border-line-strong bg-surface hover:border-ink"
              }`}
            >
              <input
                type="radio"
                name="model"
                value={option.id}
                checked={option.id === model}
                onChange={() => {
                  setModel(option.id);
                  // Omni makes two shapes only; a shape it cannot make goes back to the reel's.
                  if (!ratiosFor(option.id).includes(ratio)) setRatio(DEFAULT_CLIP_RATIO);
                }}
                className="sr-only"
              />
              <span className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-ink">{option.title}</span>
                <span className="text-2xs font-semibold text-spend">{creditWord(credits[option.id])}</span>
              </span>
              <span className="mt-1 block text-xs text-muted">{option.blurb}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="block text-sm font-medium text-ink">Shape</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {CLIP_RATIOS.filter((option) => ratiosFor(model).includes(option.id)).map((option) => (
            <label key={option.id} className={`${CHIP} ${option.id === ratio ? CHIP_ON : CHIP_OFF}`}>
              <input
                type="radio"
                name="aspectRatio"
                value={option.id}
                checked={option.id === ratio}
                onChange={() => setRatio(option.id)}
                className="sr-only"
              />
              {option.id}
              <span className={`ml-2 text-xs ${option.id === ratio ? "text-canvas/70" : "text-muted"}`}>{option.note}</span>
            </label>
          ))}
        </div>
        {/* Said before the button is pressed, because a crop throws part of a
            photo away and neither model will letterbox it back. */}
        <p className="mt-2.5 text-xs text-muted">{framingNote(size, ratio)}</p>
      </fieldset>
    </ActionForm>
  );
}

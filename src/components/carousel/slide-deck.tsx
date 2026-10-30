"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { editSlideAction, swapPhotoAction } from "@/app/carousels/actions";
import { ActionForm } from "@/components/action-form";
import { Field, Input, Textarea } from "@/components/ui/field";
import { RATIO, type Ratio } from "@/components/ui/media";

/* The set, as you swipe it.

   A horizontal strip with scroll snapping, which is how a phone already works:
   no carousel library, no drag maths, no touch handlers to get wrong. The
   browser does the swiping; this only watches where it stopped, so the panel
   underneath edits the slide you are actually looking at. On a desktop the
   arrows and the left and right keys do the same job. */

export type DeckSlide = {
  index: number;
  mediaId: string;
  src: string;
  type: "cover" | "paper" | "keyword" | "split" | "line" | "grid";
  /** What is on it now, as the fields that can be edited. */
  titleLines: string;
  accent: string;
  sub: string;
  body: string;
  keyword: string;
  promise: string;
  /** Split slides: the line on each photo. */
  top: string;
  bottom: string;
  /** Line slides: the one line across the photo. */
  text: string;
  /** Grid slides: the title in the accent face. */
  headline: string;
  /** Words currently set apart in the title. */
  emphasis: string[];
  /** How many photos are on the slide: 0, 1, 2 for a split, 4 for a grid. */
  photoCount: number;
};

export type DeckPhoto = { id: string; url: string };

const TYPE_LABEL: Record<DeckSlide["type"], string> = {
  cover: "Photo cover",
  paper: "Paper slide",
  keyword: "Comment slide",
  split: "Half and half",
  line: "Photo and one line",
  grid: "Four-photo cover",
};

/** Which photo on the slide a swap replaces, in the words of where it sits. */
const SLOT_LABEL: Record<number, string[]> = {
  2: ["Top photo", "Bottom photo"],
  4: ["Top left", "Top right", "Bottom left", "Bottom right"],
};

/** The words on a slide as one line, for the image's alt text. */
function slideWords(entry: DeckSlide): string {
  switch (entry.type) {
    case "keyword":
      return entry.keyword;
    case "split":
      return `${entry.top} / ${entry.bottom}`;
    case "line":
      return entry.text;
    case "grid":
      return [entry.headline, entry.sub.replace(/\*/g, "")].filter(Boolean).join(", ");
    default:
      return entry.titleLines.replace(/\n/g, " ");
  }
}

/* Room before the first slide and after the last, so each end can scroll to
   the middle too. Without it the strip stops as soon as the last slide is in
   view, the middle never reaches slides six to eight of an eight-slide set,
   and the panel below cannot edit them. Half of what a slide leaves free, at
   each of the slide's widths, less the gap beside it. */
const END_SPACER = "shrink-0 w-[calc(12%-0.75rem)] sm:w-[calc(27%-0.75rem)] lg:w-[calc(34.5%-0.75rem)]";

/** The strip's middle, on screen. */
function stripMiddle(element: HTMLElement): number {
  return element.getBoundingClientRect().left + element.clientLeft + element.clientWidth / 2;
}

/** The slides in the strip, without the spacers at its ends. */
function slidesIn(element: HTMLElement): HTMLElement[] {
  return [...element.querySelectorAll<HTMLElement>(":scope > [data-slide]")];
}

export function SlideDeck({
  draftId,
  slides,
  ratio,
  photos,
}: {
  draftId: string;
  slides: DeckSlide[];
  ratio: Ratio;
  photos: DeckPhoto[];
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);

  /* Which slide is in the middle of the strip. Measured from the children
     rather than from scrollLeft, because the slides are not the width of the
     strip on a wide screen. Both sides are measured on screen: `offsetLeft`
     counts from the page, not the strip, and was off by the sidebar's width,
     which put the middle a slide and a half to the left of where it is. */
  const track = useCallback(() => {
    const element = strip.current;
    if (!element) return;
    const middle = stripMiddle(element);
    let nearest = 0;
    let best = Infinity;
    for (const [index, child] of slidesIn(element).entries()) {
      const box = child.getBoundingClientRect();
      const distance = Math.abs(box.left + box.width / 2 - middle);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    }
    setCurrent(nearest);
  }, []);

  useEffect(() => {
    const element = strip.current;
    if (!element) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(track);
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    track();
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", onScroll);
    };
  }, [track]);

  const go = useCallback((index: number) => {
    const element = strip.current;
    const child = element ? slidesIn(element)[index] : undefined;
    if (!element || !child) return;
    const box = child.getBoundingClientRect();
    element.scrollTo({ left: element.scrollLeft + box.left + box.width / 2 - stripMiddle(element), behavior: "smooth" });
  }, []);

  const slide = slides[current] ?? slides[0];
  if (!slide) return null;

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
        <div
          ref={strip}
          role="group"
          aria-label="Slides"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") {
              event.preventDefault();
              go(Math.min(slides.length - 1, current + 1));
            }
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              go(Math.max(0, current - 1));
            }
          }}
          className="no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth p-3"
        >
          <div aria-hidden className={END_SPACER} />
          {slides.map((entry, index) => (
            <figure
              key={entry.mediaId}
              data-slide
              className={`w-[76%] shrink-0 snap-center sm:w-[46%] lg:w-[31%] ${
                index === current ? "" : "opacity-60 transition-opacity"
              }`}
            >
              <button
                type="button"
                onClick={() => go(index)}
                aria-label={`Slide ${index + 1}${index === current ? ", the one being edited" : ""}`}
                aria-current={index === current ? "true" : undefined}
                className={`block w-full overflow-hidden rounded-lg border bg-sunken ${
                  index === current ? "border-accent ring-2 ring-accent" : "border-line"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={entry.src}
                  alt={`Slide ${index + 1}: ${slideWords(entry)}`}
                  className={`block w-full object-cover ${RATIO[ratio]}`}
                />
              </button>
              <figcaption className="mt-1.5 flex items-center justify-between gap-2 text-2xs text-muted">
                <span>
                  {index + 1} · {TYPE_LABEL[entry.type]}
                </span>
                <a
                  href={entry.src}
                  download={`slide-${String(index + 1).padStart(2, "0")}.png`}
                  className="underline-offset-2 hover:text-accent hover:underline"
                >
                  Download
                </a>
              </figcaption>
            </figure>
          ))}
          <div aria-hidden className={END_SPACER} />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-3 py-2">
          <button
            type="button"
            onClick={() => go(Math.max(0, current - 1))}
            disabled={current === 0}
            className="grid size-9 place-items-center rounded-md border border-line-strong bg-surface text-ink disabled:opacity-40"
            aria-label="Previous slide"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3.5">
              <path d="M8 1 3 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
          <ol className="flex flex-1 items-center justify-center gap-1.5">
            {slides.map((entry, index) => (
              <li key={entry.mediaId}>
                <button
                  type="button"
                  onClick={() => go(index)}
                  aria-label={`Go to slide ${index + 1}`}
                  className={`block size-2 rounded-full ${index === current ? "bg-accent" : "bg-line-strong"}`}
                />
              </li>
            ))}
          </ol>
          <button
            type="button"
            onClick={() => go(Math.min(slides.length - 1, current + 1))}
            disabled={current === slides.length - 1}
            className="grid size-9 place-items-center rounded-md border border-line-strong bg-surface text-ink disabled:opacity-40"
            aria-label="Next slide"
          >
            <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3.5">
              <path d="m4 1 5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-6">
        <h2 className="font-display text-lg text-ink">
          Edit slide {slide.index + 1}
          <span className="ml-2 text-sm font-normal text-muted">{TYPE_LABEL[slide.type]}</span>
        </h2>

        {/* Keyed by slide: moving to another slide starts with its own words,
            and never with the last slide's result message. */}
        <ActionForm
          key={slide.index}
          action={editSlideAction}
          submitLabel="Save and redraw"
          pendingLabel="Redrawing…"
          hint="Free."
          className="mt-4 space-y-4"
        >
          <input type="hidden" name="id" value={draftId} />
          <input type="hidden" name="index" value={slide.index} />

          {slide.type === "split" ? (
            <>
              <Field label="Line on the top photo" hint="Short. It reads as a pair with the line below.">
                <Input name="top" defaultValue={slide.top} required maxLength={80} />
              </Field>
              <Field label="Line on the bottom photo" hint="The other half: the fix, the answer, or the rest of the sentence.">
                <Input name="bottom" defaultValue={slide.bottom} required maxLength={80} />
              </Field>
            </>
          ) : slide.type === "line" ? (
            <Field label="The line" hint="One line across the photo.">
              <Input name="text" defaultValue={slide.text} required maxLength={140} />
            </Field>
          ) : slide.type === "grid" ? (
            <>
              <Field label="Title" hint="A few words, in big type. A longer title wraps onto a second line instead of shrinking.">
                <Input name="headline" defaultValue={slide.headline} required maxLength={60} />
              </Field>
              <Field label="Line under the title" hint="Smaller type. Optional. Wrap one word in *asterisks* to set it in a serif italic.">
                <Input name="sub" defaultValue={slide.sub} maxLength={80} />
              </Field>
            </>
          ) : slide.type === "keyword" ? (
            <>
              <Field label="The keyword" hint="It has to be the comment keyword on your Brand page.">
                <Input name="keyword" defaultValue={slide.keyword} required maxLength={24} />
              </Field>
              <Field label="What they get for commenting it" hint="One line.">
                <Input name="promise" defaultValue={slide.promise} required maxLength={120} />
              </Field>
            </>
          ) : (
            <>
              <Field
                label="Title"
                hint="One line per row, up to four lines. Wrap a word in *asterisks* to set it apart in the look's emphasis font."
                aside={slide.emphasis.length ? `Set apart: ${slide.emphasis.join(", ")}` : "Nothing set apart"}
              >
                <Textarea name="titleLines" rows={4} defaultValue={slide.titleLines} required />
              </Field>
              <Field label="Accent line" hint="The payoff, in the look's accent font. Leave it empty for none.">
                <Input name="accent" defaultValue={slide.accent} maxLength={120} />
              </Field>
              {slide.type === "cover" ? (
                <Field label="Sub line" hint="One plain sentence under the title. Optional.">
                  <Input name="sub" defaultValue={slide.sub} maxLength={140} />
                </Field>
              ) : (
                <Field label="The sentence" hint="One plain sentence, the thing the title claims.">
                  <Textarea name="body" rows={2} defaultValue={slide.body} required maxLength={240} />
                </Field>
              )}
            </>
          )}
        </ActionForm>

        {slide.photoCount > 0 && photos.length > 0 && (
          <details className="group mt-5 border-t border-line pt-4">
            <summary className="flex min-h-11 list-none items-center gap-2 text-sm font-medium text-ink-soft">
              Put a different photo on this slide
              <svg viewBox="0 0 12 8" aria-hidden="true" className="size-3 text-muted transition-transform group-open:rotate-180">
                <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </summary>
            <ActionForm
              key={`photo-${slide.index}`}
              action={swapPhotoAction}
              submitLabel="Use this photo"
              pendingLabel="Finding the face and redrawing…"
              variant="quiet"
              hint="Free. The title moves out of the way of her face."
              className="mt-3 space-y-3"
            >
              <input type="hidden" name="id" value={draftId} />
              <input type="hidden" name="index" value={slide.index} />
              {SLOT_LABEL[slide.photoCount] && (
                <fieldset className="flex flex-wrap gap-2">
                  <legend className="mb-1.5 text-sm text-ink-soft">Which photo to replace</legend>
                  {SLOT_LABEL[slide.photoCount].map((label, slot) => (
                    <label key={label} className="cursor-pointer">
                      <input type="radio" name="slot" value={slot} defaultChecked={slot === 0} className="peer sr-only" />
                      <span className="inline-flex min-h-9 items-center rounded-md border border-line-strong bg-surface px-3 text-sm text-ink peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                        {label}
                      </span>
                    </label>
                  ))}
                </fieldset>
              )}
              <fieldset>
                <legend className="sr-only">Photo for slide {slide.index + 1}</legend>
                <ul className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-lg border border-line bg-sunken/50 p-2 sm:grid-cols-6 lg:grid-cols-8">
                  {photos.map((photo, index) => (
                    <li key={photo.id}>
                      <label className="block cursor-pointer">
                        <input type="radio" name="photo" value={photo.id} required className="peer sr-only" />
                        <span className="sr-only">Photo {index + 1}</span>
                        <span className="block overflow-hidden rounded-md border border-line peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.url} alt="" loading="lazy" className="aspect-[3/4] w-full object-cover" />
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            </ActionForm>
          </details>
        )}
      </section>
    </>
  );
}

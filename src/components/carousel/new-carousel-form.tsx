"use client";

import { useActionState, useMemo, useState } from "react";

import { createCarouselAction, type ActionState } from "@/app/carousels/actions";
import { FORMAT_LABEL, LAYOUT_LABEL, SKELETON_LABEL } from "@/carousel/skeletons";
import type { Layout } from "@/carousel/spec";
import type { Skeleton } from "@/carousel/write";
import { buttonClass } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { ResultMessage } from "@/components/ui/message";
import { CheckIcon } from "@/components/ui/icons";

/* The one form that makes a set.

   It is a client component for one reason: the style tiles are real renders,
   and retuning a colour has to redraw the tile she is looking at. Everything
   else is a plain form control with a name, so the whole thing still submits
   as a form and the server action reads it as FormData. */

export type KitChoice = {
  id: string;
  name: string;
  character: string;
  /** Only the three colours she is offered, in the kit's own values. */
  paper: string;
  ink: string;
  accent: string;
  private: boolean;
};

export type PhotoChoice = { id: string; url: string; kind: "image" | "reference" };

export type TopicChoice = { topic: string; why: string };

const SKELETONS: Skeleton[] = ["list", "case_study", "statement", "tutorial"];
const COLOURS = [
  { key: "paper", label: "Paper" },
  { key: "ink", label: "Ink" },
  { key: "accent", label: "Accent" },
] as const;

/** A labelled group of choice cards. One row on a phone, two or four wide after that. */
function Choices({ legend, hint, columns, children }: { legend: string; hint?: string; columns: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="font-display text-lg text-ink">{legend}</legend>
      {hint && <p className="mt-1 max-w-prose text-sm text-muted">{hint}</p>}
      <div className={`mt-3 grid gap-2.5 ${columns}`}>{children}</div>
    </fieldset>
  );
}

/** A radio dressed as a card: the whole card is the target, checked is claret. */
function CardChoice({
  name,
  value,
  checked,
  onChange,
  title,
  line,
  aside,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: string;
  line: string;
  aside?: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-lg border p-3.5 transition-colors ${
        checked ? "border-accent bg-accent-soft" : "border-line-strong bg-surface hover:border-ink-soft"
      }`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
          checked ? "border-accent bg-accent" : "border-line-strong bg-surface"
        }`}
      >
        {checked && <span className="size-1.5 rounded-full bg-white" />}
      </span>
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={`text-sm font-semibold ${checked ? "text-accent" : "text-ink"}`}>{title}</span>
          {aside && <span className="text-2xs text-muted">{aside}</span>}
        </span>
        <span className="mt-0.5 block text-xs text-pretty text-muted">{line}</span>
      </span>
    </label>
  );
}

export function NewCarouselForm({
  kits,
  photos,
  topics,
  defaultKit,
}: {
  kits: KitChoice[];
  photos: PhotoChoice[];
  topics: TopicChoice[];
  defaultKit: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: ActionState, form: FormData) => {
      // One id per submission, attached before the request leaves the browser,
      // so a retried delivery renders one set rather than two.
      form.set("requestId", crypto.randomUUID());
      return createCarouselAction(previous, form);
    },
    null,
  );

  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"carousel" | "story">("carousel");
  const [skeleton, setSkeleton] = useState<Skeleton>("case_study");
  const [layout, setLayout] = useState<Layout>("mixed");
  const [kitId, setKitId] = useState(defaultKit);
  const [chosen, setChosen] = useState<string[]>([]);
  const [slides, setSlides] = useState("");
  const [tuned, setTuned] = useState<Record<string, string>>({});

  const kit = useMemo(() => kits.find((entry) => entry.id === kitId) ?? kits[0], [kits, kitId]);

  /* Switching format changes which slide counts are legal, so a count chosen
     for a carousel does not follow her into a story. */
  function chooseFormat(next: "carousel" | "story") {
    setFormat(next);
    setSlides("");
  }

  /* Colours are per kit: switching the look throws the tuning away rather than
     painting one kit's accent onto another's paper. */
  function chooseKit(next: string) {
    setKitId(next);
    setTuned({});
  }

  const tile = (entry: KitChoice) => {
    if (entry.id !== kitId || Object.keys(tuned).length === 0) return `/carousels/kits/${entry.id}`;
    const query = new URLSearchParams(
      Object.entries(tuned).map(([key, value]) => [key, value.replace("#", "")]),
    ).toString();
    return `/carousels/kits/${entry.id}?${query}`;
  };

  const togglePhoto = (id: string) =>
    setChosen((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  const frames = format === "story" ? [3, 4, 5] : [5, 6, 7, 8, 9, 10];

  return (
    <form action={formAction} aria-busy={pending} className="space-y-10">
      <section>
        <Field
          label="What is this set about?"
          hint="One line, in your own words. The writer turns it into slides using your brief and your proof points."
        >
          <Textarea
            name="topic"
            rows={2}
            required
            minLength={8}
            maxLength={240}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Why batching a week of posts beats trying to be consistent every day"
          />
        </Field>
        {topics.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-muted">Or start from something you have already said:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {topics.map((suggestion) => (
                <li key={suggestion.topic}>
                  <button
                    type="button"
                    onClick={() => setTopic(suggestion.topic)}
                    className="max-w-full rounded-full border border-line-strong bg-surface px-3 py-2 text-left text-xs text-ink-soft transition-colors hover:border-ink hover:bg-sunken/50"
                  >
                    {suggestion.topic}
                    <span className="ml-1.5 text-muted">· {suggestion.why}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <Choices legend="Format" columns="sm:grid-cols-2">
        {(["carousel", "story"] as const).map((value) => (
          <CardChoice
            key={value}
            name="format"
            value={value}
            checked={format === value}
            onChange={() => chooseFormat(value)}
            title={FORMAT_LABEL[value].name}
            aside={FORMAT_LABEL[value].ratio}
            line={FORMAT_LABEL[value].line}
          />
        ))}
      </Choices>

      <Choices legend="Layout" hint="Where the words go." columns="sm:grid-cols-2">
        {(Object.keys(LAYOUT_LABEL) as Layout[]).map((value) => (
          <CardChoice
            key={value}
            name="layout"
            value={value}
            checked={layout === value}
            onChange={() => setLayout(value)}
            title={LAYOUT_LABEL[value].name}
            line={LAYOUT_LABEL[value].line}
          />
        ))}
      </Choices>

      <Choices legend="Shape" hint="How the argument is laid out across the slides." columns="sm:grid-cols-2">
        {SKELETONS.map((value) => (
          <CardChoice
            key={value}
            name="skeleton"
            value={value}
            checked={skeleton === value}
            onChange={() => setSkeleton(value as Skeleton)}
            title={SKELETON_LABEL[value].name}
            line={SKELETON_LABEL[value].line}
          />
        ))}
      </Choices>

      <fieldset>
        <legend className="font-display text-lg text-ink">Look</legend>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {kits.map((entry) => (
            <label key={entry.id} className="cursor-pointer">
              <input
                type="radio"
                name="kit"
                value={entry.id}
                checked={kitId === entry.id}
                onChange={() => chooseKit(entry.id)}
                className="peer sr-only"
              />
              <span className="relative block overflow-hidden rounded-lg border border-line bg-sunken peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={tile(entry)}
                  alt={`A sample slide in the ${entry.name} look`}
                  className="block aspect-[4/5] w-full object-cover"
                />
                {kitId === entry.id && (
                  <span className="absolute right-1.5 bottom-1.5 grid size-6 place-items-center rounded-full bg-accent text-white shadow-card">
                    <CheckIcon className="size-3.5" />
                  </span>
                )}
              </span>
              <span className="mt-2 flex flex-wrap items-baseline gap-x-2">
                <span className={`text-sm font-semibold ${kitId === entry.id ? "text-accent" : "text-ink"}`}>
                  {entry.name}
                </span>
                {entry.private && <span className="eyebrow text-muted">Yours only</span>}
              </span>
              <span className="mt-0.5 block text-xs text-pretty text-muted">{entry.character}</span>
            </label>
          ))}
        </div>

        <details className="group mt-4 rounded-lg border border-line bg-surface">
          <summary className="flex min-h-11 list-none items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-ink-soft">
            Adjust the colours
            <span className="text-xs font-normal text-muted">Optional. The fonts and the layout stay ours.</span>
            <svg viewBox="0 0 12 8" aria-hidden="true" className="ml-auto size-3 text-muted transition-transform group-open:rotate-180">
              <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </summary>
          <div className="flex flex-wrap items-end gap-4 border-t border-line p-3.5">
            {COLOURS.map(({ key, label }) => (
              <label key={key} className="block">
                <span className="block text-xs font-medium text-muted">{label}</span>
                <span className="mt-1 flex items-center gap-2">
                  <input
                    type="color"
                    name={`palette.${key}`}
                    value={tuned[key] ?? kit[key]}
                    onChange={(event) => setTuned((current) => ({ ...current, [key]: event.target.value }))}
                    aria-label={`${label} colour`}
                    className="size-10 cursor-pointer rounded-md border border-line-strong bg-surface p-1"
                  />
                  <span className="font-mono text-xs text-muted">{tuned[key] ?? kit[key]}</span>
                </span>
              </label>
            ))}
            {Object.keys(tuned).length > 0 && (
              <button type="button" onClick={() => setTuned({})} className={buttonClass("quiet", "sm")}>
                Back to {kit.name}
              </button>
            )}
          </div>
        </details>
      </fieldset>

      <fieldset>
        <legend className="font-display text-lg text-ink">Photos</legend>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Pick none and we use your newest photos.
        </p>
        {photos.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-sunken px-4 py-3 text-sm text-ink-soft">
            You have no photos yet. Generate one on the Library page first — a set needs at least one for its cover.
          </p>
        ) : (
          <ul className="mt-3 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto rounded-lg border border-line bg-sunken/50 p-2 sm:grid-cols-6 lg:grid-cols-8">
            {photos.map((photo, index) => {
              const checked = chosen.includes(photo.id);
              return (
                <li key={photo.id}>
                  <label className="relative block cursor-pointer">
                    <input
                      type="checkbox"
                      name="photos"
                      value={photo.id}
                      checked={checked}
                      onChange={() => togglePhoto(photo.id)}
                      className="peer sr-only"
                    />
                    <span className="sr-only">
                      {photo.kind === "reference" ? `Reference photo ${index + 1}` : `Library photo ${index + 1}`}
                    </span>
                    <span className="block overflow-hidden rounded-md border border-line bg-sunken peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="" loading="lazy" decoding="async" className="aspect-[3/4] w-full object-cover" />
                    </span>
                    {checked && (
                      <span className="pointer-events-none absolute right-1 bottom-1 grid size-5 place-items-center rounded-full bg-accent text-white">
                        <CheckIcon className="size-3" />
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">
          {chosen.length === 0 ? "Nothing picked: we will choose." : `${chosen.length} picked, used in this order.`}
        </p>
      </fieldset>

      <div className="flex flex-wrap items-end gap-4 border-t border-line pt-6">
        <label className="block">
          <span className="block text-xs font-medium text-muted">Slides</span>
          <Select name="slides" value={slides} onChange={(event) => setSlides(event.target.value)} className="mt-1 w-32">
            <option value="">Let us choose</option>
            {frames.map((count) => (
              <option key={count} value={count}>
                {count} slides
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button type="submit" disabled={pending} className={buttonClass("primary", "lg")}>
            {pending ? "Writing and drawing…" : "Write and draw the set"}
          </button>
          {!state && (
            <p className="text-xs text-muted">Free.</p>
          )}
        </div>
        {state && !state.ok && <ResultMessage ok={false}>{state.message}</ResultMessage>}
      </div>
    </form>
  );
}

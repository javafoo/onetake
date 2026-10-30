"use client";

import { clipCredits, creditsLine, photoCredits, type Attached, type ComposerChoice, type ComposerTab } from "@/agent/composer";
import { LAYOUT_LABEL } from "@/carousel/skeletons";
import type { Layout } from "@/carousel/spec";
import { CLIP_ASPECTS_COMPOSER, CLIP_MODELS, type ClipAspectRatio, type ClipModel } from "@/content/clip-options";
import { IMAGE_ASPECTS, IMAGE_MODELS, type ImageAspect, type ImageModel } from "@/content/image-options";
import { Button, creditWord } from "@/components/ui";
import { Select } from "@/components/ui/field";

import { Modal } from "./modal";

/* What to make and with what: a photo (five shapes, two models), a clip (two
   shapes, three models) or slides (carousel or story, and where the words
   and photos go; the look comes from the Text picker). The price line at the bottom is exact with the agent off and
   the reel's ceiling with it on. */

const TABS: { id: ComposerTab; label: string }[] = [
  { id: "image", label: "Image" },
  { id: "video", label: "Video" },
  { id: "slides", label: "Slides" },
];

/* The four slide layouts, drawn as a thumbnail of the first slide so the
   difference is seen rather than read: a title on a photo, a photo on every
   slide, two photos stacked, four in a grid. */
const LAYOUTS = Object.keys(LAYOUT_LABEL) as Layout[];

function LayoutIcon({ id }: { id: Layout }) {
  const cell = "rounded-[2px] bg-current";
  const frame = "grid h-[18px] w-[14px] gap-[1.5px] overflow-hidden rounded-[3px] border-[1.5px] border-current p-[1.5px]";
  if (id === "split") return <span aria-hidden className={`${frame} grid-rows-2`}><span className={`${cell} opacity-70`} /><span className={`${cell} opacity-40`} /></span>;
  if (id === "grid") return <span aria-hidden className={`${frame} grid-cols-2 grid-rows-2`}>{[70, 40, 40, 70].map((o, i) => <span key={i} className={cell} style={{ opacity: o / 100 }} />)}</span>;
  if (id === "photos") return <span aria-hidden className={frame}><span className={`${cell} opacity-60`} /></span>;
  // Photos and text: a photo slide, then a plain one.
  return <span aria-hidden className="flex gap-[2px]"><span className={`${frame} w-[10px]`}><span className={`${cell} opacity-60`} /></span><span className="h-[18px] w-[10px] rounded-[3px] border-[1.5px] border-current" /></span>;
}

/** A small outline in the shape itself, so 5:4 and 4:5 are told apart at a glance. */
const SHAPE: Record<ImageAspect | ClipAspectRatio, { w: number; h: number }> = {
  "4:5": { w: 14, h: 18 },
  "5:4": { w: 18, h: 14 },
  "1:1": { w: 16, h: 16 },
  "9:16": { w: 11, h: 18 },
  "16:9": { w: 18, h: 11 },
  "3:4": { w: 14, h: 18 },
};

function ShapeIcon({ id }: { id: ImageAspect | ClipAspectRatio }) {
  const { w, h } = SHAPE[id];
  return <span aria-hidden className="block rounded-[3px] border-[1.5px] border-current" style={{ width: w, height: h }} />;
}

const PILL = "inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors";
const PILL_ON = "border-ink bg-ink text-canvas";
const PILL_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

export function ModelPanel({
  choice,
  onChange,
  agentOn,
  attached,
  hook = null,
  onClose,
}: {
  choice: ComposerChoice;
  onChange: (choice: ComposerChoice) => void;
  agentOn: boolean;
  attached: Attached;
  /** A hook pinned from the Hooks page, which changes what the agent-off modes can make. */
  hook?: string | null;
  onClose: () => void;
}) {
  const set = (patch: Partial<ComposerChoice>) => onChange({ ...choice, ...patch });
  // With the agent on and no format picked, neither pill is lit: the words decide.
  const formatShown = agentOn && !choice.formatPicked ? null : choice.format;
  const layoutShown = agentOn && !choice.layoutPicked ? null : choice.layout;

  return (
    <Modal
      title="What to make"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium text-spend">{creditsLine(choice, agentOn, attached, hook)}</p>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div role="tablist" className="flex rounded-full border border-line-strong bg-surface p-0.5">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={choice.tab === tab.id}
            onClick={() => set({ tab: tab.id })}
            className={`min-h-10 flex-1 rounded-full text-sm font-medium ${choice.tab === tab.id ? "bg-ink text-canvas" : "text-ink-soft hover:text-ink"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {choice.tab === "image" && (
        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-ink">Shape</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {IMAGE_ASPECTS.map((aspect) => (
                <button key={aspect} type="button" aria-pressed={choice.imageAspect === aspect} onClick={() => set({ imageAspect: aspect, imageAspectPicked: true })} className={`${PILL} ${choice.imageAspect === aspect ? PILL_ON : PILL_OFF}`}>
                  <ShapeIcon id={aspect} />
                  {aspect}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="text-sm font-medium text-ink">Model</span>
            <Select className="mt-2" value={choice.imageModel} onChange={(event) => set({ imageModel: event.target.value as ImageModel })}>
              {(Object.keys(IMAGE_MODELS) as ImageModel[]).map((id) => (
                <option key={id} value={id}>
                  {IMAGE_MODELS[id].label} · {creditWord(photoCredits(id))}
                </option>
              ))}
            </Select>
            <span className="mt-1.5 block text-xs text-muted">{IMAGE_MODELS[choice.imageModel].blurb}</span>
          </label>
        </div>
      )}

      {choice.tab === "video" && (
        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="text-sm font-medium text-ink">Shape</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {CLIP_ASPECTS_COMPOSER.map((aspect) => (
                <button key={aspect} type="button" aria-pressed={choice.clipAspect === aspect} onClick={() => set({ clipAspect: aspect })} className={`${PILL} ${choice.clipAspect === aspect ? PILL_ON : PILL_OFF}`}>
                  <ShapeIcon id={aspect} />
                  {aspect}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">The photo is cropped to fill the shape. The middle is kept.</p>
          </fieldset>
          <label className="block">
            <span className="text-sm font-medium text-ink">Model</span>
            <Select className="mt-2" value={choice.clipModel} onChange={(event) => set({ clipModel: event.target.value as ClipModel, clipModelPicked: true })}>
              {CLIP_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.title} · {creditWord(clipCredits(model.id))}
                </option>
              ))}
            </Select>
            <span className="mt-1.5 block text-xs text-muted">
              {agentOn && !choice.clipModelPicked
                ? "Not picked yet, so the agent uses Gemini Omni Flash."
                : CLIP_MODELS.find((model) => model.id === choice.clipModel)?.blurb}
            </span>
          </label>
        </div>
      )}

      {choice.tab === "slides" && (
        <div className="mt-5">
          <fieldset>
            <legend className="text-sm font-medium text-ink">Format</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" aria-pressed={formatShown === "carousel"} onClick={() => set({ format: "carousel", formatPicked: true })} className={`${PILL} ${formatShown === "carousel" ? PILL_ON : PILL_OFF}`}>
                Carousel
              </button>
              <button type="button" aria-pressed={formatShown === "story"} onClick={() => set({ format: "story", formatPicked: true })} className={`${PILL} ${formatShown === "story" ? PILL_ON : PILL_OFF}`}>
                Story
              </button>
            </div>
            {agentOn && !choice.formatPicked && <p className="mt-2 text-xs text-muted">Not picked yet, so the agent reads carousel or story from your words.</p>}
            <p className="mt-2 text-xs text-muted">A carousel is a swipe post, 4:5. A story is a sequence of 9:16 slides. The look comes from the Text chip.</p>
          </fieldset>
          <fieldset className="mt-5">
            <legend className="text-sm font-medium text-ink">Layout</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {LAYOUTS.map((id) => (
                <button key={id} type="button" aria-pressed={layoutShown === id} onClick={() => set({ layout: id, layoutPicked: true })} className={`${PILL} ${layoutShown === id ? PILL_ON : PILL_OFF}`}>
                  <LayoutIcon id={id} />
                  {LAYOUT_LABEL[id].name}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {layoutShown
                ? LAYOUT_LABEL[layoutShown].line
                : "Not picked yet, so the agent reads the layout from your words or your screenshot, like “half and half” or “a 2x2 grid”."}
            </p>
            {agentOn && choice.layoutPicked && (
              <button type="button" onClick={() => set({ layoutPicked: false })} className="mt-1 text-xs text-muted underline underline-offset-2 hover:text-ink">
                Let the agent choose
              </button>
            )}
          </fieldset>
        </div>
      )}
    </Modal>
  );
}

"use client";

import { useState } from "react";

import { Field, Select, Textarea } from "@/components/ui";
import { DEFAULT_IMAGE_ASPECT, IMAGE_ASPECTS, type ImageAspect } from "@/content/image-options";
import { EXPRESSIONS, LIGHTS, SCENE_GROUPS, type Scene } from "@/content/scene-library";
import type { ShotType } from "@/style/shot-types";

/** Where a photo of each shape is posted. */
const ASPECT_NOTE: Record<ImageAspect, string> = {
  "4:5": "feed posts and carousels",
  "5:4": "wide feed posts",
  "1:1": "square",
  "9:16": "stories and reel covers",
  "16:9": "landscape",
};

type Props = {
  shots: [ShotType, string][];
  /** From this avatar's identity lock. */
  wardrobe: string[];
  usualPlaces: string[];
};

type Choice = Omit<Scene, "shot"> & { shot?: ShotType };

const CHIP = "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm transition-colors";
const CHIP_ON = "border-ink bg-ink text-canvas";
const CHIP_OFF = "border-line-strong bg-surface text-ink-soft hover:border-ink hover:text-ink";

const random = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)];

/** The fields of the new-photo form: pick a ready-made scene or type one, then
    optionally pin the outfit, expression and light. Everything stays editable. */
export function ScenePicker({ shots, wardrobe, usualPlaces }: Props) {
  const groups: { name: string; scenes: Choice[] }[] = [
    ...(usualPlaces.length ? [{ name: "Her usual places", scenes: usualPlaces.map((place) => ({ label: place, idea: place })) }] : []),
    ...SCENE_GROUPS,
  ];

  const [group, setGroup] = useState(groups[0].name);
  const [idea, setIdea] = useState("");
  const [shot, setShot] = useState<ShotType>("selfie");
  const [aspect, setAspect] = useState<ImageAspect>(DEFAULT_IMAGE_ASPECT);
  const [outfit, setOutfit] = useState("");
  const [expression, setExpression] = useState("");
  const [light, setLight] = useState("");

  function choose(scene: Choice) {
    setIdea(scene.idea);
    if (scene.shot) setShot(scene.shot);
  }

  function surprise() {
    const pool = SCENE_GROUPS.flatMap((item) => item.scenes.map((scene) => ({ scene, group: item.name }))).filter(({ scene }) => scene.idea !== idea);
    const pick = random(pool);
    setGroup(pick.group);
    choose(pick.scene);
    setExpression(pick.scene.ownExpression ? "" : random(EXPRESSIONS));
    setOutfit("");
    setLight("");
  }

  const scenes = groups.find((item) => item.name === group)?.scenes ?? [];

  return (
    <>
      <div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-line pb-2">
          {groups.map((item) => (
            <button
              key={item.name}
              type="button"
              onClick={() => setGroup(item.name)}
              aria-pressed={item.name === group}
              className={`min-h-11 px-0.5 text-xs font-semibold transition-colors ${
                item.name === group ? "text-ink underline underline-offset-[7px]" : "text-muted hover:text-ink"
              }`}
            >
              {item.name}
            </button>
          ))}
          <button type="button" onClick={surprise} className={`${CHIP} ${CHIP_OFF} ml-auto px-3 text-xs`}>
            Surprise me
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {scenes.map((scene) => (
            <button
              key={scene.label}
              type="button"
              onClick={() => choose(scene)}
              aria-pressed={scene.idea === idea}
              className={`${CHIP} text-left ${scene.idea === idea ? CHIP_ON : CHIP_OFF}`}
            >
              {scene.label}
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="block text-sm font-medium text-ink">The scene</span>
        <span className="mt-1 block text-xs text-muted">Tap one above, or write your own in one sentence.</span>
        <Textarea
          name="idea"
          rows={3}
          value={idea}
          onChange={(event) => setIdea(event.target.value)}
          className="mt-2"
          placeholder="In the driver's seat after the gym, iced coffee in hand"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Outfit">
          <Select name="outfit" value={outfit} onChange={(event) => setOutfit(event.target.value)}>
            <option value="">Picked from her wardrobe</option>
            {wardrobe.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Expression">
          <Select name="expression" value={expression} onChange={(event) => setExpression(event.target.value)}>
            <option value="">Whatever suits the scene</option>
            {EXPRESSIONS.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Light">
          <Select name="light" value={light} onChange={(event) => setLight(event.target.value)}>
            <option value="">Whatever suits the scene</option>
            {LIGHTS.map((item) => <option key={item}>{item}</option>)}
          </Select>
        </Field>
        <Field label="Shot">
          <Select name="shot" value={shot} onChange={(event) => setShot(event.target.value as ShotType)}>
            {shots.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
        </Field>
        <Field label="Shape" className="sm:col-span-2">
          <Select name="aspect" value={aspect} onChange={(event) => setAspect(event.target.value as ImageAspect)}>
            {IMAGE_ASPECTS.map((shape) => <option key={shape} value={shape}>{shape} — {ASPECT_NOTE[shape]}</option>)}
          </Select>
        </Field>
      </div>
    </>
  );
}

"use client";

import { useState } from "react";

import { ONETAKE_MINUTES_PER_WEEK, timeSaved } from "@/lib/time-saved";

/* Her numbers in, her time back out. The one assumption of ours (the
   minutes a week OneTake takes her) is printed under the result. */

function Slider({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3 text-sm text-ink-soft">
        <span>{label}</span>
        <span className="font-display text-xl text-ink tabular-nums">
          {value}
          <span className="ml-1 font-sans text-sm text-muted">{suffix}</span>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 w-full accent-[var(--color-accent)]"
      />
    </label>
  );
}

export function TimeCalculator() {
  const [posts, setPosts] = useState(5);
  const [minutes, setMinutes] = useState(90);
  const [rate, setRate] = useState(100);
  const result = timeSaved({ postsPerWeek: posts, minutesPerPost: minutes, hourlyValue: rate });

  return (
    <div className="grid gap-8 rounded-3xl border border-line bg-surface p-6 shadow-[0_24px_60px_-40px_rgba(32,29,26,0.5)] md:grid-cols-2 md:p-10">
      <div className="space-y-6">
        <Slider label="Posts you want each week" value={posts} min={1} max={14} step={1} suffix={posts === 1 ? "post" : "posts"} onChange={setPosts} />
        <Slider label="Minutes one post takes you today" value={minutes} min={15} max={240} step={15} suffix="min" onChange={setMinutes} />
        <Slider label="What an hour of your time is worth" value={rate} min={25} max={500} step={25} suffix="$ / hour" onChange={setRate} />
        <p className="text-xs text-muted">Ideas, scripting, filming or generating every photo and clip, editing, captions. Most founders say an hour or two.</p>
      </div>
      <div className="flex flex-col justify-center rounded-2xl bg-accent-soft p-6 text-center md:p-8">
        <p className="text-sm text-accent-strong">You get back</p>
        <p className="mt-1 font-display text-6xl tracking-tight text-accent tabular-nums">{result.hoursPerMonth}</p>
        <p className="text-base text-ink">hours a month</p>
        <div className="mt-6 grid grid-cols-2 gap-3 text-left">
          <div className="rounded-xl bg-surface p-3">
            <p className="font-display text-2xl text-ink tabular-nums">${result.valuePerMonth.toLocaleString("en-US")}</p>
            <p className="text-xs text-muted">of your time, every month</p>
          </div>
          <div className="rounded-xl bg-surface p-3">
            <p className="font-display text-2xl text-ink tabular-nums">{result.daysPerYear}</p>
            <p className="text-xs text-muted">working days a year</p>
          </div>
        </div>
        <p className="mt-5 text-xs text-muted">Counts about {ONETAKE_MINUTES_PER_WEEK} minutes a week with OneTake: the voice note, and reading what comes back.</p>
      </div>
    </div>
  );
}

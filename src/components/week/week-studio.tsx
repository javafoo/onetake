"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { Badge, Button, Card, CostTag, creditWord, Field, Input, MediaTile, Note, Textarea } from "@/components/ui";
import type { Format } from "@/week/plan";
import type { WeekPostView, WeekView } from "@/week/view";

/* The week screen: record or type, see the price, press once, then watch the
   agent work, stage by stage, and get finished posts to copy and download. */

const POLL_MS = 3000;
const MAX_RECORD_SECONDS = 180;
const MAX_BUDGET = 30;

type Props = { prices: Record<Format, number>; defaultBudget: number; credits: number; latestWeekId?: string | null };

/** "free" for a format that costs nothing on its own, so the price list never says "0 credits". */
const priceWord = (credits: number) => (credits === 0 ? "free" : creditWord(credits));

export function WeekStudio({ prices, defaultBudget, credits, latestWeekId }: Props) {
  const [notes, setNotes] = useState("");
  const [goal, setGoal] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [week, setWeek] = useState<WeekView | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const typicalWeek = prices.reel + prices.carousel + prices.photo;
  // Enough for one of each format, never more than the server allows.
  const budget = Math.min(MAX_BUDGET, Math.max(defaultBudget, typicalWeek));
  const audioUrl = useMemo(() => (audio ? URL.createObjectURL(audio) : null), [audio]);
  const ready = Boolean(audio) || notes.trim().split(/\s+/).filter(Boolean).length >= 15;

  // Coming back to the page shows the newest week, still being made or just finished.
  useEffect(() => {
    if (!latestWeekId) return;
    let cancelled = false;
    void fetch(`/api/week/${latestWeekId}`, { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<WeekView>) : null))
      .then((view) => {
        if (!cancelled && view) setWeek(view);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [latestWeekId]);

  // Poll while the week is working. Each poll is also what moves it along.
  useEffect(() => {
    if (!week || week.status === "completed" || week.status === "failed") return;
    const handle = setTimeout(async () => {
      try {
        const response = await fetch(`/api/week/${week.id}`, { cache: "no-store" });
        if (response.ok) setWeek((await response.json()) as WeekView);
      } catch {
        // A missed poll is tried again on the next tick.
      }
    }, POLL_MS);
    return () => clearTimeout(handle);
  }, [week]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const chunks: Blob[] = [];
      const media = new MediaRecorder(stream, { mimeType: type });
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setAudio(new Blob(chunks, { type }));
        setRecording(false);
        if (timer.current) clearInterval(timer.current);
      };
      recorder.current = media;
      media.start();
      setRecording(true);
      setSeconds(0);
      timer.current = setInterval(() => {
        setSeconds((value) => {
          if (value + 1 >= MAX_RECORD_SECONDS) recorder.current?.stop();
          return value + 1;
        });
      }, 1000);
    } catch {
      setError("I could not use your microphone. Allow it in your browser, or type your week instead.");
    }
  }

  async function start() {
    setSending(true);
    setError(null);
    const form = new FormData();
    form.set("requestId", crypto.randomUUID());
    form.set("notes", notes);
    form.set("goal", goal);
    form.set("budget", String(budget));
    if (audio) form.set("audio", new File([audio], audio.type.includes("mp4") ? "week.m4a" : "week.webm", { type: audio.type.split(";")[0] }));
    try {
      const response = await fetch("/api/week", { method: "POST", body: form });
      const body = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "That did not start. Try again.");
      const first = await fetch(`/api/week/${body.id}`, { cache: "no-store" });
      setWeek(first.ok ? ((await first.json()) as WeekView) : null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not start. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (week) return <WeekProgress week={week} onAgain={() => { setWeek(null); setAudio(null); setNotes(""); }} />;

  return (
    <Card className="space-y-5">
      <div className="space-y-3">
        <p className="text-sm font-medium text-ink">Your week, in your words</p>
        <div className="flex flex-wrap items-center gap-3">
          {recording ? (
            <Button variant="danger" onClick={() => recorder.current?.stop()}>
              Stop recording ({Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")})
            </Button>
          ) : (
            <Button variant="accent" onClick={startRecording}>
              {audio ? "Record again" : "Record a voice note"}
            </Button>
          )}
          {audio && !recording && (
            <>
              {audioUrl && <audio controls src={audioUrl} className="h-10" />}
              <Button variant="ghost" size="sm" onClick={() => setAudio(null)}>
                Remove
              </Button>
            </>
          )}
        </div>
        {!audio && (
          <Field label="Or type it" hint="At least a few sentences. Real things only: I post only what you say.">
            <Textarea
              rows={6}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="A client told me on Tuesday she finally raised her prices after our call. I spent two days on a launch email nobody opened. I learned that..."
            />
          </Field>
        )}
      </div>

      <Field label="What should this week's posts do? (optional)" hint="For example: fill my free workshop, or sell my coaching call.">
        <Input value={goal} onChange={(event) => setGoal(event.target.value)} maxLength={200} />
      </Field>

      <Note tone="spend">
        A week is up to three finished posts: a talking reel ({priceWord(prices.reel)}), a carousel ({priceWord(prices.carousel)}) and a photo post (
        {priceWord(prices.photo)}). It spends at most {creditWord(budget)}, and only on posts that passed review. You have {creditWord(credits)}.
      </Note>

      {error && <p className="text-sm text-danger" role="alert">{error}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={start} disabled={!ready || sending || recording || credits < 1}>
          {sending ? "Starting…" : "Make my week"}
        </Button>
        <CostTag credits={budget} />
        <span className="text-sm text-ink-soft">Takes about five to ten minutes. You can leave this page; it keeps going.</span>
      </div>
    </Card>
  );
}

function WeekProgress({ week, onAgain }: { week: WeekView; onAgain: () => void }) {
  const working = week.status === "queued" || week.status === "running";
  return (
    <div className="space-y-6">
      <Card className="space-y-4">
        <ol className="space-y-2">
          {week.stages.map((stage) => (
            <li key={stage.stage} className="flex items-center gap-3 text-sm">
              <span
                aria-hidden
                className={`size-2.5 shrink-0 rounded-full ${stage.state === "done" ? "bg-good" : stage.state === "now" ? "animate-pulse bg-accent" : "bg-line-strong"}`}
              />
              <span className={stage.state === "later" ? "text-ink-soft" : "text-ink"}>{stage.label}</span>
            </li>
          ))}
        </ol>
        {week.error && <p className="text-sm text-danger" role="alert">{week.error}</p>}
      </Card>

      {week.log.length > 0 && (
        <Card tone="sunken" className="space-y-3">
          <p className="text-sm font-medium text-ink">What the agent did</p>
          <ul className="space-y-3">
            {week.log.map((entry, index) => (
              <li key={index} className="text-sm">
                <p className="text-ink">{entry.text}</p>
                {entry.links && entry.links.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {entry.links.map((link) => (
                      <li key={link.url}>
                        <a href={link.url} target="_blank" rel="noreferrer" className="text-ink-soft underline underline-offset-2">
                          {link.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {entry.model && <p className="mt-0.5 text-xs text-ink-soft">{entry.model}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {week.posts.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {week.posts.map((post, index) => (
            <PostCard key={index} post={post} />
          ))}
        </div>
      )}

      {week.summary && <Note>{week.summary}</Note>}
      {!working && (
        <Button variant="quiet" onClick={onAgain}>
          Plan another week
        </Button>
      )}
    </div>
  );
}

function PostCard({ post }: { post: WeekPostView }) {
  const ratio = post.format === "carousel" ? "4:5" : post.format === "reel" ? "9:16" : "4:5";
  const fullText = [post.hook, post.caption, post.cta].filter(Boolean).join("\n\n");
  return (
    <Card as="article" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{post.formatLabel}</Badge>
        {post.status === "ready" && <Badge tone="good">Ready to post</Badge>}
        {post.status === "making" && <Badge>Making</Badge>}
        {post.status === "failed" && <Badge tone="warn">Not made</Badge>}
        {post.status === "held" && <Badge tone="warn">Held back</Badge>}
        {post.score !== undefined && <Badge>Review {post.score}/10</Badge>}
        {post.rewritten && <Badge tone="spend">Rewritten</Badge>}
      </div>

      {post.show.length > 0 ? (
        <div className={post.show.length > 1 ? "-mx-1 flex snap-x gap-2 overflow-x-auto px-1" : ""}>
          {post.show.map((item) => (
            <MediaTile
              key={item.id}
              kind={item.video ? "video" : "image"}
              src={`/api/media/${item.id}`}
              ratio={ratio}
              controls={item.video}
              download={item.id}
              className={post.show.length > 1 ? "w-48 shrink-0 snap-start" : ""}
            />
          ))}
        </div>
      ) : (
        post.status !== "failed" && post.status !== "held" && <div className="grid aspect-[4/5] place-items-center rounded-lg border border-dashed border-line text-sm text-ink-soft">Being made</div>
      )}

      {post.hook && <p className="font-display text-lg leading-snug text-ink">{post.hook}</p>}
      {post.caption && <p className="whitespace-pre-line text-sm text-ink-soft">{post.caption}</p>}
      {post.cta && <p className="text-sm font-medium text-ink">{post.cta}</p>}
      <p className="text-xs text-ink-soft">Why this week: {post.why}</p>
      {post.trend && (
        <p className="text-xs text-ink-soft">
          Meets:{" "}
          <a href={post.trend.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
            {post.trend.title}
          </a>
        </p>
      )}
      {post.change && <p className="text-xs text-ink-soft">Changed after review: {post.change}</p>}
      {post.error && <p className="text-sm text-danger">{post.error}</p>}
      {fullText && <CopyButton text={fullText} label="Copy caption" />}
    </Card>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { buttonClass } from "@/components/ui";
import { PRODUCT_NAME } from "@/lib/product";

import { SoundReel } from "./sound-reel";
import { TimeCalculator } from "./time-calculator";

/* The signed-out homepage. One promise, shown working: more clients from
   social media, without spending hours on it. Every post on it was made by OneTake
   for Sarah, a made-up real estate agent, from her photos and a few sentences
   about her week. */

const HOOK = "Get more clients from social media,";
const HOOK_EMPHASIS = "without spending hours creating content.";

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="mx-auto w-fit rounded-full border border-ink/20 px-3.5 py-1 text-2xs font-medium tracking-[0.16em] text-ink-soft uppercase md:mx-0">{children}</p>;
}

function Sticker({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`inline-block rounded-md bg-ink px-2.5 py-1 text-xs font-semibold tracking-wide text-canvas uppercase shadow ${className}`}>{children}</span>;
}

function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative aspect-[9/16] overflow-hidden rounded-[2rem] border-[6px] border-ink bg-ink shadow-[0_34px_70px_-30px_rgba(32,29,26,0.65)] ${className}`}>
      {children}
    </div>
  );
}

function Arrow({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" fill="none" aria-hidden className={className}>
      <path d="M4 30 C 20 4, 42 4, 56 22" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M46 22 L57 24 L55 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StartButton({ className = "" }: { className?: string }) {
  return (
    <Link href="/sign-up" className={buttonClass("primary", "lg", className)}>
      Start free
    </Link>
  );
}

const STEPS = [
  { n: "1", title: "Build your avatar once", body: "Upload a few ordinary photos of yourself and tell it about your business: who you help, what you sell, how you talk. About ten minutes, one time." },
  { n: "2", title: "Talk for two minutes", body: "Each week, record a voice note about what happened: a client win, a number, a lesson, a bad day. No script. Or type it." },
  { n: "3", title: "Get finished posts", body: "A talking reel, a carousel and a photo post with your face, written in your voice, checked and ready to post. Download, copy the caption, post." },
];

const AGENT = [
  { step: "Understands your week", detail: "Finds the stories and proof in what you said, in your words.", model: "NVIDIA Nemotron 3 Ultra" },
  { step: "Checks what your audience is talking about", detail: "Searches this week's conversations and keeps only what really matters to your clients.", model: "Tavily + Nemotron 3 Super" },
  { step: "Plans the week", detail: "Picks the posts and formats that turn your real week into reasons to hire you.", model: "Nemotron 3 Ultra" },
  { step: "Writes in your voice", detail: "Hooks, captions and what you say to camera. Only true things: every claim comes from you.", model: "Nemotron 3 Super" },
  { step: "Reviews its own work", detail: "An editor pass scores every post. Weak ones are rewritten; anything still not good enough is held back, and nothing is spent on it.", model: "Nemotron 3 Super" },
  { step: "Makes the posts", detail: "The reel, the slides and the photo, with your face from your own photos.", model: "Your avatar" },
];

const OLD_NEW: [string, string][] = [
  ["Staring at a blank caption at 11pm", "A two-minute voice note"],
  ["Copying prompts between five AI tools", "One place, nothing to prompt"],
  ["Paying for a writer tool, an image tool, a video tool, an editor", "One app does all of it"],
  ["AI photos of someone who is almost you", "Your face, from your own photos"],
  ["Deleting claims you never made", "Every claim checked against what you said"],
  ["Stitching captions onto clips", "Finished reels, carousels and photos"],
];

/* Four photos of Sarah, fanned like prints on a table. */
const FAN = [
  { src: "/home/fan-1.jpg", alt: "Sarah seated in a living room.", tilt: "-rotate-[11deg] translate-y-4" },
  { src: "/home/fan-2.jpg", alt: "Sarah outside a modern house.", tilt: "-rotate-[4deg]" },
  { src: "/home/fan-3.jpg", alt: "Sarah in a kitchen, holding a folder.", tilt: "rotate-[4deg]" },
  { src: "/home/fan-4.jpg", alt: "Sarah holding house keys in a bright living room.", tilt: "rotate-[11deg] translate-y-4" },
];

export function Landing() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-gutter py-3 md:px-8">
          <Link href="/" aria-label={`${PRODUCT_NAME} home`} className="text-2xl">
            <Logo />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/sign-in" className={buttonClass("ghost", "md")}>
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonClass("primary", "md", "hidden sm:inline-flex")}>
              Start free
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero */}
        <section className="px-gutter pt-10 pb-16 md:px-8 md:pt-16 md:pb-24">
          <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-[1fr_auto] md:gap-16">
            <div className="text-center md:text-left">
              <Eyebrow>Build once, create forever</Eyebrow>
              <h1 className="mx-auto mt-5 max-w-2xl font-display text-[2.3rem] leading-[1.05] tracking-tight text-balance sm:text-5xl md:mx-0 md:text-[3.6rem]">
                {HOOK} <span className="text-accent italic">{HOOK_EMPHASIS}</span>
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-lg text-pretty text-ink-soft md:mx-0 md:text-xl">Your content, done for you by your own AI, in your voice and with your face.</p>
              <p className="mx-auto mt-3 max-w-xl text-base font-medium tracking-wide text-ink md:mx-0">No filming. No editing. No prompts.</p>
              <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row md:justify-start">
                <StartButton />
              </div>
            </div>
            <div className="mx-auto w-[min(72vw,300px)] md:w-[300px]">
              <Phone>
                <SoundReel src="/home/reel.mp4" poster="/home/reel.jpg" label="A talking reel OneTake made for Sarah, a real estate agent: you don't need 20% down to buy your first home." />
              </Phone>
              <p className="mt-3 text-center text-xs text-muted">Sarah sells houses. OneTake made this reel from a few sentences about her week. No camera, no editing.</p>
            </div>
          </div>
        </section>

        {/* One photo in, finished posts out */}
        <section className="border-y border-line bg-sunken/60 px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto max-w-5xl text-center">
            <Eyebrow>What it does</Eyebrow>
            <p className="mx-auto mt-6 max-w-3xl font-display text-[1.6rem] leading-snug text-balance md:text-[2.1rem]">
              <span className="box-decoration-clone bg-accent px-2 py-0.5 text-canvas">{PRODUCT_NAME}</span> turns <em>your selfie</em> and <em>what happened this week</em> into{" "}
              <strong className="font-semibold">finished posts that bring you clients</strong>,{" "}
              <span className="underline decoration-accent decoration-2 underline-offset-4">without filming, writing or editing</span>.
            </p>
            <div className="mx-auto mt-14 grid max-w-5xl grid-cols-[1fr_auto_1.4fr] items-center gap-3 md:grid-cols-[1fr_auto_1.6fr_1fr] md:gap-6">
              <figure className="relative">
                <Sticker className="absolute -top-3 left-2 z-10 -rotate-3">Before</Sticker>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/home/reference.jpg" alt="Before: Sarah's own selfie." className="aspect-[4/5] w-full rounded-2xl object-cover shadow-[0_26px_56px_-28px_rgba(32,29,26,0.55)] ring-1 ring-ink/10" />
                <figcaption className="mt-3 text-xs text-muted md:text-sm">Your selfie</figcaption>
              </figure>
              <Arrow className="h-8 w-12 text-accent md:h-12 md:w-20" />
              <figure className="relative">
                <Sticker className="absolute -top-3 right-2 z-10 rotate-3">After</Sticker>
                <div className="grid grid-cols-2 gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/home/carousel.jpg" alt="A carousel cover of Sarah in her car: I keep hearing renters say they need 20% down. Here is why that is a myth." className="aspect-[4/5] w-full rounded-xl object-cover shadow-[0_26px_56px_-28px_rgba(32,29,26,0.55)] ring-1 ring-ink/10" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/home/photo-post.jpg" alt="A photo post of Sarah in a bright living room: I saw them fall in love in ten minutes, then the inspector found a cracked foundation." className="aspect-[4/5] w-full rounded-xl object-cover shadow-[0_26px_56px_-28px_rgba(32,29,26,0.55)] ring-1 ring-ink/10" />
                </div>
                <figcaption className="mt-3 text-xs text-muted md:text-sm">A carousel and a photo post</figcaption>
              </figure>
              <figure className="col-span-3 mx-auto w-40 md:col-span-1 md:w-full">
                <Phone className="rounded-[1.4rem] border-4">
                  <video src="/home/reel.mp4" poster="/home/reel.jpg" autoPlay muted loop playsInline className="size-full object-cover" aria-label="After: a talking reel of Sarah, the same week." />
                </Phone>
                <figcaption className="mt-3 text-xs text-muted md:text-sm">A talking reel, same week</figcaption>
              </figure>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="text-center font-display text-3xl tracking-tight md:text-4xl">
              How it <span className="text-accent italic">works</span>
            </h2>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.n} className="rounded-2xl border border-line bg-surface p-6 shadow-[0_18px_40px_-32px_rgba(32,29,26,0.55)]">
                  <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft font-display text-lg text-accent">{step.n}</span>
                  <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                  <p className="mt-2 text-base text-ink-soft">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Any time */}
        <section className="px-gutter pb-16 md:px-8 md:pb-24">
          <div className="mx-auto max-w-5xl rounded-3xl border border-line bg-surface p-6 md:p-10">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div>
                <Eyebrow>Never run out of content</Eyebrow>
                <h2 className="mt-5 font-display text-3xl tracking-tight text-balance md:text-4xl">
                  New photos and videos of you, <span className="text-accent italic">whenever you need them</span>
                </h2>
                <p className="mt-4 text-base text-ink-soft">At the beach, at your desk, on stage. B-roll clips, talking reels, carousels and photo posts, all with your face, without picking up a camera. Ask in a sentence, or let your week plan it for you.</p>
                <p className="mt-3 text-base text-ink-soft">You keep showing up, so your audience keeps growing, while you spend your time on the work only you can do.</p>
              </div>
              <div>
                <div className="flex justify-center px-4 pt-2 pb-8">
                  {FAN.map((photo) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={photo.src} src={photo.src} alt={photo.alt} className={`-mx-3 aspect-[4/5] w-[27%] rounded-xl object-cover shadow-[0_18px_40px_-20px_rgba(32,29,26,0.6)] ring-4 ring-surface ${photo.tilt}`} />
                  ))}
                </div>
                <ul className="grid grid-cols-2 gap-3 text-sm">
                  {["Photos of you anywhere", "B-roll clips", "Talking reels", "Carousels", "Quote and how-to posts", "Captions and hooks"].map((item) => (
                    <li key={item} className="rounded-xl border border-line bg-canvas px-4 py-3 font-medium">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* The agent */}
        <section className="border-y border-line bg-surface px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto grid max-w-5xl gap-10 md:grid-cols-[1fr_1.2fr] md:items-start">
            <div>
              <Eyebrow>Done for you, done right</Eyebrow>
              <h2 className="mt-5 font-display text-3xl tracking-tight text-balance md:text-4xl">
                Your content, <span className="text-accent italic">ready to post every week.</span>
              </h2>
              <p className="mt-4 text-base text-ink-soft">No tools to learn, no prompts to write. {PRODUCT_NAME} plans and writes your posts in your voice, makes them with your AI avatar, and reviews every one.</p>
              <div className="mx-auto mt-10 w-[min(64vw,250px)] md:mx-0">
                <Phone>
                  <SoundReel src="/home/pricing.mp4" poster="/home/pricing.jpg" label="A talking reel of Sarah explaining how home pricing works." />
                </Phone>
              </div>
            </div>
            <ol className="relative space-y-5 border-l-2 border-accent/30 pl-6">
              {AGENT.map((item) => (
                <li key={item.step} className="relative">
                  <span aria-hidden className="absolute top-1.5 -left-[31px] size-3 rounded-full bg-accent ring-4 ring-surface" />
                  <p className="font-semibold">{item.step}</p>
                  <p className="text-base text-ink-soft">{item.detail}</p>
                  <p className="mt-1 text-xs tracking-wide text-muted uppercase">{item.model}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Time saved */}
        <section className="px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto max-w-5xl">
            <div className="text-center">
              <Eyebrow>Time saved</Eyebrow>
              <h2 className="mt-5 font-display text-3xl tracking-tight md:text-4xl">
                What content is <span className="text-accent italic">really</span> costing you
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-base text-ink-soft">Move the sliders to your week. Those hours are client calls, sales and rest.</p>
            </div>
            <div className="mt-10">
              <TimeCalculator />
            </div>
          </div>
        </section>

        {/* Old way, new way */}
        <section className="border-y border-line bg-sunken/60 px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto max-w-4xl">
            <h2 className="text-center font-display text-3xl tracking-tight md:text-4xl">
              Pieces, <span className="text-accent italic">or posts</span>
            </h2>
            <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface">
              <div className="grid grid-cols-2 border-b border-line bg-sunken text-sm font-semibold">
                <p className="px-4 py-3 text-muted md:px-6">Doing it yourself with AI tools</p>
                <p className="px-4 py-3 text-accent md:px-6">With {PRODUCT_NAME}</p>
              </div>
              {OLD_NEW.map(([old, now]) => (
                <div key={old} className="grid grid-cols-2 border-b border-line text-base last:border-b-0">
                  <p className="px-4 py-4 text-muted line-through decoration-muted/50 md:px-6">{old}</p>
                  <p className="px-4 py-4 font-medium text-ink md:px-6">{now}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Honest */}
        <section className="px-gutter py-16 md:px-8 md:py-24">
          <div className="mx-auto grid max-w-5xl gap-4 md:grid-cols-3">
            {[
              ["Nothing made up", "Posts only say what you said, your story and your proof. A reviewer checks every claim before anything is made."],
              ["You stay in control", "Nothing is posted for you. You download, copy the caption and post what you like, when you like."],
              ["You see the price first", "Every week shows its cost before you press, and a post that fails review costs nothing."],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl border border-line bg-surface p-6">
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-2 text-base text-ink-soft">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Close */}
        <section className="px-gutter pb-20 md:px-8 md:pb-28">
          <div className="mx-auto max-w-4xl rounded-3xl bg-ink px-6 py-14 text-center text-canvas md:px-12 md:py-20">
            <p className="text-sm tracking-[0.16em] text-canvas/70 uppercase">Build once, create forever</p>
            <h2 className="mx-auto mt-4 max-w-2xl font-display text-3xl tracking-tight text-balance md:text-5xl">Your next client is scrolling right now. Be there.</h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-canvas/80">Set up your avatar in about ten minutes. Your first week of posts is on us.</p>
            <Link href="/sign-up" className={buttonClass("accent", "lg", "mt-8")}>
              Start free
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line px-gutter py-8 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 text-sm text-muted md:flex-row">
          <span className="text-lg text-ink">
            <Logo />
          </span>
          <p>Built with NVIDIA Nemotron on Nebius Token Factory, and Tavily.</p>
        </div>
      </footer>
    </div>
  );
}

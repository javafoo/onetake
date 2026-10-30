"use client";

import { useRef, useState } from "react";

/* A talking reel that plays on its own, silently, because browsers only allow
   that; one tap turns her voice on, from the start, so the line is heard whole. */
export function SoundReel({ src, poster, label }: { src: string; poster: string; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);

  function toggle() {
    const element = video.current;
    if (!element) return;
    const next = !sound;
    element.muted = !next;
    if (next) {
      element.currentTime = 0;
      void element.play();
    }
    setSound(next);
  }

  return (
    <div className="relative size-full">
      <video ref={video} src={src} poster={poster} autoPlay muted loop playsInline className="size-full object-cover" aria-label={label} />
      <button
        type="button"
        onClick={toggle}
        className="absolute right-2.5 bottom-2.5 inline-flex size-9 items-center justify-center rounded-full bg-ink/70 text-canvas backdrop-blur hover:bg-ink"
        aria-pressed={sound}
        aria-label={sound ? "Turn sound off" : "Turn sound on"}
      >
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          {sound ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m23 9-6 6M17 9l6 6" />}
        </svg>
      </button>
    </div>
  );
}

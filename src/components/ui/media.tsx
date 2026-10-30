import type { ReactNode } from "react";

import { downloadHref } from "@/lib/download";

import { CheckIcon, DownloadIcon, PlayIcon } from "./icons";

/* Media tiles.

   Portrait 3:4 (photos) and 9:16 (clips and reels) are the only two shapes the
   product makes, so the ratio is a token rather than a class each page writes.
   Video is never autoplayed and never carries sound until the creator presses
   play: every <video> here is muted, playsInline and metadata-only. */

export type Ratio = "3:4" | "4:5" | "5:4" | "9:16" | "16:9" | "1:1" | "auto";

export const RATIO: Record<Ratio, string> = {
  "3:4": "aspect-[3/4]",
  // Carousel slides: the one shape the renderer makes that a photo does not.
  "4:5": "aspect-[4/5]",
  // The two landscape shapes the composer's photo picker offers.
  "5:4": "aspect-[5/4]",
  "9:16": "aspect-[9/16]",
  "16:9": "aspect-video",
  "1:1": "aspect-square",
  // A photo at its own shape, when the shape is not known before it loads.
  auto: "",
};

const FRAME = "group relative w-full overflow-hidden rounded-lg border border-line bg-sunken";

/**
 * A small corner button that saves the file through the owner-checked media
 * route. With a mouse it shows on hover or focus; on a touch screen, which has
 * no hover, it is always there. The parent needs `relative` and `group`.
 */
export function DownloadCorner({ mediaId, className = "" }: { mediaId: string; className?: string }) {
  return (
    <a
      href={downloadHref(mediaId)}
      download
      aria-label="Download"
      title="Download"
      className={`absolute top-1.5 right-1.5 z-10 grid size-8 place-items-center rounded-full bg-black/55 text-white transition-opacity hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 ${className}`}
    >
      <DownloadIcon className="size-4" />
    </a>
  );
}

export function MediaTile({
  kind,
  src,
  alt = "",
  ratio = "3:4",
  caption,
  badge,
  controls = false,
  /** Draws a play glyph over a video tile that has no controls of its own. */
  playable = false,
  /** A media id: adds the corner Download button. Leave it off a tile inside a button or link. */
  download,
  className = "",
}: {
  kind: "image" | "video";
  src: string;
  alt?: string;
  ratio?: Ratio;
  caption?: ReactNode;
  badge?: ReactNode;
  controls?: boolean;
  playable?: boolean;
  download?: string;
  className?: string;
}) {
  return (
    <figure className={className}>
      <div className={`${FRAME} ${RATIO[ratio]}`}>
        {kind === "image" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          /* Chrome puts every <video> in the tab order. One without controls is
             a picture, so it is taken back out of it. */
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            controls={controls}
            tabIndex={controls ? 0 : -1}
            aria-hidden={controls ? undefined : true}
            className="size-full bg-black object-cover"
          />
        )}
        {playable && (
          <span className="pointer-events-none absolute bottom-2 left-2 grid size-7 place-items-center rounded-full bg-black/55 text-white">
            <PlayIcon className="size-4" />
          </span>
        )}
        {badge && <div className="absolute top-2 left-2">{badge}</div>}
        {download && <DownloadCorner mediaId={download} />}
      </div>
      {caption && <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>}
    </figure>
  );
}

/* A radio dressed as a media tile. The input keeps its name and value, so the
   form still submits exactly what it did before; only the skin changes. */
export function MediaChoice({
  name,
  value,
  kind,
  src,
  label,
  ratio = "9:16",
  defaultChecked,
  required,
  onChange,
}: {
  name: string;
  value: string;
  kind: "image" | "video";
  src: string;
  label: string;
  ratio?: Ratio;
  defaultChecked?: boolean;
  required?: boolean;
  /** For a form that says something about the choice. The radio stays uncontrolled. */
  onChange?: (value: string) => void;
}) {
  return (
    <label className="relative block cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        required={required}
        onChange={onChange && (() => onChange(value))}
        className="peer sr-only"
      />
      <span className="sr-only">{label}</span>
      <span
        className={`${FRAME} ${RATIO[ratio]} block peer-checked:border-accent peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent`}
      >
        {kind === "image" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={src} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
        ) : (
          <video
            src={`${src}#t=0.5`}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
            aria-hidden="true"
            className="size-full bg-black object-cover"
          />
        )}
      </span>
      <span className="pointer-events-none absolute right-1.5 bottom-1.5 hidden size-6 place-items-center rounded-full bg-accent text-white shadow-card peer-checked:grid">
        <CheckIcon className="size-3.5" />
      </span>
    </label>
  );
}

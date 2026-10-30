import Link from "next/link";

import { FaceIcon, HeartIcon, PlayIcon, ReelIcon } from "@/components/ui/icons";

import { libraryHref, type LibraryTab } from "./paths";
import { SHELF_LABEL } from "./shelves";

/** The Library's tabs: its own two, everything she added herself, the finished reels and sets, which have their own pages, and everything hearted. */
export type LibraryTabId = LibraryTab | "quotes" | "uploads" | "reels" | "carousels" | "favorites";

function StackIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <rect x="7" y="4" width="13" height="16" rx="2" />
      <path d="M4 7v11a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function QuoteIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M10 7H6a1 1 0 0 0-1 1v4h5V7Zm0 5c0 3-1.5 4.5-4 5M19 7h-4a1 1 0 0 0-1 1v4h5V7Zm0 5c0 3-1.5 4.5-4 5" />
    </svg>
  );
}

function UploadIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M12 15V4m0 0-4 4m4-4 4 4M5 19.5h14" />
    </svg>
  );
}

/* Photos, Clips, Quotes, Uploads, Reels, Carousels, Favorites. Uploads sits beside
   the two kinds because it is the same material, sorted by where it came
   from rather than by kind, across every avatar. The folder that is open stays open across
   the switch between Photos and Clips: the tab is the kind filter, the folder
   is the shoot. Uploads, Reels, Carousels and Favorites are pages of their own and take no folder.
   A count shows only where the page already has it. */
export function LibraryTabs({
  tab,
  folder,
  counts = {},
}: {
  tab: LibraryTabId;
  /** The folder in the URL, passed through untouched. */
  folder?: string;
  counts?: Partial<Record<LibraryTabId, number>>;
}) {
  const tabs: { id: LibraryTabId; label: string; href: string; Icon: (props: { className?: string }) => React.ReactNode }[] = [
    { id: "photos", label: "Photos", href: libraryHref("photos", folder), Icon: FaceIcon },
    { id: "videos", label: "Clips", href: libraryHref("videos", folder), Icon: PlayIcon },
    // The words shelf of the Photos tab, given a tab so her quote photos are one tap away.
    { id: "quotes", label: SHELF_LABEL.words.name, href: libraryHref("photos", undefined, { shelf: "words" }), Icon: QuoteIcon },
    { id: "uploads", label: "Uploads", href: "/library/uploads", Icon: UploadIcon },
    { id: "reels", label: "Reels", href: "/reels", Icon: ReelIcon },
    // Square sets and tall story sequences alike.
    { id: "carousels", label: "Carousels", href: "/carousels", Icon: StackIcon },
    { id: "favorites", label: "Favorites", href: "/library/favorites", Icon: HeartIcon },
  ];
  return (
    <nav aria-label="Library" className="-mx-gutter mb-5 overflow-x-auto px-gutter md:mx-0 md:px-0">
      <ul className="inline-flex rounded-lg border border-line bg-sunken p-1">
        {tabs.map(({ id, label, href, Icon }) => {
          const active = id === tab;
          const count = counts[id];
          return (
            <li key={id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:gap-2 sm:px-4 ${
                  active ? "bg-surface font-semibold text-ink shadow-card" : "text-ink-soft hover:text-ink"
                }`}
              >
                <Icon className={`hidden size-4 sm:block ${active ? "text-accent" : "text-muted"}`} />
                {label}
                {count !== undefined && <span className="tabular-nums text-muted">{count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

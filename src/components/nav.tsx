"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { Logo } from "@/components/logo";
import { DoneDot } from "@/components/ui/badge";
import { PRODUCT_NAME } from "@/lib/product";
import type { NavItem } from "@/lib/nav-items";
import {
  CalendarIcon,
  CompassIcon,
  DocIcon,
  FaceIcon,
  HomeIcon,
  LibraryIcon,
  PenIcon,
  ReelIcon,
  SparkIcon,
} from "@/components/ui/icons";

export type { NavItem } from "@/lib/nav-items";

/* Two glyphs the icon set does not have yet, drawn to its conventions and kept
   here rather than in src/components/ui: the pages they point at belong to
   other branches, and the icon set is a shared file. */
function StackIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <rect x="7" y="4" width="13" height="16" rx="2" />
      <path d="M4 7v11a2 2 0 0 0 2 2h1" />
    </svg>
  );
}

function GearIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const ICONS: Record<string, (props: { className?: string }) => ReactNode> = {
  "/": HomeIcon,
  "/brief": DocIcon,
  "/brand": CompassIcon,
  "/avatar": FaceIcon,
  "/library": LibraryIcon,
  "/create": SparkIcon,
  "/hooks": PenIcon,
  "/reels": ReelIcon,
  "/carousels": StackIcon,
  "/week": CalendarIcon,
  "/billing": GearIcon,
};

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
}

export function Wordmark({ className = "", small = false }: { className?: string; small?: boolean }) {
  return (
    <Link href="/" className={`inline-flex min-h-11 items-center ${className}`} aria-label={`${PRODUCT_NAME} home`}>
      <Logo className={small ? "text-xl" : "text-2xl"} />
    </Link>
  );
}

/** Settings, next to the account control in both shells: the Account page,
    where the credits left and what they were spent on are listed. */
export function BillingLink({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <Link
        href="/account"
        aria-label="Settings"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-muted transition-colors hover:text-ink"
      >
        <GearIcon className="size-5" />
      </Link>
    );
  }
  return (
    <Link
      href="/account"
      className="flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-ink-soft transition-colors hover:bg-sunken hover:text-ink"
    >
      <GearIcon className="size-5 shrink-0 text-muted" />
      <span className="flex-1 truncate">Settings</span>
    </Link>
  );
}

export type AvatarNav = { name: string };

/** Which avatar the pages are about, and the way to the others. The rail
    only: on a phone the switcher is on the Home page, where there is room. */
function AvatarLink({ avatar }: { avatar: AvatarNav }) {
  const isActive = useActive();
  const active = isActive("/avatars");
  return (
    <Link
      href="/avatars"
      aria-current={active ? "page" : undefined}
      className={`-mt-4 flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
        active ? "bg-accent-soft font-semibold text-accent" : "text-ink-soft hover:bg-sunken hover:text-ink"
      }`}
    >
      <FaceIcon className={`size-5 shrink-0 ${active ? "text-accent" : "text-muted"}`} />
      <span className="min-w-0 flex-1 truncate">{avatar.name}</span>
      <span className="shrink-0 text-xs text-muted">Switch</span>
    </Link>
  );
}

/** Desktop rail: wordmark, the steps with their done state, settings, account. */
export function Sidebar({ items, account, avatar }: { items: NavItem[]; account: ReactNode; avatar?: AvatarNav }) {
  const isActive = useActive();
  return (
    <div className="flex h-full flex-col gap-8 px-5 py-7">
      <Wordmark />
      {avatar && <AvatarLink avatar={avatar} />}
      <nav aria-label="Steps" className="flex-1">
        <ul className="space-y-0.5">
          {items.map((item, index) => {
            const Icon = ICONS[item.href] ?? HomeIcon;
            const active = isActive(item.href);
            // A gap where the daily pages end and the ones set up once begin.
            const gap = index > 0 && items[index - 1].group !== item.group;
            return (
              <li key={item.href} className={gap ? "mt-4 border-t border-line pt-4" : undefined}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
                    active ? "bg-accent-soft font-semibold text-accent" : "text-ink-soft hover:bg-sunken hover:text-ink"
                  }`}
                >
                  <Icon className={`size-5 shrink-0 ${active ? "text-accent" : "text-muted"}`} />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.done !== undefined && <DoneDot done={item.done} />}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="space-y-2">
        <BillingLink />
        <div className="rule border-t border-line pt-4">{account}</div>
      </div>
    </div>
  );
}

/** Phone header: wordmark, settings, account. Steps live at the bottom of
    the screen and the avatar switcher on the Home page. The account is its
    picture alone: with the avatar's name beside it the account's name read as
    the same word twice, and the row ran wider than a phone, which squeezed the
    wordmark to make room. The wordmark never shrinks. */
export function TopBar({ account }: { account: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex min-h-14 items-center justify-between gap-2 border-b border-line bg-canvas/95 px-gutter backdrop-blur md:hidden">
      <Wordmark className="shrink-0" small />
      <div className="flex min-w-0 items-center gap-2">
        <BillingLink compact />
        {account}
      </div>
    </header>
  );
}

/** Phone bottom bar. Five destinations, each a 44px-plus target with its done dot. */
export function BottomNav({ items }: { items: NavItem[] }) {
  const isActive = useActive();
  return (
    <nav
      aria-label="Steps"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const Icon = ICONS[item.href] ?? HomeIcon;
          const active = isActive(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-center ${
                  active ? "text-accent" : "text-muted"
                }`}
              >
                <span className="relative">
                  <Icon className="size-5" />
                  {item.done && (
                    <>
                      <span
                        className="absolute -top-0.5 -right-1 size-1.5 rounded-full bg-good ring-2 ring-canvas"
                        aria-hidden="true"
                      />
                      <span className="sr-only">done</span>
                    </>
                  )}
                </span>
                <span className={`text-[0.625rem] leading-none ${active ? "font-semibold" : "font-medium"}`}>
                  {item.short ?? item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* What the menu lists, in one place and with nothing behind it, so the order
   can be tested. The rail shows every item; the phone's bottom bar shows the
   `primary` five. Reels and Carousels are not here: they are tabs of Library. */

export type NavItem = {
  href: string;
  label: string;
  /** Short label for the bottom bar, where five words have to fit across a phone. */
  short?: string;
  /** Setup is not finished and this is one of its steps: a dot, ticked when done. */
  done?: boolean;
  /** Shown in the phone's bottom bar. The rest live in the rail and on Overview. */
  primary?: boolean;
  /** The rail draws a gap between groups: what she makes every day, then what is set up once. */
  group: "daily" | "setup";
};

/**
 * `done` says whether a setup step (by its href) is finished; `setupFinished`
 * takes the dots away once all of them are, because then they say nothing.
 */
export function navItems(done: (href: string) => boolean, setupFinished: boolean): NavItem[] {
  const step = (href: string) => (setupFinished ? {} : { done: done(href) });
  return [
    { href: "/", label: "Overview", short: "Home", primary: true, group: "daily" },
    // The agent: talk about the week, get the week's posts.
    { href: "/week", label: "Your week", short: "Week", primary: true, group: "daily" },
    // The composer: one message makes a reel, photos or a set.
    { href: "/create", label: "Create", short: "Create", primary: true, group: "daily", ...step("/create") },
    { href: "/hooks", label: "Hooks", short: "Hooks", group: "daily" },
    { href: "/library", label: "Library", short: "Library", primary: true, group: "daily", ...step("/library") },
    { href: "/brand", label: "Brand", short: "Brand", primary: true, group: "setup", ...step("/brand") },
    { href: "/avatar", label: "Avatar", short: "Avatar", group: "setup", ...step("/avatar") },
  ];
}

/** The phone's bottom bar: exactly the primary items, in rail order. */
export const bottomBarItems = (items: NavItem[]): NavItem[] => items.filter((item) => item.primary);

import { ClerkProvider, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Fraunces, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import "./globals.css";

import { gateDecision, PATHNAME_HEADER } from "@/app/onboarding/flow";
import { BottomNav, Sidebar, TopBar } from "@/components/nav";
import { referenceCount, type Avatar } from "@/data/avatars";
import { getProfile, profileComplete } from "@/data/brand";
import { listDrafts } from "@/data/drafts";
import { listMedia } from "@/data/media";
import { bottomBarItems, navItems, type NavItem } from "@/lib/nav-items";
import { setupComplete, setupSteps } from "@/lib/setup";
import { backfillOnboarded, getSession } from "@/data/onboarding";
import { requireUser, type User } from "@/data/users";
import { PRODUCT_NAME } from "@/lib/product";
import { canSwitchAvatars, currentAvatar } from "@/lib/current-avatar";

/* One display face and one text face. Fraunces carries the headings and the
   creator's own words; Instrument Sans carries everything she has to read
   quickly. Both are variable, so weight costs no extra request. */
const display = Fraunces({ variable: "--font-fraunces", subsets: ["latin"], display: "swap" });
const sans = Instrument_Sans({ variable: "--font-instrument-sans", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: `${PRODUCT_NAME}`,
  description: "Build an AI avatar and run the content engine behind it.",
  /* The app is private; the marketing site is the page search engines should
     find. Without this the sign-in screen gets indexed under the app domain. */
  robots: { index: false, follow: false },
};

async function steps(user: User, avatar: Avatar | null): Promise<NavItem[]> {
  const [profile, references, clips, drafts] = await Promise.all([
    getProfile(user.id, avatar?.id ?? null),
    avatar ? referenceCount(user.id, avatar.id) : 0,
    listMedia(user.id, "clip", { limit: 1, avatarId: avatar?.id, orUnassigned: true }),
    listDrafts(user.id, { avatarId: avatar?.id }),
  ]);
  const steps = setupSteps({
    profileComplete: profileComplete(profile),
    references,
    clips: clips.length,
    drafts: drafts.length,
    assembled: drafts.filter((draft) => draft.status !== "draft").length,
  });
  const done = (href: string) => steps.find((step) => step.href === href)?.done ?? false;
  return navItems(done, setupComplete(steps));
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /* The sign-in and sign-up screens render through this layout too, with no
     account and no database row yet, so the shell only goes up once there is one. */
  const { isAuthenticated } = await auth();
  const user = isAuthenticated ? await requireUser() : null;

  /* The gate. Every app page renders through this layout, so this is the one
     place that sees them all; the pathname comes from src/proxy.ts. An account
     that has not finished setup is sent into it, and a finished one is sent
     back out, which is the same rule read in both directions. */
  const pathname = (await headers()).get(PATHNAME_HEADER) ?? "";
  /* An account from before there was a setup interview has already done all of
     it; it just has nothing in the column. It is filled in here rather than
     marching a working account through the questions again. */
  const onboarded = Boolean(user?.onboardedAt) || (user ? Boolean(await backfillOnboarded(user.id)) : false);
  /* Setup is a full-screen flow with its own chrome: the step rail would offer
     five destinations that all bounce straight back here. */
  const inSetup = pathname === "/onboarding" || pathname.startsWith("/onboarding/");
  /* A finished account inside setup is adding another avatar, if and only if
     its session has been started again and not completed. Read only then. */
  const setupInProgress = user && onboarded && inSetup ? (await getSession(user.id))?.completedAt === null : false;
  const elsewhere = gateDecision({ pathname, signedIn: Boolean(user), onboarded, setupInProgress });
  if (elsewhere) redirect(elsewhere);

  // The one-time terms page stands on its own: every link in the shell would bounce straight back to it.
  const shell = Boolean(user) && !inSetup;

  const avatar = shell && user ? await currentAvatar(user.id) : null;
  const items = shell && user ? await steps(user, avatar) : [];
  /* Only for an account that can have more than one: a one-avatar plan sees
     the menu it always saw. */
  const avatarNav = shell && user && avatar && (await canSwitchAvatars(user)) ? { name: avatar.name } : undefined;
  const account = (
    <UserButton
      showName
      appearance={{ elements: { userButtonTrigger: "min-h-11 px-1", userButtonBox: "gap-2", userButtonAvatarBox: "size-8" } }}
    />
  );
  // The phone bar has room for the picture only; the rail has room for the name as well.
  const phoneAccount = <UserButton appearance={{ elements: { userButtonTrigger: "min-h-11 px-1", userButtonAvatarBox: "size-8" } }} />;

  return (
    <ClerkProvider
      /* The headings name the product from our own constant, not from the Clerk
         dashboard's application name, so a rename is still one line. */
      localization={{
        signIn: { start: { title: `Sign in to ${PRODUCT_NAME}`, subtitle: "Welcome back." } },
        signUp: { start: { title: "Create your first avatar for free", subtitle: "" } },
      }}
      appearance={{
        variables: {
          colorPrimary: "#7b2f3e",
          colorForeground: "#201d1a",
          colorMutedForeground: "#453f38",
          colorBackground: "#fffefb",
          colorInput: "#fffefb",
          colorBorder: "#e5dfd4",
          borderRadius: "0.625rem",
          fontFamily: "var(--font-instrument-sans)",
        },
        /* Clerk's "Development mode" strip only exists with development keys and
           fails colour contrast against our palette. Its classes are hashed, so it
           is switched off rather than restyled; production never shows it. */
        options: { unsafe_disableDevelopmentModeWarnings: true },
      }}
    >
      {/* Browser extensions (a translator, a dark-mode switch) add attributes to <html> before React loads; that is theirs, not a mismatch of ours. */}
      <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} h-full antialiased`}>
        <body className="min-h-full">
          {shell ? (
            <div className="md:flex md:min-h-screen">
              <a
                href="#main"
                className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:text-canvas"
              >
                Skip to content
              </a>
              <TopBar account={phoneAccount} />
              <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line md:block">
                <Sidebar items={items} account={account} avatar={avatarNav} />
              </aside>
              <main id="main" className="min-w-0 flex-1 px-gutter pt-7 pb-bottomnav md:px-10 md:pt-12 md:pb-16">
                <div className="mx-auto w-full max-w-5xl">{children}</div>
              </main>
              <BottomNav items={bottomBarItems(items)} />
            </div>
          ) : (
            children
          )}
        </body>
      </html>
    </ClerkProvider>
  );
}

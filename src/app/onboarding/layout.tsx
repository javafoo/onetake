import { UserButton } from "@clerk/nextjs";

import { Wordmark } from "@/components/nav";

/* One column, phone width, and nothing else.

   The app's own step rail is deliberately absent — the root layout drops it
   here — because every destination on it would bounce straight back. The
   progress bar and the way out belong to each screen (see
   src/components/onboarding/screen.tsx): a layout is not re-rendered when only
   the page under it changes, so anything here that counted steps would count
   them one behind. */

export default function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-gutter pb-16 sm:px-8">
      <header className="flex min-h-14 items-center justify-between gap-3 py-2">
        <Wordmark />
        <div className="flex items-center gap-1">
          <UserButton appearance={{ elements: { userButtonTrigger: "min-h-11 px-1", userButtonAvatarBox: "size-8" } }} />
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}

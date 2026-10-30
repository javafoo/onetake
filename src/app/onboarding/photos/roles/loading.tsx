import { Ask } from "@/components/onboarding/progress";
import { SetupScreen } from "@/components/onboarding/screen";
import { Skeleton } from "@/components/ui";

/** The curation pass is a vision call over every photo, so this screen is a few
    seconds behind the tap that opened it. Saying what is happening beats a
    frozen button. */
export default function LoadingRoles() {
  return (
    <SetupScreen stage="roles">
      <Ask help="Looking at each one to see which angle it covers. A few seconds.">Reading your photos</Ask>
      <div className="space-y-7">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row}>
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="mt-2 h-3 w-64" />
            <div className="mt-3 flex gap-2 overflow-hidden">
              {[0, 1, 2, 3, 4, 5].map((tile) => (
                <Skeleton key={tile} className="aspect-[3/4] w-[4.5rem] shrink-0" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </SetupScreen>
  );
}

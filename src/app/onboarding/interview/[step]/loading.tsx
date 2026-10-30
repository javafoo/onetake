import { Skeleton } from "@/components/ui";

/** The coach drafts the options for this step while the screen is on its way,
    so the question frame is up in one paint and only the suggestions wait. */
export default function LoadingStep() {
  return (
    <div>
      <Skeleton className="h-7 w-4/5" />
      <Skeleton className="mt-3 h-4 w-3/5" />
      <div className="mt-8 space-y-2">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
      </div>
      <Skeleton className="mt-3 h-28 w-full" />
      <Skeleton className="mt-6 h-12 w-full" />
    </div>
  );
}

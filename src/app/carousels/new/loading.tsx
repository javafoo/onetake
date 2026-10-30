import { Skeleton, SkeletonText } from "@/components/ui";

/* The form waits on one short text call: three topics drawn from her brief.
   This is what stands in its place, so the page arrives at once instead of
   after the model does. */

export default function Loading() {
  return (
    <div className="space-y-10">
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-9 w-72" />
        <SkeletonText lines={2} />
      </div>
      <Skeleton className="h-24 w-full" />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="aspect-[4/5] w-full" />
        ))}
      </div>
    </div>
  );
}

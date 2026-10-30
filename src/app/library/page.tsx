import { LibraryView } from "@/components/library/library-view";

export const dynamic = "force-dynamic";

/* Photo jobs keep working after the response, inside this route's time limit.
   A photo takes about a minute; without this Vercel would stop the job early
   and it would be refunded instead of finished. */
export const maxDuration = 300;

export default function LibraryPhotosPage({ searchParams }: PageProps<"/library">) {
  return <LibraryView tab="photos" searchParams={searchParams} />;
}

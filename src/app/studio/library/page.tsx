import { permanentRedirect } from "next/navigation";
import { pathWithSearch } from "@/lib/redirect-path";

/**
 * /studio/library moved to /designs (2026-09-27, revising nav model A): My
 * Designs is a top-level destination now, not a Studio view. A permanent
 * (308) redirect carries the query string so bookmarks, shared links and
 * `?from=` markers keep working.
 */
export default async function StudioLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<never> {
  permanentRedirect(pathWithSearch("/designs", await searchParams));
}

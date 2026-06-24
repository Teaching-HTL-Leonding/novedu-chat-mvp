import { PageLoading } from "@/app/page-loading";

// Shown while the (all-codes) list renders — a long list can take a moment, so
// the navigation/Apply gives immediate feedback instead of a frozen page.
export default function Loading() {
  return <PageLoading label="Loading codes…" />;
}

import { PageLoading } from "@/app/page-loading";

// Shown while the reports inbox renders — the filtered query + joins can take a
// moment, so navigation/Apply gives immediate feedback instead of a frozen page.
export default function Loading() {
  return <PageLoading label="Loading reports…" />;
}

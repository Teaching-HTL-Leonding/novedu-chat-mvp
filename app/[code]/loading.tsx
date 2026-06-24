import { PageLoading } from "@/app/page-loading";

// Opening a code validates it and loads its activity YAML server-side (a tutor
// chat or a quiz), which can take a moment — show a busy indicator instead of a
// blank page. The label is module-neutral because the same route serves both.
export default function Loading() {
  return <PageLoading label="Opening…" />;
}

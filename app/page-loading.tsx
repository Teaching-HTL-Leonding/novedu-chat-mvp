import { Main } from "@/components/page-main";
import { LoadingPanel } from "@/components/spinner";

// Shared route-level loading fallback: the page's <main> chrome wrapping a
// centered LoadingPanel. Each route's loading.tsx renders this with its label.
export function PageLoading({ label }: { label?: string }) {
  return (
    <Main>
      <LoadingPanel label={label} />
    </Main>
  );
}

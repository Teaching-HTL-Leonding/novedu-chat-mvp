import { LoadingPanel } from "@/components/spinner";
import styles from "./page.module.css";

// Shared route-level loading fallback: the page's <main> chrome wrapping a
// centered LoadingPanel. Each route's loading.tsx renders this with its label.
export function PageLoading({ label }: { label?: string }) {
  return (
    <main className={styles.main}>
      <LoadingPanel label={label} />
    </main>
  );
}

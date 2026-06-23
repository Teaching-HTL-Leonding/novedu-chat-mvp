import { LoadingPanel } from "@/components/spinner";
import pageStyles from "../page.module.css";

// Shown while the (all-codes) list renders — a long list can take a moment, so
// the navigation/Apply gives immediate feedback instead of a frozen page.
export default function Loading() {
  return (
    <main className={pageStyles.main}>
      <LoadingPanel label="Loading codes…" />
    </main>
  );
}

import { LoadingPanel } from "@/components/spinner";
import pageStyles from "../page.module.css";

// Opening a tutor-code link validates the code + tutor YAML server-side, which
// can take a moment — show a busy indicator instead of a blank page.
export default function Loading() {
  return (
    <main className={pageStyles.main}>
      <LoadingPanel label="Opening chat…" />
    </main>
  );
}

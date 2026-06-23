import { LoadingPanel } from "@/components/spinner";
import pageStyles from "../../../page.module.css";

export default function Loading() {
  return (
    <main className={pageStyles.main}>
      <LoadingPanel label="Loading code…" />
    </main>
  );
}

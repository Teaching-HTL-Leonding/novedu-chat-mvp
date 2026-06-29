import { resolveAppOriginOr } from "@/lib/app-origin";
import type { CodeEntry } from "@/lib/code-store";
import { codingConnectionProps, loadCoding } from "@/lib/coding-fetch";
import styles from "../page.module.css";
import connStyles from "./_coding/coding.module.css";
import { CodingConnection } from "./_coding/coding-connection";

// The coding module's STUDENT render: a connection page. There is no in-app chat —
// the student drives an external OpenAI-compatible coding agent (e.g. little-coder)
// against the public /api/coding/v1 endpoint, using the CODE as the API key. This
// page just shows how to connect. The teacher's system prompt and the real model
// are NEVER sent here (the proxy applies them server-side); only the student-facing
// `title` is read from the YAML. Invoked by the module switch in app/[code]/page.tsx.
export async function RenderCoding({ entry, code }: { entry: CodeEntry; code: string }) {
  const loaded = await loadCoding(entry.fileUrl);
  const origin = await resolveAppOriginOr("");
  const title = loaded.ok ? loaded.coding.title : undefined;

  return (
    <main className={styles.main}>
      <section className={connStyles.page}>
        <h1 className={connStyles.title}>{title ?? "Coding endpoint"}</h1>
        <CodingConnection {...codingConnectionProps(loaded, origin, code)} />
      </section>
    </main>
  );
}

import { Notice } from "@/components/notice";
import { resolveAppOriginOr } from "@/lib/app-origin";
import type { CodeEntry } from "@/lib/code-store";
import { codingConnectionProps, loadCoding } from "@/lib/coding-fetch";
import styles from "./coding.module.css";
import { CodingConnection } from "./coding-connection";

// The coding module's teacher detail body on /codes/[code]: the resolved config
// (pinned model + the server-only system prompt, teacher-only) and the connection
// details to hand to students. There are no per-student conversations (the API path
// is anonymous), so unlike tutor/quiz this is config + connection, not stats.
//
// SERVER COMPONENT: reads the coding YAML via `loadCoding`. The descriptor calls it
// as a plain function so no JSX lives in the server-only registry .ts file.
export async function CodingDetail({ entry }: { entry: CodeEntry }) {
  const loaded = await loadCoding(entry.fileUrl);
  const origin = await resolveAppOriginOr("");

  return (
    <>
      {loaded.ok ? (
        <>
          <div className={styles.detailSection}>
            <p className={styles.label}>Model (pinned)</p>
            <p>
              <code>{loaded.coding.model}</code>
            </p>
          </div>
          <div className={styles.detailSection}>
            <p className={styles.label}>System prompt</p>
            <pre className={styles.systemPrompt}>{loaded.coding.instructions}</pre>
          </div>
        </>
      ) : (
        <div className={styles.detailSection}>
          <Notice heading="This coding activity could not be loaded">
            <p>{loaded.message}</p>
          </Notice>
        </div>
      )}

      <div className={styles.detailSection}>
        <p className={styles.label}>Connection details</p>
        <CodingConnection {...codingConnectionProps(loaded, origin, entry.code)} />
      </div>
    </>
  );
}

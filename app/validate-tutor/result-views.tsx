import type { FragmentCheckResult, ValidationError, ValidationWarning } from "@/lib/tutors";
import styles from "./validate-tutor.module.css";

// Pure presentational views for a result's errors, warnings, and (for a fragment
// library) its successful summary. Kept separate from the form so they can be
// rendered and tested in isolation with plain props (no fetch, no state).

/** The success shape of a standalone fragment-FILE check. */
type OkFragment = Extract<FragmentCheckResult, { ok: true }>;

export function locationOf(item: {
  fileAlias?: string;
  fragmentId?: string;
  variable?: string;
}): string | null {
  const parts = [item.fileAlias, item.fragmentId].filter(Boolean).join(" / ");
  if (!parts && !item.variable) return null;
  return item.variable ? `${parts}${parts ? " · " : ""}${item.variable}` : parts;
}

export function ErrorList({ errors }: { errors: ValidationError[] }) {
  return (
    <section>
      <h2 className={styles.errorHeading}>Validation failed ({errors.length})</h2>
      <ul className={styles.list}>
        {errors.map((err) => {
          const where = locationOf(err);
          return (
            <li
              key={`${err.code}-${err.fragmentId ?? ""}-${err.variable ?? ""}-${err.message}`}
              className={styles.error}
            >
              <span className={styles.code}>{err.code}</span>
              <span className={styles.message}>{err.message}</span>
              {where ? <span className={styles.where}>{where}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function FragmentSummary({ result }: { result: OkFragment }) {
  const count = result.fragmentIds.length;
  return (
    <section>
      <h2 className={styles.summaryHeading}>
        Valid fragment library: <code>{result.fragmentFileId}</code>
      </h2>
      <p className={styles.muted}>
        {count} fragment{count === 1 ? "" : "s"} — every template renders against its declared
        inputs.
      </p>
      <ul className={styles.list}>
        {result.fragmentIds.map((id) => (
          <li key={id} className={styles.fragmentItem}>
            <span className={styles.code}>{id}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function WarningList({ warnings }: { warnings: ValidationWarning[] }) {
  return (
    <section>
      <h2 className={styles.warningHeading}>Warnings ({warnings.length})</h2>
      <ul className={styles.list}>
        {warnings.map((warn) => {
          const where = locationOf(warn);
          return (
            <li
              key={`${warn.code}-${warn.fragmentId ?? ""}-${warn.variable ?? ""}-${warn.message}`}
              className={styles.warning}
            >
              <span className={styles.code}>{warn.code}</span>
              <span className={styles.message}>{warn.message}</span>
              {where ? <span className={styles.where}>{where}</span> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

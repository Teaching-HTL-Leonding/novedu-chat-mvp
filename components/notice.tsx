import type { ReactNode } from "react";
import styles from "./notice.module.css";

// A centered full-page notice (access denied, invalid share link, ...). Server
// component — pure presentation, no state.
export function Notice({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.heading}>{heading}</h2>
        <div className={styles.body}>{children}</div>
      </div>
    </section>
  );
}

export function AccessDenied() {
  return (
    <Notice heading="Access denied">
      <p>
        This page is only available to teachers. If you believe you should have access, contact your
        administrator.
      </p>
    </Notice>
  );
}

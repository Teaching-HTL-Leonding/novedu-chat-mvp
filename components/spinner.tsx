import styles from "./spinner.module.css";

// Inline spinner for "busy" buttons (e.g. the filter's Apply while a navigation
// is pending). Decorative — the surrounding control carries the accessible state
// (`disabled` / `aria-busy`).
export function Spinner({ className }: { className?: string }) {
  return <span className={`${styles.spinner} ${className ?? ""}`} aria-hidden="true" />;
}

// Centered "the page is loading" panel for route-level `loading.tsx` fallbacks —
// shown by Next while a slow server segment renders (initial open / link click).
export function LoadingPanel({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={styles.panel} role="status" aria-live="polite">
      <span className={`${styles.spinner} ${styles.panelSpinner}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

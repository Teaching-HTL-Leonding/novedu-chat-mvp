"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useTransition } from "react";
import styles from "./list-page.module.css";
import { Spinner } from "./spinner";

// The reusable filter bar for "filtered list" pages (see `docs/filtered-lists.md`).
// It owns ONE thing: turning the filter controls into URL search params on
// "Apply" so the SERVER re-queries the database — filtering NEVER happens in
// memory. Each page supplies its own controls as `children` (any element with a
// `name`); they render in the same top-right spot with the same Apply/Clear
// behavior. The current values are server-rendered into the controls'
// `defaultValue`/`defaultChecked`, so this needs no `useSearchParams`.
//
// Serialization rule (kept generic): text/select controls contribute their value
// when non-empty; checkboxes always contribute "1" (checked) or "0" (unchecked),
// so a server page reads e.g. `mine !== "0"` for a default-on toggle. "Apply"
// resets to the first page (no `page` param is carried over).
export function ListFilterBar({
  children,
  hasActiveFilter = false,
  resetKey,
}: {
  children: ReactNode;
  hasActiveFilter?: boolean;
  // A signature of the CURRENTLY-APPLIED filter (from the URL). The controls are
  // uncontrolled (server-rendered `defaultValue`/`defaultChecked`), so React would
  // otherwise keep a typed value in the DOM after the URL changes — notably after
  // "Clear". Using it as the form's `key` remounts the inputs whenever the applied
  // filter changes, re-seeding them from the server's fresh defaults.
  resetKey?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Wrapping the navigation in a transition gives an `isPending` flag while the
  // (possibly slow) server re-renders the list — the previous list stays visible
  // and the Apply button shows a spinner, so the click visibly "does something".
  const [isPending, startTransition] = useTransition();

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const element of Array.from(event.currentTarget.elements)) {
      if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) continue;
      const name = element.name;
      if (!name) continue;
      if (element instanceof HTMLInputElement) {
        if (element.type === "submit" || element.type === "button" || element.type === "reset") {
          continue;
        }
        if (element.type === "checkbox") {
          params.set(name, element.checked ? "1" : "0");
          continue;
        }
      }
      const value = element.value.trim();
      if (value) params.set(name, value);
    }
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <form key={resetKey} className={styles.filters} onSubmit={apply} aria-busy={isPending}>
      {children}
      <button type="submit" className={styles.applyButton} disabled={isPending}>
        {isPending ? (
          <>
            <Spinner /> Applying…
          </>
        ) : (
          "Apply"
        )}
      </button>
      {hasActiveFilter ? (
        <button
          type="button"
          className={styles.clearLink}
          disabled={isPending}
          onClick={() => startTransition(() => router.push(pathname))}
        >
          Clear
        </button>
      ) : null}
    </form>
  );
}

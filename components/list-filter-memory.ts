// Remembering the last applied filter of a list page (see `docs/filtered-lists.md`).
//
// The URL search params stay the ONE source of filter truth: the server page reads
// them and the database does the filtering. This module remembers, per list route,
// the query string that was last applied, so that a link BACK to that list can
// START from it — the burger menu (`components/nav-menu.tsx`) and the "← Back to …"
// links (`components/back-link.tsx`). Nothing here ever filters anything, and a
// list page never reads this: navigating to a bare `/codes` still shows the plain
// list.
//
// Deliberately NO `"use client"` directive (same as `use-popover.ts`): every
// importer is already a client component, and this way the SERVER `data-list.tsx`
// can import the client leaf next door without pulling a plain function out of a
// `"use client"` module.

const KEY_PREFIX = "novedu:list-filter:";

/** The storage key for a list route, e.g. `/codes`. */
export function listFilterKey(pathname: string): string {
  return `${KEY_PREFIX}${pathname}`;
}

// Storage can be missing (server render) or throw on ACCESS alone (some privacy
// modes). Navigation must never break over a remembered filter, so every path
// through this module degrades to "nothing remembered".
function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Records the filter currently applied to `pathname`. An EMPTY `search` removes
 * the entry rather than storing a blank, so "Clear" genuinely forgets.
 */
export function rememberListFilter(pathname: string, search: string): void {
  const store = storage();
  if (!store) return;
  try {
    if (search) store.setItem(listFilterKey(pathname), search);
    else store.removeItem(listFilterKey(pathname));
  } catch {
    // Full or read-only storage: the filter is simply not remembered.
  }
}

/**
 * The href to use for a link to a list, with the remembered filter appended when
 * there is one. An href that already carries its own query (or a fragment) is
 * returned untouched — the caller asked for a specific view. Safe to call for ANY
 * href: only the four list routes ever write an entry, so everything else misses.
 */
export function rememberedListHref(href: string): string {
  if (href.includes("?") || href.includes("#")) return href;
  const store = storage();
  if (!store) return href;
  try {
    const remembered = store.getItem(listFilterKey(href));
    return remembered ? `${href}?${remembered}` : href;
  } catch {
    return href;
  }
}

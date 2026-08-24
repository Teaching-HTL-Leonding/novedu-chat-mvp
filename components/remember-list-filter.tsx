"use client";

import { useEffect } from "react";
import { rememberListFilter } from "./list-filter-memory";

// The write half of the list-filter memory (see `docs/filtered-lists.md`).
// `DataList` mounts one of these per list ROUTE — never for an embedded list,
// which has no pathname of its own — so every applied filter is recorded exactly
// once, with no per-page wiring. It renders nothing.
export function RememberListFilter({ pathname, search }: { pathname: string; search: string }) {
  useEffect(() => {
    rememberListFilter(pathname, search);
  }, [pathname, search]);
  return null;
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useTransition } from "react";
import { ALL_OWNERS, type OwnerOption } from "@/lib/db/owner-filter";
import { DEFAULT_PAGE_SIZE } from "@/lib/db/paging";
import { formatSort, type Sort } from "@/lib/db/sorting";
import { Spinner } from "./spinner";
import { Button } from "./ui/button";
import { Select } from "./ui/input";

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
// resets to the first page (no `page` param is carried over) and keeps a
// non-default `?size=` and the active `?sort=` alive via the hidden inputs below;
// "Clear" drops them all.
export function ListFilterBar({
  children,
  hasActiveFilter = false,
  resetKey,
  pageSize,
  sort,
}: {
  children: ReactNode;
  hasActiveFilter?: boolean;
  // The list's CURRENT page size. A non-default one came from a `?size=` override,
  // and the serializer only keeps what the form contains — so it rides along as a
  // hidden input. "Clear" deliberately drops it with everything else.
  pageSize?: number;
  // The list's CURRENT column sort, for the same reason as `pageSize`: it comes
  // from the URL, not from a form control, so it rides along as a hidden input.
  sort?: Sort;
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
    <form
      key={resetKey}
      className="flex flex-wrap items-center gap-3"
      onSubmit={apply}
      aria-busy={isPending}
    >
      {children}
      {pageSize !== undefined && pageSize !== DEFAULT_PAGE_SIZE ? (
        <input type="hidden" name="size" value={pageSize} />
      ) : null}
      {sort ? <input type="hidden" name="sort" value={formatSort(sort)} /> : null}
      <Button type="submit" size="sm" disabled={isPending}>
        {isPending ? (
          <>
            <Spinner /> Applying…
          </>
        ) : (
          "Apply"
        )}
      </Button>
      {hasActiveFilter ? (
        <Button
          variant="link"
          disabled={isPending}
          onClick={() => startTransition(() => router.push(pathname))}
        >
          Clear
        </Button>
      ) : null}
    </form>
  );
}

// The shared OWNER dropdown for the filter bar — one recipe for every list page
// (codes, files, images); see `docs/filtered-lists.md`. The signed-in teacher is
// always the FIRST option and carries the empty value, which is what makes the
// default view param-free (the serializer above drops empty values) and what makes
// "Clear" land back on their own items with no extra logic.
//
// `options` are the owners the list actually has (`lib/db/owners.ts`). The current
// user is dropped from them — they are the first option already — and a selected oid
// that is not among them (a stale bookmark, or an owner whose last item was deleted)
// is appended so the control can never disagree with the URL.
export function OwnerFilter({
  noun,
  options,
  value,
  currentUserId,
  currentUserName,
  className,
}: {
  /** What the list holds, for the first option's text: `My codes (Alex Muster)`. */
  noun: string;
  options: OwnerOption[];
  /** `""` = me, `ALL_OWNERS`, or an oid — from `parseOwner`. */
  value: string;
  currentUserId: string;
  /** The signed-in teacher's display name, when the session carries one. */
  currentUserName?: string | null;
  className?: string;
}) {
  const others = options.filter((option) => option.userId !== currentUserId);
  // A URL that names MY oid explicitly is the same filter as the empty default, so
  // it selects the first option rather than appending me as a nameless stranger.
  const selected = value === currentUserId ? "" : value;
  if (selected !== "" && selected !== ALL_OWNERS && !others.some((o) => o.userId === selected)) {
    others.push({ userId: selected, label: selected });
  }
  return (
    <Select name="owner" className={className} defaultValue={selected} aria-label="Filter by owner">
      <option value="">{currentUserName ? `My ${noun} (${currentUserName})` : `My ${noun}`}</option>
      <option value={ALL_OWNERS}>All owners</option>
      {others.length > 0 ? (
        <optgroup label="Other owners">
          {others.map((option) => (
            <option key={option.userId} value={option.userId}>
              {option.label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  );
}

// The shared "Only my …" style checkbox control for the filter bar — one label
// recipe for every list page (the /reports inbox; the three item lists use the
// owner dropdown above).
export function FilterCheckbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap text-sm">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

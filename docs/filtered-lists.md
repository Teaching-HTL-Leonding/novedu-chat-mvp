# Filtered lists

Teacher-facing list screens (YAML Files at `/files`, Shared Tutor Codes at
`/tutor-codes`, and any future list) share **one** concept so they look and behave
the same and only have to be improved once. Read this before adding a new list or
touching `components/data-list.tsx`, `components/list-filter-bar.tsx`,
`components/list-page.module.css`, or a list page's `searchParams` handling.

## The one firm rule: filter in the database, never in memory

Filtering is a **SQL `WHERE`**, not a `Array.filter`/`useMemo`. The filter state
lives in the **URL search params**; the server page reads them and passes them to a
store function that builds a parameterized query. The list that renders is already
the filtered result. This keeps the page correct as data grows and makes pagination
a pure server concern later.

## The pieces

| Piece | Where | Role |
| --- | --- | --- |
| URL search params | `?q=…&mine=…` (+ future `?page=`) | the filter state, shareable + back-button friendly |
| Server page | `app/<list>/page.tsx` | `await searchParams`, parse, call the store, build rows + columns, render `DataList` |
| Store query | `lib/*-store.ts` | the actual SQL filter (see below) |
| `DataList<T>` | `components/data-list.tsx` (**server**) | column-driven table + empty/no-match + the pagination seam |
| `ListFilterBar` | `components/list-filter-bar.tsx` (**client**) | the only interactive bit: controls + **Apply** → push a new query string |
| `list-page.module.css` | shared chrome | container / toolbar / table / search input / buttons — same spot everywhere |

### Store: dynamic query, the Drizzle way

Build an `SQL[]` of optional conditions and apply them with `.where(and(...conditions))`
— `and()` over an empty array is a no-op, and `undefined` conditions are dropped.
Do not chain multiple `.where()` (each replaces the previous). Text search uses the
shared `containsAny(term, [cols])` from `lib/db/text-filter.ts` (a parameterized,
wildcard-escaped `LIKE`; mssql's default collation is case-insensitive, so no
`ilike`/`LOWER`). Example (`listFiles`):

```ts
const conditions: SQL[] = [isNull(files.validUntil)];
const term = opts?.search?.trim();
if (term) { const m = containsAny(term, [files.name, files.title, files.description]); if (m) conditions.push(m); }
if (opts?.createdBy) conditions.push(eq(files.createdBy, opts.createdBy));
// .select({…}).from(files).where(and(...conditions)).orderBy(desc(files.validFrom))
```

**Aggregated stats are a separate, single query — never per row.** When a list shows
a count joined from other tables (e.g. the tutor-code "Conversations" column comes
from the Mastra-owned `mastra_threads`/`mastra_messages`, joined by value and read
with raw `sql`), run the filtered list first, then **one** aggregate over the whole
result set (e.g. `getInteractionCounts(codes)` takes an `IN (…) … GROUP BY`). No
N+1.

### Server page wiring

`searchParams` is a `Promise` in Next 16 — `await` it. Reading it forces dynamic
rendering (these pages are already dynamic via `auth()`). Parse, query, map to plain
row objects (convert `Date`s to unix seconds for `LocalTime`), and render:

```tsx
const sp = await searchParams; // Promise<{ q?: string|string[]; mine?: string|string[] }>
const q = typeof sp.q === "string" ? sp.q : "";
const onlyMine = sp.mine !== "0";           // default ON; "0" turns it off
const rows = await listFiles({ search: q || undefined, createdBy: onlyMine ? userId : undefined });
return (
  <DataList
    rows={rows} getRowKey={(r) => r.id} columns={columns}
    actions={<Link href="/files/new" className={listStyles.button}>New file</Link>}
    filterBar={
      <ListFilterBar hasActiveFilter={q !== "" || !onlyMine}>
        <input type="search" name="q" defaultValue={q} aria-label="Filter files" placeholder="Filter…" />
        <label className={listStyles.onlyMine}>
          <input type="checkbox" name="mine" defaultChecked={onlyMine} /> Only my files
        </label>
      </ListFilterBar>
    }
    isFiltered={q.trim() !== ""}
    emptyState={<>No files yet. <Link href="/files/new">Create one</Link>.</>}
    noMatchState="No files match your filter."
  />
);
```

`columns` are `{ header, render(row), className?, srOnlyHeader? }`. Because `DataList`
is a **server** component, the `render` functions live in the page and may return
client leaf components (`LocalTime`, `CopyIconButton`, delete buttons) — no
Server→Client function-prop boundary is crossed (that only applies to `"use client"`
components).

### `ListFilterBar` serialization

On **Apply** it walks the form controls and builds a `URLSearchParams`: text/select
contribute their value when non-empty; **checkboxes always contribute `"1"`/`"0"`**
(so a server reads a default-on toggle as `mine !== "0"`); `page` is dropped (reset
to the first page). It uses `useRouter`/`usePathname` only — current values are
server-rendered into `defaultValue`/`defaultChecked`, so no `useSearchParams`
(avoids its Suspense caveat). Any control with a `name` participates, so a future
filter (a `<select>`, a date range) drops in without touching the bar.

## Adding a new list

1. Add (or extend) a store function that takes `{ search?, createdBy?, … }` and
   filters in SQL with the `and(...conditions)` pattern.
2. Make the page `async`, `await searchParams`, query, map to plain rows.
3. Render `DataList` with your `columns`, an `actions` button, and a `ListFilterBar`
   holding your controls.
4. Put list-specific cell/badge classes in the page's own `*.module.css`; reuse the
   shared chrome and `composes:` the shared `iconButton`.

## Pagination (not built yet)

The seam is reserved: the store query is the single place to add `LIMIT/OFFSET`
(via `.$dynamic()` if needed), and `DataList` has a marked spot below the table for
a server-rendered pager (prev/next `<Link>`s that set `?page=`). Adding it lands in
those two places and applies to every list at once.

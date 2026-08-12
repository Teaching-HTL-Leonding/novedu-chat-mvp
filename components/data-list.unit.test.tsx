// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataList, ListTable } from "./data-list";

// ListTable's per-row class seam: `rowClassName` styles each <tr> from its row
// (the codes list's module accent stripe), plus DataList's pager — the shared
// prev/next chrome every list page gets from one place. Hermetic node render, no
// browser.

const rows = [
  { id: "a", module: "tutor" },
  { id: "b", module: "quiz" },
];

const columns = [{ header: "Id", render: (row: (typeof rows)[number]) => row.id }];

it("applies rowClassName per row", () => {
  const html = renderToStaticMarkup(
    <ListTable
      rows={rows}
      getRowKey={(row) => row.id}
      columns={columns}
      rowClassName={(row) => (row.module === "tutor" ? "accent-tutor" : "accent-quiz")}
    />,
  );
  expect(html).toContain('<tr class="accent-tutor">');
  expect(html).toContain('<tr class="accent-quiz">');
});

it("renders plain rows when rowClassName is omitted", () => {
  const html = renderToStaticMarkup(
    <ListTable rows={rows} getRowKey={(row) => row.id} columns={columns} />,
  );
  expect(html).not.toContain("<tr class=");
  expect(html).toContain("<tr>");
});

describe("DataList pager", () => {
  // Flat here so a case reads as `{ ...base, page: 3 }`; the component takes the
  // URL as two top-level props and the page numbers as one `PagedResult`.
  const renderList = (
    pagination?: {
      pathname: string;
      params: Record<string, string | string[] | undefined>;
      page: number;
      pageSize: number;
      total: number;
    },
    testRows: typeof rows = rows,
  ) =>
    renderToStaticMarkup(
      <DataList
        rows={testRows}
        getRowKey={(row) => row.id}
        columns={columns}
        isFiltered={false}
        emptyState="No rows yet."
        noMatchState="Nothing matches."
        pathname={pagination?.pathname}
        params={pagination?.params}
        pagination={
          pagination && {
            page: pagination.page,
            pageSize: pagination.pageSize,
            total: pagination.total,
          }
        }
      />,
    );

  const base = { pathname: "/files", params: { q: "lists" }, page: 1, pageSize: 2, total: 5 };

  it("renders no pager at all without the prop", () => {
    expect(renderList()).not.toContain("Pagination");
  });

  it("hides prev/next when everything fits on one page, keeping the range label", () => {
    const html = renderList({ ...base, total: 2 });
    expect(html).toContain("Showing 1–2 of 2");
    expect(html).not.toContain("Previous");
  });

  it("disables Previous on the first page and links Next with the filter preserved", () => {
    const html = renderList(base);
    expect(html).toContain("Showing 1–2 of 5");
    expect(html).toContain('aria-disabled="true"');
    // The non-default page size rides along, so a shared link keeps the same view.
    expect(html).toContain('href="/files?q=lists&amp;page=2&amp;size=2"');
  });

  it("links back and disables Next on the last page", () => {
    const html = renderList({ ...base, page: 3 });
    expect(html).toContain("Showing 5–5 of 5"); // rows overrun the total ⇒ capped
    // The non-default page size rides along, so a shared link keeps the same view.
    expect(html).toContain('href="/files?q=lists&amp;page=2&amp;size=2"');
    expect(html).not.toContain("page=4");
  });

  it("shows no pager chrome for an empty list", () => {
    const html = renderList({ ...base, total: 0 }, []);
    expect(html).toContain("No rows yet.");
    expect(html).not.toContain("Pagination");
  });
});

describe("sortable headers", () => {
  // A column opts in with `sortKey`; the table renders the link only when it is
  // also given the `sorting` bag (embedded tables pass neither).
  const sortableColumns = [
    { header: "Id", sortKey: "id", render: (row: (typeof rows)[number]) => row.id },
    { header: "Module", render: (row: (typeof rows)[number]) => row.module },
  ];

  const renderTable = (sort?: { key: string; dir: "asc" | "desc" }) =>
    renderToStaticMarkup(
      <ListTable
        rows={rows}
        getRowKey={(row) => row.id}
        columns={sortableColumns}
        sorting={{ pathname: "/files", params: { q: "a", page: "3" }, sort }}
      />,
    );

  it("links an unsorted column ascending, keeping the filter and dropping the page", () => {
    const html = renderTable();
    expect(html).toContain('href="/files?q=a&amp;sort=id"');
    expect(html).toContain('aria-sort="none"');
  });

  it("marks the active ascending column and offers descending next", () => {
    const html = renderTable({ key: "id", dir: "asc" });
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain('href="/files?q=a&amp;sort=-id"');
  });

  it("marks the active descending column and offers clearing the sort next", () => {
    const html = renderTable({ key: "id", dir: "desc" });
    expect(html).toContain('aria-sort="descending"');
    expect(html).toContain('href="/files?q=a"');
  });

  it("leaves a column without a sortKey plain — no link, no aria-sort", () => {
    const html = renderTable();
    // Only the one sortable column carries the attribute.
    expect(html.match(/aria-sort/g)).toHaveLength(1);
    expect(html.match(/<a /g)).toHaveLength(1);
  });

  it("renders plain headers when the table gets no sorting bag", () => {
    // The embedded ConversationStats / TokenSection path: a stray sortKey is inert.
    const html = renderToStaticMarkup(
      <ListTable rows={rows} getRowKey={(row) => row.id} columns={sortableColumns} />,
    );
    expect(html).not.toContain("aria-sort");
    expect(html).not.toContain("<a ");
  });
});

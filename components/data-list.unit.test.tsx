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
  // Flat here so a case reads as `{ ...base, page: 3 }`; the prop nests the page
  // numbers under `result` (they arrive as one `PagedResult` from the store).
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
        pagination={
          pagination && {
            pathname: pagination.pathname,
            params: pagination.params,
            result: {
              page: pagination.page,
              pageSize: pagination.pageSize,
              total: pagination.total,
            },
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

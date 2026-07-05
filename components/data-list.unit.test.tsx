// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ListTable } from "./data-list";

// ListTable's per-row class seam: `rowClassName` styles each <tr> from its row
// (the codes list's module accent stripe). Hermetic node render, no browser.

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

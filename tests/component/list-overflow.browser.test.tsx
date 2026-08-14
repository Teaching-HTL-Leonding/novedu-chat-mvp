import { afterEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

// next/link reads Next-server globals that don't exist in the browser test
// runner. `DataList` imports it for the pager and the sortable headers; neither
// renders here (no `pathname`/`params`), but the module still has to load.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// The list pages' WIDTH contract, measured in a real browser (see
// `docs/superpowers/specs/2026-08-14-wide-lists-design.md`):
//
//   1. every table's card is a horizontal SCROLLER — a table wider than its
//      column is reachable, never clipped (the regression guard for the bug
//      where /codes' trailing Edit button was cut off on a maximized window);
//   2. the `wide` page column is `fit-content` between a 1280px floor and a
//      1760px cap, both capped by the viewport — and only the TABLE sizes it.
//
// Both are pure CSS, so this needs the real stylesheet: the utilities are
// generated from `app`/`components` (never from tests — `docs/styling.md`), so
// the harness expresses its own geometry with inline styles and fixed-width
// spacer spans rather than classes, which also keeps the pixel expectations
// independent of the font.
import "@/app/globals.css";
import { DataList, type ListColumn, ListTable } from "@/components/data-list";
import { Main } from "@/components/page-main";

// The configured viewport (`vitest.config.mts`) — restored after every test,
// because `page.viewport()` persists for the whole file.
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// 1px of slack absorbs sub-pixel rounding and scrollbar-gutter differences.
const TOLERANCE = 1;

interface Row {
  id: string;
}

const ROWS: Row[] = [{ id: "r1" }, { id: "r2" }];

/** A cell of an exact pixel width — no font metrics in the expectations. */
function Spacer({ width }: { width: number }) {
  return <span style={{ display: "inline-block", width, height: 8 }} />;
}

/** The card's hairline border, and the page column's gutters (`px-5`) — both
 *  inside the border-box widths the assertions below compare. */
const CARD_BORDERS = 2;
const COLUMN_GUTTERS = 40;

function spacerColumns(width: number): ListColumn<Row>[] {
  return [
    { header: "Name", render: () => <Spacer width={width} /> },
    {
      header: "Actions",
      kind: "actions",
      srOnlyHeader: true,
      render: () => (
        <button type="button" style={{ width: 60 }}>
          Edit
        </button>
      ),
    },
  ];
}

/** The card is the table's parent — the element `ListTable` owns as its scroller. */
function cardOf(container: HTMLElement): HTMLElement {
  const table = container.querySelector("table");
  if (!table?.parentElement) throw new Error("no table card rendered");
  return table.parentElement;
}

afterEach(async () => {
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe("ListTable card scrolls instead of clipping", () => {
  test("a table wider than its container scrolls, and the trailing action reaches full visibility", async () => {
    const { container } = await render(
      <div style={{ width: 400, overflow: "hidden" }}>
        <ListTable rows={ROWS} getRowKey={(row) => row.id} columns={spacerColumns(600)} />
      </div>,
    );

    const card = cardOf(container);
    expect(getComputedStyle(card).overflowX).toBe("auto");
    expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);

    const button = container.querySelector("button");
    if (!button) throw new Error("no action button rendered");

    // Before scrolling the action sits past the card's right edge — this is
    // exactly the clipped state the fix has to keep reachable.
    expect(button.getBoundingClientRect().right).toBeGreaterThan(
      card.getBoundingClientRect().right,
    );

    card.scrollLeft = card.scrollWidth;
    const cardRect = card.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    expect(buttonRect.left).toBeGreaterThanOrEqual(cardRect.left - TOLERANCE);
    expect(buttonRect.right).toBeLessThanOrEqual(cardRect.right + TOLERANCE);
  });
});

describe("the wide page column clamps between the table and the viewport", () => {
  // The real nesting: PAGE_CANVAS's `mx-[calc((100%-100vw)/2)]` is tied to
  // `Main`'s own max-width, so the shell is measured inside `Main` and the
  // width comes from `page.viewport()` — an over-wide wrapper would distort it.
  // The fixed, clipped height keeps the harness from giving the iframe a window
  // scrollbar, which would shrink `100vw` out from under the canvas.
  async function renderShell(cellWidth: number) {
    const { container } = await render(
      <div style={{ height: 400, overflow: "hidden" }}>
        <Main>
          <DataList
            wide
            rows={ROWS}
            getRowKey={(row) => row.id}
            columns={spacerColumns(cellWidth)}
            hint="A hint long enough to wrap rather than widen the page column."
            actions={<button type="button">New thing</button>}
            isFiltered={false}
            emptyState="Nothing yet."
            noMatchState="No match."
          />
        </Main>
      </div>,
    );

    const scroller = container.querySelector<HTMLElement>(".page-scroll");
    const column = scroller?.firstElementChild;
    if (!scroller || !(column instanceof HTMLElement)) throw new Error("no page column rendered");
    return { card: cardOf(container), column, container, scroller };
  }

  test("floor: a small table leaves the column at 1280px on a wide viewport", async () => {
    await page.viewport(1920, 900);
    const { card, column } = await renderShell(300);

    expect(column.getBoundingClientRect().width).toBeCloseTo(1280, 0);
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + TOLERANCE);
  });

  test("fit: a wider table sizes the column to itself, between the floor and the cap", async () => {
    await page.viewport(1920, 900);
    const { card, column, container } = await renderShell(1400);

    const width = column.getBoundingClientRect().width;
    expect(width).toBeGreaterThan(1280);
    expect(width).toBeLessThan(1760);
    // The TABLE drives it exactly — the column is its natural width plus the
    // card's border and the page gutters, with nothing left over to stretch.
    const table = container.querySelector("table");
    if (!table) throw new Error("no table rendered");
    expect(width).toBeCloseTo(
      table.getBoundingClientRect().width + CARD_BORDERS + COLUMN_GUTTERS,
      0,
    );
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + TOLERANCE);
  });

  test("cap: a table past 1760px stops the column at the cap and the card scrolls", async () => {
    await page.viewport(2200, 900);
    const { card, column } = await renderShell(2000);

    expect(column.getBoundingClientRect().width).toBeCloseTo(1760, 0);
    expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
  });

  test("viewport cap: below the floor the column is the available width and the card scrolls", async () => {
    await page.viewport(1000, 900);
    const { card, column, scroller } = await renderShell(1400);

    const width = column.getBoundingClientRect().width;
    expect(width).toBeLessThan(1280);
    expect(width).toBeCloseTo(scroller.clientWidth, 0);
    expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
  });

  test("only the table widens the column: the hint, toolbar and pager are excluded", async () => {
    await page.viewport(1920, 900);
    const { column, container } = await renderShell(300);

    // A long hint next to a small table must not move the column off its floor…
    expect(column.getBoundingClientRect().width).toBeCloseTo(1280, 0);
    // …because every non-table child carries the exclusion classes.
    for (const child of Array.from(column.children)) {
      if (child.querySelector("table")) continue;
      expect(child.className).toContain("w-0");
      expect(child.className).toContain("min-w-full");
    }
    expect(container.querySelectorAll("table")).toHaveLength(1);
  });
});

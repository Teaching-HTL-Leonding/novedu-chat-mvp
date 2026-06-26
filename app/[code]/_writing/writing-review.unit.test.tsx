// @vitest-environment node

import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `WritingSaversList` is the writing module's teacher review: a DataList of the
// students who saved text, each row linking to that student's text page, plus the
// chat-only count column. The DB read is mocked; the component is invoked directly
// and its HTML rendered. The filter bar is stubbed (it is a client component using
// next/navigation) so this stays a pure node render. No DB, runs in CI.

const listSavers = vi.hoisted(() => vi.fn());

vi.mock("@/lib/writing-store", () => ({ listSavers }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
// The filter bar is a client component (next/navigation hooks); a stub that renders
// its children keeps the search input in the markup without a router.
vi.mock("@/components/list-filter-bar", () => ({
  ListFilterBar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { WritingSaversList } from "./writing-review";

const CODE = "a1b2c3d4e5";

async function render(props: { search?: string } = {}) {
  return renderToStaticMarkup(await WritingSaversList({ code: CODE, search: props.search }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rows", () => {
  beforeEach(() => {
    listSavers.mockResolvedValue([
      {
        userId: "student-oid-1",
        displayName: null,
        textUpdatedAt: new Date("2026-06-12T10:00:00Z"),
        conversationCount: 2,
      },
    ]);
  });

  it("renders a saver row with the id, the conversation count, and a link to the student page", async () => {
    const html = await render();
    expect(html).toContain("student-oid-1");
    expect(html).toContain(`/codes/${CODE}/s/student-oid-1`);
    expect(html).toContain('data-testid="saver-link"');
    expect(html).toContain(">2<"); // conversation count
  });

  it("renders the filter input", async () => {
    const html = await render();
    expect(html).toContain('name="q"');
  });

  it("passes the search term to the store", async () => {
    await render({ search: "ada" });
    expect(listSavers).toHaveBeenCalledWith(CODE, { search: "ada" });
  });
});

describe("display name resolution", () => {
  it("shows the resolved display name, with the oid kept as the hover title", async () => {
    listSavers.mockResolvedValue([
      {
        userId: "student-oid-1",
        displayName: "Ada Lovelace",
        textUpdatedAt: new Date("2026-06-12T10:00:00Z"),
        conversationCount: 0,
      },
    ]);
    const html = await render();
    expect(html).toContain("Ada Lovelace");
    expect(html).toContain('title="student-oid-1"');
    // The link still targets the oid (names are not unique or stable URL keys).
    expect(html).toContain(`/codes/${CODE}/s/student-oid-1`);
  });

  it("falls back to the oid when no name has been recorded", async () => {
    listSavers.mockResolvedValue([
      {
        userId: "student-oid-1",
        displayName: null,
        textUpdatedAt: new Date("2026-06-12T10:00:00Z"),
        conversationCount: 0,
      },
    ]);
    const html = await render();
    expect(html).toContain(">student-oid-1<");
  });
});

describe("empty states", () => {
  it("shows the empty state when nobody has saved and no filter is applied", async () => {
    listSavers.mockResolvedValue([]);
    const html = await render();
    expect(html).toContain("a student appears here once they save");
  });

  it("shows the no-match state when a filter matches nobody", async () => {
    listSavers.mockResolvedValue([]);
    const html = await render({ search: "nobody" });
    expect(html).toContain("No students match your filter");
  });
});

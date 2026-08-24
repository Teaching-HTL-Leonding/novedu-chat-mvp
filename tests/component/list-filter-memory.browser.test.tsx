import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The list-filter memory (see `docs/filtered-lists.md`): a list page RECORDS the
// filter it is showing, and the links back to that list — the burger menu and the
// "← Back to …" links — start from it. The URL stays the source of filter truth;
// these tests pin the two halves and the fact that nothing else is touched.

vi.mock("next/navigation", () => ({ usePathname: () => "/files" }));
// next/link reads Next-server globals that don't exist in the browser test
// runner — a plain anchor preserves exactly what these tests assert (the href).
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { BackLink } from "@/components/back-link";
import { listFilterKey, rememberedListHref } from "@/components/list-filter-memory";
import { NavMenu } from "@/components/nav-menu";
import { RememberListFilter } from "@/components/remember-list-filter";

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

function href(link: { element: () => Element }): string | null {
  return link.element().getAttribute("href");
}

test("a list records the filter it is showing, and Clear forgets it", async () => {
  const screen = await render(<RememberListFilter pathname="/codes" search="q=math&owner=all" />);
  await vi.waitFor(() =>
    expect(localStorage.getItem(listFilterKey("/codes"))).toBe("q=math&owner=all"),
  );

  // "Clear" pushes the bare pathname, so the next render carries no search at all.
  await screen.rerender(<RememberListFilter pathname="/codes" search="" />);
  await vi.waitFor(() => expect(localStorage.getItem(listFilterKey("/codes"))).toBeNull());
});

test("the burger menu reopens a list with its remembered filter", async () => {
  localStorage.setItem(listFilterKey("/codes"), "q=math&sort=-note");
  const screen = await render(<NavMenu isTeacher />);

  await screen.getByRole("button", { name: "Open navigation menu" }).click();

  expect(href(screen.getByRole("link", { name: "Codes" }))).toBe("/codes?q=math&sort=-note");
  // Nothing remembered for these — the memory only ever appends what a list wrote.
  expect(href(screen.getByRole("link", { name: "Images" }))).toBe("/images");
  expect(href(screen.getByRole("link", { name: "Chat" }))).toBe("/");
});

test("the teacher guide opens in its own tab", async () => {
  const screen = await render(<NavMenu isTeacher />);
  await screen.getByRole("button", { name: "Open navigation menu" }).click();

  const guide = screen.getByRole("link", { name: "Teacher Guide (opens in a new tab)" }).element();
  expect(guide.getAttribute("href")).toBe("/docs");
  expect(guide.getAttribute("target")).toBe("_blank");
  expect(guide.getAttribute("rel")).toBe("noopener");
});

test("a Back link returns to the filtered list, and leaves other hrefs alone", async () => {
  localStorage.setItem(listFilterKey("/files"), "q=intro");
  const screen = await render(<BackLink href="/files">Back to files</BackLink>);
  await vi.waitFor(() =>
    expect(href(screen.getByRole("link", { name: "← Back to files" }))).toBe("/files?q=intro"),
  );

  const stats = await render(<BackLink href="/codes/abc123">Back to savers</BackLink>);
  expect(href(stats.getByRole("link", { name: "← Back to savers" }))).toBe("/codes/abc123");
});

test("unusable storage never breaks a link", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage disabled");
  });
  expect(rememberedListHref("/codes")).toBe("/codes");

  const screen = await render(<BackLink href="/codes">Back to codes</BackLink>);
  await expect.element(screen.getByRole("link", { name: "← Back to codes" })).toBeVisible();
  expect(href(screen.getByRole("link", { name: "← Back to codes" }))).toBe("/codes");
});

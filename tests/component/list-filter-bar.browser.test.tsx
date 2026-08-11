import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// ListFilterBar's one job: on "Apply" turn the filter controls into a URL query
// so the SERVER re-queries the database. These tests pin that contract — what
// gets pushed for text + a default-on checkbox — against a mocked router.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/codes",
}));

import { ListFilterBar } from "@/components/list-filter-bar";

function pushedUrl(): string {
  const arg = push.mock.calls[0]?.[0];
  if (typeof arg !== "string") throw new Error("router.push was not called with a string");
  return arg;
}

function controls(opts: { q?: string; mine?: boolean } = {}) {
  return (
    <>
      <input type="search" name="q" defaultValue={opts.q ?? ""} aria-label="Filter" />
      <label>
        <input type="checkbox" name="mine" defaultChecked={opts.mine ?? true} /> Only mine
      </label>
    </>
  );
}

function inputValue(locator: { element: () => Element }): string {
  return (locator.element() as HTMLInputElement).value;
}

test("Apply pushes the typed term as ?q= (mine omitted when left checked)", async () => {
  push.mockClear();
  const screen = await render(<ListFilterBar>{controls()}</ListFilterBar>);

  await screen.getByLabelText("Filter").fill("linked lists");
  await screen.getByRole("button", { name: "Apply" }).click();

  expect(push).toHaveBeenCalledTimes(1);
  const url = new URL(`http://x${pushedUrl()}`);
  expect(url.pathname).toBe("/codes");
  expect(url.searchParams.get("q")).toBe("linked lists");
  // A default-on checkbox left checked stays "1".
  expect(url.searchParams.get("mine")).toBe("1");
});

test("unticking 'only mine' sets mine=0; empty search is omitted", async () => {
  push.mockClear();
  const screen = await render(<ListFilterBar>{controls()}</ListFilterBar>);

  await screen.getByRole("checkbox").click(); // untick
  await screen.getByRole("button", { name: "Apply" }).click();

  const url = new URL(`http://x${pushedUrl()}`);
  expect(url.searchParams.get("mine")).toBe("0");
  expect(url.searchParams.has("q")).toBe(false);
});

// Paging contract: the serializer builds the query from the form's own controls,
// so `?page=` is dropped (Apply = back to page 1) while a non-default `?size=`
// survives as a hidden input. "Clear" resets both, like every other filter.
test("Apply drops ?page= and carries a non-default ?size= through", async () => {
  push.mockClear();
  const screen = await render(<ListFilterBar pageSize={50}>{controls()}</ListFilterBar>);

  await screen.getByLabelText("Filter").fill("lists");
  await screen.getByRole("button", { name: "Apply" }).click();

  const url = new URL(`http://x${pushedUrl()}`);
  expect(url.searchParams.has("page")).toBe(false);
  expect(url.searchParams.get("size")).toBe("50");
});

test("the default page size needs no ?size= at all", async () => {
  push.mockClear();
  const screen = await render(<ListFilterBar pageSize={20}>{controls()}</ListFilterBar>);

  await screen.getByRole("button", { name: "Apply" }).click();

  expect(new URL(`http://x${pushedUrl()}`).searchParams.has("size")).toBe(false);
});

test("Clear navigates to the bare path when a filter is active", async () => {
  push.mockClear();
  const screen = await render(
    <ListFilterBar hasActiveFilter>{controls({ q: "x" })}</ListFilterBar>,
  );

  await screen.getByRole("button", { name: "Clear" }).click();
  expect(push).toHaveBeenCalledWith("/codes");
});

test("no Clear button when no filter is active", async () => {
  const screen = await render(<ListFilterBar>{controls()}</ListFilterBar>);
  expect(screen.getByRole("button", { name: "Clear" }).query()).toBeNull();
});

// Regression: the controls are uncontrolled (server-rendered defaultValue), so a
// typed value used to linger in the box after "Clear" navigated to the bare URL.
// A changed `resetKey` must remount the form so the inputs re-seed from the new
// (empty) defaults — mirroring the server re-render after Clear.
test("a changed resetKey re-seeds the uncontrolled inputs from the new defaults", async () => {
  const screen = await render(
    <ListFilterBar resetKey="foo|1">{controls({ q: "foo", mine: false })}</ListFilterBar>,
  );
  expect(inputValue(screen.getByLabelText("Filter"))).toBe("foo");
  expect((screen.getByRole("checkbox").element() as HTMLInputElement).checked).toBe(false);

  // Simulate the post-"Clear" server render: empty defaults + a new resetKey.
  await screen.rerender(
    <ListFilterBar resetKey="|1">{controls({ q: "", mine: true })}</ListFilterBar>,
  );
  expect(inputValue(screen.getByLabelText("Filter"))).toBe("");
  expect((screen.getByRole("checkbox").element() as HTMLInputElement).checked).toBe(true);
});

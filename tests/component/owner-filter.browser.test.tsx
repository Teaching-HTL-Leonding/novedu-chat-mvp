import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The owner dropdown's contract (docs/filtered-lists.md): the signed-in teacher is
// the first option and carries the EMPTY value, so the default view — and "Clear",
// which pushes the bare path — need no `?owner=` at all. Everything else is about
// the option set never disagreeing with the URL.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/codes",
}));

import { ListFilterBar, OwnerFilter } from "@/components/list-filter-bar";
import { ALL_OWNERS } from "@/lib/db/owner-filter";

const ME = "oid-me";
const BIRGIT = { userId: "oid-birgit", label: "Birgit Schröder" };
const CLI_ONLY = { userId: "oid-cli", label: "oid-cli" };

function filter(props: Partial<Parameters<typeof OwnerFilter>[0]> = {}) {
  return (
    <OwnerFilter
      noun="codes"
      options={props.options ?? [{ userId: ME, label: "Alex Muster" }, BIRGIT, CLI_ONLY]}
      value={props.value ?? ""}
      currentUserId={ME}
      currentUserName={"currentUserName" in props ? props.currentUserName : "Alex Muster"}
    />
  );
}

function optionTexts(select: Element): string[] {
  return Array.from((select as HTMLSelectElement).options).map((o) => o.textContent ?? "");
}

test("lists me first, then all owners, then the other owners once each", async () => {
  const screen = await render(filter());
  const select = screen.getByLabelText("Filter by owner").element() as HTMLSelectElement;

  // "Alex Muster" appears ONCE: the current user is deduped out of the options.
  expect(optionTexts(select)).toEqual([
    "My codes (Alex Muster)",
    "All owners",
    "Birgit Schröder",
    // No `novedu_users` row: the oid is the label, which is the accepted fallback.
    "oid-cli",
  ]);
  expect(select.value).toBe("");
});

test("falls back to a nameless label when the session carries no display name", async () => {
  const screen = await render(filter({ currentUserName: null }));
  const select = screen.getByLabelText("Filter by owner").element() as HTMLSelectElement;
  expect(optionTexts(select)[0]).toBe("My codes");
});

test("a URL naming my own oid selects the first option, not a nameless stranger", async () => {
  // `?owner=<my oid>` is the same filter as the empty default, so it must not fall
  // into the append branch and show me twice (once named, once as a bare oid).
  const screen = await render(filter({ value: ME }));
  const select = screen.getByLabelText("Filter by owner").element() as HTMLSelectElement;

  expect(select.value).toBe("");
  expect(optionTexts(select)).toEqual([
    "My codes (Alex Muster)",
    "All owners",
    "Birgit Schröder",
    "oid-cli",
  ]);
});

test("a selected oid that owns nothing any more is appended, not silently dropped", async () => {
  // A stale bookmark: the URL filters by an owner the list no longer knows. The
  // control must still show it, or it would claim a filter that is not applied.
  const screen = await render(filter({ options: [BIRGIT], value: "oid-gone" }));
  const select = screen.getByLabelText("Filter by owner").element() as HTMLSelectElement;

  expect(optionTexts(select)).toEqual([
    "My codes (Alex Muster)",
    "All owners",
    "Birgit Schröder",
    "oid-gone",
  ]);
  expect(select.value).toBe("oid-gone");
});

test("Apply omits ?owner= for me and emits it for anyone else", async () => {
  push.mockClear();
  const screen = await render(<ListFilterBar>{filter()}</ListFilterBar>);

  await screen.getByRole("button", { name: "Apply" }).click();
  expect(new URL(`http://x${push.mock.calls[0]?.[0]}`).searchParams.has("owner")).toBe(false);

  push.mockClear();
  await screen.getByLabelText("Filter by owner").selectOptions(BIRGIT.userId);
  await screen.getByRole("button", { name: "Apply" }).click();
  expect(new URL(`http://x${push.mock.calls[0]?.[0]}`).searchParams.get("owner")).toBe(
    BIRGIT.userId,
  );

  push.mockClear();
  await screen.getByLabelText("Filter by owner").selectOptions(ALL_OWNERS);
  await screen.getByRole("button", { name: "Apply" }).click();
  expect(new URL(`http://x${push.mock.calls[0]?.[0]}`).searchParams.get("owner")).toBe(ALL_OWNERS);
});

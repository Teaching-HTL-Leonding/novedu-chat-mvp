import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The list's in-memory filtering and the "Only my files" toggle decide what a
// teacher sees (including whether other teachers' files appear), so they get fast
// component coverage. The delete action + router are mocked away — this is pure
// client-side filtering.
vi.mock("@/lib/files-actions", () => ({ deleteFileAction: vi.fn(async () => ({ ok: true })) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: unknown; children: unknown }) => (
    <a href={String(href)} {...rest}>
      {children as never}
    </a>
  ),
}));

import { type FileRow, FilesBrowser } from "@/app/files/files-browser";

const ROWS: FileRow[] = [
  {
    id: "1",
    name: "mine-tutor",
    kind: "tutor",
    title: "My Tutor",
    description: "about linked lists",
    updatedSeconds: 1_700_000_000,
    createdBy: "me",
  },
  {
    id: "2",
    name: "theirs-fragment",
    kind: "fragment",
    title: "Their Fragment",
    description: "shared greetings",
    updatedSeconds: 1_700_000_000,
    createdBy: "other-teacher",
  },
];

const renderList = () =>
  render(<FilesBrowser origin="https://app.example" rows={ROWS} currentUserId="me" />);

test("defaults to 'Only my files' (checked) and hides other teachers' files", async () => {
  const screen = await renderList();

  await expect.element(screen.getByRole("checkbox")).toBeChecked();
  await expect.element(screen.getByText("mine-tutor")).toBeVisible();
  expect(screen.getByText("theirs-fragment").query()).toBeNull();
});

test("unticking 'Only my files' reveals every teacher's files", async () => {
  const screen = await renderList();

  await screen.getByRole("checkbox").click();

  await expect.element(screen.getByText("mine-tutor")).toBeVisible();
  await expect.element(screen.getByText("theirs-fragment")).toBeVisible();
});

test("the contains-filter matches name, title and description", async () => {
  const screen = await renderList();
  // Browse everyone's files so the filter is what narrows the list.
  await screen.getByRole("checkbox").click();

  await screen.getByLabelText("Filter files").fill("greetings"); // only in the other's description
  await expect.element(screen.getByText("theirs-fragment")).toBeVisible();
  expect(screen.getByText("mine-tutor").query()).toBeNull();

  await screen.getByLabelText("Filter files").fill("no-such-thing");
  await expect.element(screen.getByText("No files match your filter.")).toBeVisible();
});

test("offers a Copy URL button and a Create-tutor-code link only for tutor files", async () => {
  const screen = await renderList();
  await screen.getByRole("checkbox").click(); // show all

  await expect.element(screen.getByRole("button", { name: "Copy URL" }).first()).toBeVisible();
  // The tutor row links to share-tutor with its public URL pre-filled.
  const share = screen.getByRole("link", { name: "Create tutor code" });
  await expect.element(share).toBeVisible();
  expect(share.element().getAttribute("href")).toContain(
    encodeURIComponent("https://app.example/api/files/mine-tutor"),
  );
});

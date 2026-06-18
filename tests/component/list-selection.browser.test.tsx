import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The shared multi-delete layer's PURE interaction contract (no DB): row
// checkboxes, the select-all / unselect-all header icons, and the "Delete
// Selected" button — disabled until a row is selected, confirming with the count,
// calling the list's action ONCE with exactly the selected ids, then clearing +
// refreshing on success or surfacing the error and keeping the selection on
// failure. The wired DB delete is the @live-db e2e counterpart.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import {
  DeleteSelectedButton,
  RowSelectCheckbox,
  SelectAllControls,
  SelectionProvider,
} from "@/components/list-selection";

type Result = { ok: boolean; message?: string; deleted?: number };

function Harness({
  action,
  ids = ["a", "b", "c"],
}: {
  action: (ids: string[]) => Promise<Result>;
  ids?: string[];
}) {
  return (
    <SelectionProvider allIds={ids}>
      <SelectAllControls />
      {ids.map((id) => (
        <RowSelectCheckbox key={id} id={id} label={id} />
      ))}
      <DeleteSelectedButton action={action} itemNoun="file" />
    </SelectionProvider>
  );
}

const confirmSpy = vi.spyOn(window, "confirm");

beforeEach(() => {
  refresh.mockClear();
  confirmSpy.mockReset().mockReturnValue(true);
});

describe("DeleteSelectedButton + selection", () => {
  test("is disabled with nothing selected and enables once a row is ticked", async () => {
    const screen = await render(<Harness action={vi.fn()} />);
    const del = screen.getByRole("button", { name: /delete/i });
    await expect.element(del).toBeDisabled();

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await expect.element(del).toBeEnabled();
  });

  test("select-all ticks every row; unselect-all clears them", async () => {
    const screen = await render(<Harness action={vi.fn()} />);

    await screen.getByRole("button", { name: "Select all rows", exact: true }).click();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeChecked();
    await expect.element(screen.getByRole("checkbox", { name: "Select b" })).toBeChecked();
    await expect.element(screen.getByRole("checkbox", { name: "Select c" })).toBeChecked();
    await expect.element(screen.getByRole("button", { name: /delete/i })).toBeEnabled();

    await screen.getByRole("button", { name: "Unselect all rows", exact: true }).click();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).not.toBeChecked();
    await expect.element(screen.getByRole("button", { name: /delete/i })).toBeDisabled();
  });

  test("confirms with the count, calls the action ONCE with the selected ids, then clears + refreshes", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, deleted: 2 });
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("checkbox", { name: "Select c" }).click();
    await screen.getByRole("button", { name: /delete/i }).click();

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("2 files"));
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(["a", "c"]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Selection cleared on success.
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).not.toBeChecked();
  });

  test("a cancelled confirm deletes nothing and keeps the selection", async () => {
    confirmSpy.mockReturnValue(false);
    const action = vi.fn().mockResolvedValue({ ok: true, deleted: 1 });
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /delete/i }).click();

    expect(action).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeChecked();
  });

  test("a failed delete shows the message inline, keeps the selection, and does not refresh", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, message: "Could not be deleted." });
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /delete/i }).click();

    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByText("Could not be deleted.")).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeChecked();
  });

  test("shows the spinner label and disables the checkboxes while the delete is in flight", async () => {
    let resolveAction!: (r: Result) => void;
    const action = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /delete/i }).click();

    await expect.element(screen.getByText(/Deleting/)).toBeVisible();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeDisabled();

    resolveAction({ ok: true, deleted: 1 });
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).not.toBeChecked();
  });
});

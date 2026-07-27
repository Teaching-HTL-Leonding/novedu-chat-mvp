import { beforeEach, describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The generic bulk-action button on the shared selection layer (the non-delete
// sibling of DeleteSelectedButton, used by the reports inbox's "Mark resolved" /
// "Reopen"). Same disabled-until-selection / pending-Spinner / FieldError-on-
// failure contract, but: no confirm by default (runs immediately), an optional
// confirmMessage variant that asks first, and it clears + refreshes on success via
// the provider's shared runDelete machinery. The DeleteSelected-specific behavior
// stays covered by list-selection.browser.test.tsx (left untouched).

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import {
  BulkActionButton,
  RowSelectCheckbox,
  SelectionProvider,
} from "@/components/list-selection";

type Result = { ok: boolean; message?: string };

function Harness({
  action,
  confirmMessage,
  ids = ["a", "b", "c"],
}: {
  action: (ids: string[]) => Promise<Result>;
  confirmMessage?: (count: number) => string;
  ids?: string[];
}) {
  return (
    <SelectionProvider allIds={ids}>
      {ids.map((id) => (
        <RowSelectCheckbox key={id} id={id} label={id} />
      ))}
      <BulkActionButton
        action={action}
        label="Mark resolved"
        pendingLabel="Resolving"
        confirmMessage={confirmMessage}
      />
    </SelectionProvider>
  );
}

const confirmSpy = vi.spyOn(window, "confirm");

beforeEach(() => {
  refresh.mockClear();
  confirmSpy.mockReset().mockReturnValue(true);
});

describe("BulkActionButton", () => {
  test("is disabled with nothing selected and enables once a row is ticked", async () => {
    const screen = await render(<Harness action={vi.fn()} />);
    const button = screen.getByRole("button", { name: /mark resolved/i });
    await expect.element(button).toBeDisabled();

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await expect.element(button).toBeEnabled();
  });

  test("with no confirmMessage runs immediately, calls the action once, then clears + refreshes", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("checkbox", { name: "Select c" }).click();
    await screen.getByRole("button", { name: /mark resolved/i }).click();

    expect(confirmSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(["a", "c"]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // Selection cleared on success.
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).not.toBeChecked();
  });

  test("with a confirmMessage asks first; a cancelled confirm does nothing", async () => {
    confirmSpy.mockReturnValue(false);
    const action = vi.fn().mockResolvedValue({ ok: true });
    const confirmMessage = vi.fn((n: number) => `Really resolve ${n}?`);
    const screen = await render(<Harness action={action} confirmMessage={confirmMessage} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /mark resolved/i }).click();

    expect(confirmSpy).toHaveBeenCalledWith("Really resolve 1?");
    expect(action).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeChecked();
  });

  test("a failed action shows the message inline, keeps the selection, and does not refresh", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, message: "Could not update." });
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /mark resolved/i }).click();

    await expect.element(screen.getByRole("alert")).toBeVisible();
    await expect.element(screen.getByText("Could not update.")).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeChecked();
  });

  test("shows the pending label and disables the checkboxes while the action is in flight", async () => {
    let resolveAction!: (r: Result) => void;
    const action = vi.fn(
      () =>
        new Promise<Result>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const screen = await render(<Harness action={action} />);

    await screen.getByRole("checkbox", { name: "Select a" }).click();
    await screen.getByRole("button", { name: /mark resolved/i }).click();

    await expect.element(screen.getByText(/Resolving/)).toBeVisible();
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).toBeDisabled();

    resolveAction({ ok: true });
    await expect.element(screen.getByRole("checkbox", { name: "Select a" })).not.toBeChecked();
  });
});

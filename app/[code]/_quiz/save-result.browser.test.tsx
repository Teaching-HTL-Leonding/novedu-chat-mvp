import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The Finish page's save step (docs/home.md → Saving a quiz result): the three
// consent choices behind the "only you can see it" notice, the automatic save
// when the setting is on (once, falling back to the choices when the server
// finds the setting off), and failures that keep the choices with a message.
// The server action is mocked; its validation lives in lib/quiz-actions.unit.test.ts.

const saveQuizResult = vi.hoisted(() => vi.fn());
vi.mock("@/lib/quiz-actions", () => ({ saveQuizResult }));
// next/link reads Next-server globals that don't exist in the browser test
// runner — a plain anchor keeps the href the assertions read.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { SaveResult } from "./save-result";

const PROPS = {
  code: "a1b2c3d4e5",
  attemptId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  counts: { correct: 2, partial: 1, incorrect: 0, unanswered: 1 },
  total: 4,
};

beforeEach(() => {
  saveQuizResult.mockResolvedValue({ ok: true, saved: true });
});

test("asks first, behind the notice that only the student can see the result", async () => {
  const screen = await render(<SaveResult {...PROPS} autoSave={false} />);
  await expect
    .element(screen.getByText(/Only you can see it — your teacher cannot\./))
    .toBeVisible();
  for (const name of ["No", "This time", "Always"]) {
    await expect.element(screen.getByRole("button", { name })).toBeVisible();
  }
  expect(saveQuizResult).not.toHaveBeenCalled();
});

test("No stores nothing", async () => {
  const screen = await render(<SaveResult {...PROPS} autoSave={false} />);
  await screen.getByRole("button", { name: "No" }).click();
  await expect.element(screen.getByText("Not saved.")).toBeVisible();
  expect(saveQuizResult).not.toHaveBeenCalled();
});

test.each([
  ["This time", "this-time", "Saved to your personal statistics. "],
  ["Always", "always", "from now on, results are saved automatically"],
] as const)("%s saves the attempt with mode %s", async (choice, mode, confirmation) => {
  const screen = await render(<SaveResult {...PROPS} autoSave={false} />);
  await screen.getByRole("button", { name: choice }).click();
  await expect.element(screen.getByText(new RegExp(confirmation))).toBeVisible();
  expect(saveQuizResult).toHaveBeenCalledWith({ ...PROPS, mode });
  await expect
    .element(screen.getByRole("link", { name: "Settings" }))
    .toHaveAttribute("href", "/settings");
});

test("with the setting on it saves automatically, exactly once", async () => {
  const screen = await render(<SaveResult {...PROPS} autoSave />);
  await expect.element(screen.getByText(/Saved to your personal statistics\./)).toBeVisible();
  await screen.rerender(<SaveResult {...PROPS} autoSave />);
  expect(saveQuizResult).toHaveBeenCalledTimes(1);
  expect(saveQuizResult).toHaveBeenCalledWith({ ...PROPS, mode: "automatic" });
  await expect.element(screen.getByRole("button", { name: "This time" })).not.toBeInTheDocument();
});

test("an automatic save the server refuses (setting turned off) falls back to asking", async () => {
  saveQuizResult.mockResolvedValue({ ok: true, saved: false });
  const screen = await render(<SaveResult {...PROPS} autoSave />);
  await expect.element(screen.getByRole("button", { name: "This time" })).toBeVisible();
});

test("a failure shows its message and keeps the choices; a dropped call is no exception", async () => {
  saveQuizResult.mockResolvedValueOnce({ ok: false, message: "This quiz no longer exists." });
  const screen = await render(<SaveResult {...PROPS} autoSave={false} />);
  await screen.getByRole("button", { name: "This time" }).click();
  await expect.element(screen.getByText("This quiz no longer exists.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Always" })).toBeVisible();

  saveQuizResult.mockRejectedValueOnce(new Error("network down"));
  await screen.getByRole("button", { name: "This time" }).click();
  await expect.element(screen.getByText(/could not be saved right now/)).toBeVisible();
});

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Mock the server-action modules: they import auth/next-headers, which don't
// exist in the browser test runner. The mocks record invocations so the tests
// can assert which action a control triggers. vi.hoisted because vi.mock
// factories are hoisted above ordinary top-level declarations.
const { enterStudentMode, exitStudentMode } = vi.hoisted(() => ({
  enterStudentMode: vi.fn(async () => {}),
  exitStudentMode: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth-actions", () => ({ signOutAction: vi.fn(async () => {}) }));
vi.mock("@/lib/student-mode-actions", () => ({
  enterStudentModeAction: enterStudentMode,
  exitStudentModeAction: exitStudentMode,
}));

import { UserMenu } from "@/components/user-menu";

const TEACHER = { name: "Tina Teacher", isTeacher: true };

test("a teacher sees the badge and can enter student mode from the menu", async () => {
  enterStudentMode.mockClear();
  const screen = await render(<UserMenu user={TEACHER} />);

  await expect.element(screen.getByRole("img", { name: "Teacher" })).toBeVisible();
  expect(screen.getByText("Student mode").query()).toBeNull();

  await screen.getByRole("button", { name: /Tina Teacher/ }).click();
  await screen.getByRole("menuitem", { name: "View as student" }).click();

  await vi.waitFor(() => expect(enterStudentMode).toHaveBeenCalledTimes(1));
});

test("in student mode the badge is gone and the pill offers the exit", async () => {
  exitStudentMode.mockClear();
  const screen = await render(<UserMenu user={{ ...TEACHER, isTeacher: false }} studentMode />);

  // Looks like a student: no teacher badge, no "View as student" menu item.
  expect(screen.getByRole("img", { name: "Teacher" }).query()).toBeNull();
  await screen.getByRole("button", { name: /Tina Teacher/ }).click();
  expect(screen.getByRole("menuitem", { name: "View as student" }).query()).toBeNull();

  // ...except for the always-visible pill with the exit control.
  await expect.element(screen.getByText("Student mode")).toBeVisible();
  await screen.getByRole("button", { name: "Exit" }).click();
  await vi.waitFor(() => expect(exitStudentMode).toHaveBeenCalledTimes(1));
});

test("a real student gets neither badge, pill, nor toggle", async () => {
  const screen = await render(<UserMenu user={{ name: "Sam Student", isTeacher: false }} />);

  expect(screen.getByRole("img", { name: "Teacher" }).query()).toBeNull();
  expect(screen.getByText("Student mode").query()).toBeNull();

  await screen.getByRole("button", { name: /Sam Student/ }).click();
  expect(screen.getByRole("menuitem", { name: "View as student" }).query()).toBeNull();
  await expect.element(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

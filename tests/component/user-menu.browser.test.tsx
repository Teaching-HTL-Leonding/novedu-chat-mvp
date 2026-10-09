import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Mock the server-action modules: they import auth/next-headers, which don't
// exist in the browser test runner. The mocks record invocations so the tests
// can assert which action a control triggers. vi.hoisted because vi.mock
// factories are hoisted above ordinary top-level declarations.
const { enterStudentMode, exitStudentMode, signOut } = vi.hoisted(() => ({
  enterStudentMode: vi.fn(async () => {}),
  exitStudentMode: vi.fn(async () => {}),
  signOut: vi.fn(async () => {}),
}));

vi.mock("next/link", () => import("@/tests/mocks/next-link"));

vi.mock("@/lib/auth-actions", () => ({ signOutAction: signOut }));
vi.mock("@/lib/student-mode-actions", () => ({
  enterStudentModeAction: enterStudentMode,
  exitStudentModeAction: exitStudentMode,
}));

import { UserMenu } from "@/components/user-menu";

const TEACHER = { name: "Tina Teacher", isTeacher: true };

test("a teacher sees the badge and can enter student mode from the menu", async () => {
  const screen = await render(<UserMenu user={TEACHER} />);

  await expect.element(screen.getByRole("img", { name: "Teacher" })).toBeVisible();
  expect(screen.getByText("Student mode").query()).toBeNull();

  await screen.getByRole("button", { name: /Tina Teacher/ }).click();
  await screen.getByRole("menuitem", { name: "View as student" }).click();

  await vi.waitFor(() => expect(enterStudentMode).toHaveBeenCalledTimes(1));
});

test("in student mode the badge is gone and the pill offers the exit", async () => {
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

test("with no session the bar offers the way back to sign in", async () => {
  // The proxy passes a correctly signed cookie whose session row is gone; the
  // page then renders signed-out, and this link is the only way back.
  const screen = await render(<UserMenu user={null} />);

  const link = screen.getByRole("link", { name: "Sign in" });
  await expect.element(link).toBeVisible();
  await expect.element(link).toHaveAttribute("href", "/sign-in");
});

test("a real student gets neither badge, pill, nor toggle", async () => {
  const screen = await render(<UserMenu user={{ name: "Sam Student", isTeacher: false }} />);

  expect(screen.getByRole("img", { name: "Teacher" }).query()).toBeNull();
  expect(screen.getByText("Student mode").query()).toBeNull();

  await screen.getByRole("button", { name: /Sam Student/ }).click();
  expect(screen.getByRole("menuitem", { name: "View as student" }).query()).toBeNull();
  await expect.element(screen.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
});

test("every signed-in user reaches Settings from the menu", async () => {
  for (const user of [TEACHER, { name: "Sam Student", isTeacher: false }]) {
    const screen = await render(<UserMenu user={user} />);
    await screen.getByRole("button", { name: new RegExp(user.name) }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Settings" }))
      .toHaveAttribute("href", "/settings");
    await screen.unmount();
  }
});

test("signing out forgets the tab's tutor threads BEFORE the sign-out action runs", async () => {
  window.sessionStorage.clear();
  window.sessionStorage.setItem(
    "novedu.tutorThread.a1b2c3d4e5",
    JSON.stringify({ threadId: "t-1", threadToken: "abc" }),
  );
  window.sessionStorage.setItem("unrelated", "keep");
  // What the tab still held at the moment the action was invoked.
  let storedWhenSigningOut: string | null = "not called";
  signOut.mockImplementation(async () => {
    storedWhenSigningOut = window.sessionStorage.getItem("novedu.tutorThread.a1b2c3d4e5");
  });
  const screen = await render(<UserMenu user={{ name: "Sam Student", isTeacher: false }} />);

  await screen.getByRole("button", { name: /Sam Student/ }).click();
  await screen.getByRole("menuitem", { name: "Sign out" }).click();

  await vi.waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  expect(storedWhenSigningOut).toBeNull();
  expect(window.sessionStorage.getItem("unrelated")).toBe("keep");
});

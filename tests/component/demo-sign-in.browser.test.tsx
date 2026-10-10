import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// A demo build's sign-in buttons (app/sign-in/demo-sign-in.tsx, docs/auth.md "Demo
// mode"). better-auth's browser client is the seam: what each button sends, and
// that both failure shapes re-enable the buttons with one inline line.
const { signInEmail } = vi.hoisted(() => ({ signInEmail: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { signIn: { email: signInEmail } } }));

import { DemoSignIn } from "@/app/sign-in/demo-sign-in";
import { DEMO_PASSWORD } from "@/lib/demo-personas";

test("one button per persona, each signing in with the public demo password", async () => {
  signInEmail.mockReturnValue(new Promise(() => {}));
  const screen = await render(<DemoSignIn callbackURL="/codes" />);

  const buttons = screen.getByRole("button");
  expect(buttons.elements()).toHaveLength(4);
  await expect.element(screen.getByRole("button", { name: "Anna Berger · Teacher" })).toBeEnabled();
  await expect.element(screen.getByRole("button", { name: "Noah Wagner · Student" })).toBeEnabled();

  await screen.getByRole("button", { name: "Mia Gruber · Student" }).click();

  expect(signInEmail).toHaveBeenCalledWith({
    email: "mia.gruber@demo.novedu.invalid",
    password: DEMO_PASSWORD,
    callbackURL: "/codes",
  });
  // All four wait while one sign-in is under way.
  await expect.element(screen.getByRole("button", { name: /Signing in…/ })).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: /Lukas Huber/ })).toBeDisabled();
});

test.each([
  ["resolves with an error", () => Promise.resolve({ error: { status: 401 } })],
  ["rejects", () => Promise.reject(new Error("network"))],
])("a sign-in that %s re-enables the buttons and says so", async (_, outcome) => {
  signInEmail.mockImplementation(outcome);
  const screen = await render(<DemoSignIn callbackURL="/" />);

  await screen.getByRole("button", { name: /Anna Berger/ }).click();

  await expect.element(screen.getByText("Sign-in failed. Please try again.")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Anna Berger · Teacher" })).toBeEnabled();
});

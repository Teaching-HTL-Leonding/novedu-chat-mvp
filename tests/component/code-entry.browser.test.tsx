import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// Mock the router: the entry form navigates client-side to /<code>.
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
// next/link reads Next-server globals that don't exist in the browser test
// runner — a plain anchor preserves exactly what the tests assert (href/label).
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { CodeEntryForm, extractCode } from "@/app/code-entry";

test("extractCode accepts bare codes, full URLs, and rejects garbage", () => {
  expect(extractCode("a1b2c3d4e5")).toBe("a1b2c3d4e5");
  expect(extractCode("  A1B2C3D4E5  ")).toBe("a1b2c3d4e5"); // trims + lowercases
  expect(extractCode("https://chat.example.org/a1b2c3d4e5")).toBe("a1b2c3d4e5");
  expect(extractCode("http://localhost:3000/a1b2c3d4e5/")).toBe("a1b2c3d4e5");
  // Memorable codes (hyphens, shorter) are accepted too.
  expect(extractCode("bio-101")).toBe("bio-101");
  expect(extractCode("")).toBeUndefined();
  expect(extractCode("https://chat.example.org/")).toBeUndefined();
  expect(extractCode("not a code!")).toBeUndefined();
  expect(extractCode("x".repeat(33))).toBeUndefined(); // over 32 chars
});

test("submitting a valid code navigates to /<code>", async () => {
  push.mockClear();
  const screen = await render(<CodeEntryForm recent={[]} />);

  await screen.getByLabelText("Code").fill("A1B2C3D4E5");
  await screen.getByRole("button", { name: "Open" }).click();

  expect(push).toHaveBeenCalledWith("/a1b2c3d4e5");
});

test("a pasted URL is reduced to its code", async () => {
  push.mockClear();
  const screen = await render(<CodeEntryForm recent={[]} />);

  await screen.getByLabelText("Code").fill("https://chat.example.org/a1b2c3d4e5");
  await screen.getByRole("button", { name: "Open" }).click();

  expect(push).toHaveBeenCalledWith("/a1b2c3d4e5");
});

test("malformed input shows a format hint instead of navigating", async () => {
  push.mockClear();
  const screen = await render(<CodeEntryForm recent={[]} />);

  await screen.getByLabelText("Code").fill("nope!");
  await screen.getByRole("button", { name: "Open" }).click();

  expect(push).not.toHaveBeenCalled();
  await expect.element(screen.getByText(/letters\/digits\/hyphens/)).toBeVisible();

  // The hint clears as soon as the input changes.
  await screen.getByLabelText("Code").fill("a");
  expect(screen.getByText(/letters\/digits\/hyphens/).query()).toBeNull();
});

test("recently used codes render as links labeled with the note (fallback: code)", async () => {
  const screen = await render(
    <CodeEntryForm
      recent={[
        { code: "a1b2c3d4e5", note: "Linked lists 3AHIF" },
        { code: "f6g7h8i9j0", note: "" },
      ]}
    />,
  );

  const noted = screen.getByRole("link", { name: "Linked lists 3AHIF" });
  await expect.element(noted).toBeVisible();
  expect(noted.element().getAttribute("href")).toBe("/a1b2c3d4e5");

  // Without a note, the code itself is the label.
  const bare = screen.getByRole("link", { name: "f6g7h8i9j0" });
  await expect.element(bare).toBeVisible();
  expect(bare.element().getAttribute("href")).toBe("/f6g7h8i9j0");
});

test("the recents section is absent for users without history", async () => {
  const screen = await render(<CodeEntryForm recent={[]} />);
  expect(screen.getByText("Recently used").query()).toBeNull();
});

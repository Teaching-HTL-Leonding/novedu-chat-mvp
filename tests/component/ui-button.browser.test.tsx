import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Button, buttonVariants } from "@/components/ui/button";

// Pins the Button contract: variants come from cva, callers' className is a
// cn-merged DELTA (their utilities win on conflict), and the element defaults
// to type="button" so it never submits a surrounding form by accident.

test("renders a primary md button by default with type=button", async () => {
  const screen = await render(<Button>Save</Button>);
  const button = screen.getByRole("button", { name: "Save" });

  await expect.element(button).toBeVisible();
  await expect.element(button).toHaveAttribute("type", "button");
  await expect.element(button).toHaveClass("bg-primary");
});

test("applies the requested variant classes", async () => {
  const screen = await render(<Button variant="outline">Change</Button>);
  await expect.element(screen.getByRole("button", { name: "Change" })).toHaveClass("border");
});

test("merges caller className as a delta — caller wins on conflict", async () => {
  const screen = await render(<Button className="h-7">Small</Button>);
  const button = screen.getByRole("button", { name: "Small" });

  // h-9 (size md) must have been replaced by the caller's h-7, not doubled up.
  await expect.element(button).toHaveClass("h-7");
  expect(button.element().className).not.toContain("h-9");
});

test("disabled button is genuinely disabled", async () => {
  const screen = await render(<Button disabled>Nope</Button>);
  await expect.element(screen.getByRole("button", { name: "Nope" })).toBeDisabled();
});

test("buttonVariants styles a link like a button (shared recipe, no drift)", async () => {
  const screen = await render(
    <a href="/somewhere" className={buttonVariants({ variant: "primary" })}>
      Go
    </a>,
  );
  await expect.element(screen.getByRole("link", { name: "Go" })).toHaveClass("bg-primary");
});

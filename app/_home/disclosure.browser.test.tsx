import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

// "How XP works" and "Show all badges" share this toggle: `aria-expanded` on the
// button, `data-expanded` on the wrapper, and the server-rendered parts hidden
// with `group-data-[expanded=true]/disclosure:` utilities. Needs the real
// stylesheet: the reveal is pure CSS.
import "@/app/globals.css";
import { Disclosure } from "./disclosure";

test("toggles aria-expanded and reveals the hidden content", async () => {
  const screen = await render(
    <Disclosure label="How XP works" controls="explain" buttonPlacement="start">
      <p id="explain" className="hidden group-data-[expanded=true]/disclosure:block">
        Every day you're active gives 10 XP.
      </p>
    </Disclosure>,
  );
  const button = screen.getByRole("button", { name: "How XP works" });
  await expect.element(button).toHaveAttribute("aria-expanded", "false");
  await expect.element(button).toHaveAttribute("aria-controls", "explain");
  await expect.element(screen.getByText(/gives 10 XP/)).not.toBeVisible();

  await button.click();
  await expect.element(button).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText(/gives 10 XP/)).toBeVisible();

  await button.click();
  await expect.element(screen.getByText(/gives 10 XP/)).not.toBeVisible();
});

test("swaps the label and reveals the extra badges (Show all badges)", async () => {
  const screen = await render(
    <Disclosure
      label="Show all badges (2 more)"
      expandedLabel="Show fewer badges"
      controls="families"
    >
      <ul id="families">
        <li className="flex">Two in a Row</li>
        <li className="hidden group-data-[expanded=true]/disclosure:flex">Eight-Week Run</li>
      </ul>
    </Disclosure>,
  );
  await expect.element(screen.getByText("Two in a Row")).toBeVisible();
  await expect.element(screen.getByText("Eight-Week Run")).not.toBeVisible();

  await screen.getByRole("button", { name: "Show all badges (2 more)" }).click();
  const fewer = screen.getByRole("button", { name: "Show fewer badges" });
  await expect.element(fewer).toHaveAttribute("aria-expanded", "true");
  await expect.element(screen.getByText("Eight-Week Run")).toBeVisible();
});

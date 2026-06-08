import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { Counter } from "@/components/Counter";

test("increments the count when the button is clicked", async () => {
  const screen = await render(<Counter initial={1} />);

  await expect.element(screen.getByText("Count is 1")).toBeVisible();
  await screen.getByRole("button", { name: "Increment" }).click();
  await expect.element(screen.getByText("Count is 2")).toBeVisible();
});

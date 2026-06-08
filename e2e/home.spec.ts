import { expect, test } from "@playwright/test";

test("home page renders the heading and title", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Create Next App/);
  await expect(page.getByRole("heading", { name: "Chat Prototype" })).toBeVisible();
});

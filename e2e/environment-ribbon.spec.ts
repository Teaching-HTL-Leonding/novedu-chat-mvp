import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";

// The environment ribbon under the status bar (components/environment-ribbon.tsx).
// The suite runs on localhost, so it is the LOCAL ribbon. Its "X" hides it for
// the tab's session: across client navigations (the root layout persists) and
// across a full reload (sessionStorage).

const ribbonOf = (page: Page) => page.getByRole("complementary", { name: "Environment" });

// The ribbon is set by an effect after hydration, so "not there" only means
// something once the page is interactive: the burger menu opening proves it.
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

test.describe("signed in", () => {
  test.use({ storageState: TEACHER_STORAGE_STATE });

  test("the LOCAL ribbon shows until dismissed, then stays hidden", async ({ page }) => {
    await page.goto("/");
    const ribbon = ribbonOf(page);
    await expect(ribbon).toContainText("LOCAL");
    await expect(ribbon.getByRole("link")).toHaveCount(0);

    await ribbon.getByRole("button", { name: "Hide this notice" }).click();
    await expect(ribbon).toHaveCount(0);

    // Client navigation through the status-bar menu.
    await openMenu(page);
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Codes" })
      .click();
    await expect(page).toHaveURL(/\/codes$/);
    await expect(ribbon).toHaveCount(0);

    // A full reload keeps it hidden too.
    await page.reload();
    await openMenu(page);
    await expect(ribbon).toHaveCount(0);
  });
});

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the ribbon also shows on the bare sign-in page", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(ribbonOf(page)).toContainText("LOCAL");
  });
});

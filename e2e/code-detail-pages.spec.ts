import { expect, type Page, test } from "@playwright/test";
import { TEACHER_STORAGE_STATE } from "./auth.constants";
import { mintCode, VALID_CODING_URL, VALID_QUIZ_URL } from "./code.utils";

// Renders every module's teacher detail page (/codes/<code>) end-to-end through
// the REAL server rendering pipeline. Component tests run without React Server
// Component semantics, so a whole class of bugs is invisible to them — e.g. a
// server component importing a value from a "use client" module receives an RSC
// client-reference proxy, whose string coercion lands the proxy's SOURCE CODE in
// the rendered class attribute instead of the classes. These specs pin each
// detail body's key content AND assert no such proxy artifact reaches the HTML.

test.use({ storageState: TEACHER_STORAGE_STATE });

// A stringified RSC client-reference proxy starts a class attribute with the
// proxy function's source; a thrown one mentions dotting into a client module.
async function expectNoRscArtifacts(page: Page): Promise<void> {
  const html = await page.content();
  expect(html).not.toContain('class="function');
  expect(html).not.toContain("client function from the server");
  expect(html).not.toContain("Cannot access");
}

test.describe("teacher code detail pages", { tag: ["@live", "@live-db"] }, () => {
  test("tutor: conversation stats render", async ({ page }) => {
    const code = await mintCode({ module: "tutor" });
    await page.goto(`/codes/${code}`);

    await expect(page.getByText(code)).toBeVisible();
    await expect(page.getByText("Conversations")).toBeVisible();
    await expect(page.getByText("Nothing yet — a conversation counts")).toBeVisible();
    await expectNoRscArtifacts(page);
  });

  test("quiz: discussion stats render", async ({ page }) => {
    const code = await mintCode({ module: "quiz", file: VALID_QUIZ_URL });
    await page.goto(`/codes/${code}`);

    await expect(page.getByText(code)).toBeVisible();
    await expect(page.getByText("Discussions")).toBeVisible();
    await expect(page.getByText("Nothing yet — a conversation counts")).toBeVisible();
    await expectNoRscArtifacts(page);
  });

  test("writing (attributed): savers list renders", async ({ page }) => {
    const code = await mintCode({ module: "writing", anonymous: false });
    await page.goto(`/codes/${code}`);

    await expect(page.getByText(code)).toBeVisible();
    await expect(
      page.getByText("Nothing yet — a student appears here once they save their text."),
    ).toBeVisible();
    await expectNoRscArtifacts(page);
  });

  test("coding: config + connection render, and the system-prompt panel is styled", async ({
    page,
  }) => {
    const code = await mintCode({ module: "coding", file: VALID_CODING_URL });
    await page.goto(`/codes/${code}`);

    await expect(page.getByText("Model (pinned)")).toBeVisible();
    await expect(page.getByText("System prompt")).toBeVisible();
    await expect(page.getByText("Connection details")).toBeVisible();
    // The connection block lists the code as the API key.
    await expect(page.getByText(code, { exact: true }).first()).toBeVisible();
    await expectNoRscArtifacts(page);

    // The regression this spec exists for: the system-prompt <pre> must carry the
    // shared CODE_PANEL chrome. Assert the RENDERED style (a real border), not a
    // class name, so a recipe rename can't silently pass while styling is lost.
    const promptPanel = page.locator('p:has-text("System prompt") + pre');
    await expect(promptPanel).toBeVisible();
    const borderWidth = await promptPanel.evaluate(
      (el) => window.getComputedStyle(el).borderTopWidth,
    );
    expect(borderWidth).not.toBe("0px");
  });
});

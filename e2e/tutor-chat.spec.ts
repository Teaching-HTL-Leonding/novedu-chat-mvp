import { expect, test } from "@playwright/test";
import { BROKEN_TUTOR_URL, mintTutorCode } from "./tutor-code.utils";

// Exercises the chat page's server-side tutor validation: the tutor code can
// be perfectly valid and the tutor YAML still broken — the student must then
// see the structured error list, never a chat. (The happy path lives in
// tutor-code-link.spec.ts; the full message round-trip in
// tutor-chat-reply.spec.ts.)

// Network round-trip to GitHub + Next dev compilation — give it room.
test.setTimeout(60_000);

// @live: minting the code needs the live database — excluded in CI.
test("a valid code for a broken tutor shows the error list and no chat", { tag: "@live" }, async ({
  page,
}) => {
  const code = await mintTutorCode({ tutor: BROKEN_TUTOR_URL });
  await page.goto(`/${code}`);

  // The broken tutor omits a required variable and references a missing fragment.
  await expect(page.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  // No chat surface.
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

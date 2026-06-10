import { expect, test } from "@playwright/test";
import { BROKEN_TUTOR_URL, makeShareLink, openWindow } from "./share-link.utils";

// Exercises the chat page's server-side tutor validation: the share link's
// signature and window can be perfectly valid and the tutor YAML still broken —
// the student must then see the structured error list, never a chat. (The happy
// path lives in deep-link.spec.ts; the full message round-trip in
// tutor-chat-reply.spec.ts.)

// Network round-trip to GitHub + Next dev compilation — give it room.
test.setTimeout(60_000);

test("a validly signed link to a broken tutor shows the error list and no chat", async ({
  page,
}) => {
  await page.goto(makeShareLink(openWindow(BROKEN_TUTOR_URL)));

  // The broken tutor omits a required variable and references a missing fragment.
  await expect(page.getByText("MISSING_REQUIRED_VARIABLE")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  // No chat surface.
  await expect(page.getByPlaceholder("Type a message...")).toHaveCount(0);
});

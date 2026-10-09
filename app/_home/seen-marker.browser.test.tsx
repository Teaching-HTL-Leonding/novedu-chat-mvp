import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The new-badges strip's one side effect: once rendered, it marks exactly the
// announced badges as seen — once, never again on a re-render, and silently
// when the call fails.

const markAchievementsSeen = vi.hoisted(() => vi.fn());
vi.mock("@/lib/achievement-actions", () => ({ markAchievementsSeen }));

import { SeenMarker } from "./seen-marker";

beforeEach(() => {
  markAchievementsSeen.mockResolvedValue({ ok: true });
});

test("marks exactly the presented ids once, and never again on a re-render", async () => {
  const screen = await render(
    <p>
      New <SeenMarker ids={["weekly-streak-2", "active-days-10"]} />
    </p>,
  );
  await expect.poll(() => markAchievementsSeen.mock.calls.length).toBe(1);
  expect(markAchievementsSeen).toHaveBeenCalledWith(["weekly-streak-2", "active-days-10"]);

  await screen.rerender(
    <p>
      New again <SeenMarker ids={["weekly-streak-2", "active-days-10", "other-1"]} />
    </p>,
  );
  await expect.element(screen.getByText("New again")).toBeVisible();
  expect(markAchievementsSeen).toHaveBeenCalledTimes(1);
});

test("a failing call is silent and leaves the page intact", async () => {
  const errors: unknown[] = [];
  const onError = (event: PromiseRejectionEvent) => errors.push(event.reason);
  window.addEventListener("unhandledrejection", onError);
  markAchievementsSeen.mockRejectedValue(new Error("network down"));

  const screen = await render(
    <p>
      Still here <SeenMarker ids={["a-1"]} />
    </p>,
  );
  await expect.poll(() => markAchievementsSeen.mock.calls.length).toBe(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.removeEventListener("unhandledrejection", onError);

  await expect.element(screen.getByText("Still here")).toBeVisible();
  expect(errors).toEqual([]);
});

test("nothing to mark, no call", async () => {
  await render(<SeenMarker ids={[]} />);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(markAchievementsSeen).not.toHaveBeenCalled();
});

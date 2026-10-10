import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { DemoRibbon } from "@/components/demo-ribbon";

// A demo build's ribbon (components/demo-ribbon.tsx, docs/auth.md "Demo mode"): no
// hostname logic, no dismiss control, and blind to the dismissal key the
// hostname-based ribbon honours — a tab that hid LOCAL before still sees DEMO.

test("names the demo installation, with no way to hide it", async () => {
  sessionStorage.setItem("novedu-env-ribbon-dismissed", "1");
  try {
    const screen = await render(<DemoRibbon />);

    const ribbon = screen.getByRole("complementary", { name: "Environment" });
    await expect.element(ribbon).toBeVisible();
    await expect.element(ribbon).toHaveTextContent(/^DEMO · Demo installation/);
    await expect.element(ribbon).toHaveTextContent(/never real student data\.$/);
    expect(screen.getByRole("button").query()).toBeNull();
  } finally {
    sessionStorage.removeItem("novedu-env-ribbon-dismissed");
  }
});

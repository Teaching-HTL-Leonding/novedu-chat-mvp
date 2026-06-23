import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { CodeError } from "@/app/code-error";

// The student-facing explanation for every way a code can be rejected.
// `app/[code]/page.tsx` decides WHICH rejection to render (covered by
// app/[code]/page.unit.test.ts); this asserts each one renders the right
// heading and, for the windowed reasons, a machine-readable <time>. Pure prop
// rendering — no DB, so it replaces the @live rejection-rendering e2e in
// e2e/tutor-code-link.spec.ts.

const FROM = new Date("2026-06-10T10:00:00Z");
const UNTIL = new Date("2026-06-10T14:00:00Z");

test("unknown code: explains the code does not exist, no <time>", async () => {
  const screen = await render(<CodeError verification={{ ok: false, reason: "unknown-code" }} />);
  await expect.element(screen.getByRole("heading", { name: "Unknown code" })).toBeVisible();
  expect(document.querySelector("time")).toBeNull();
});

test("not-started: names when the code becomes active", async () => {
  const screen = await render(
    <CodeError
      verification={{ ok: false, reason: "not-started", validFrom: FROM, validUntil: UNTIL }}
    />,
  );
  await expect.element(screen.getByRole("heading", { name: "Not available yet" })).toBeVisible();
  // The <time> carries validFrom (when it opens), as a machine-readable ISO value.
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(FROM.toISOString());
});

test("expired: names when the code was valid until", async () => {
  const screen = await render(
    <CodeError
      verification={{ ok: false, reason: "expired", validFrom: FROM, validUntil: UNTIL }}
    />,
  );
  await expect.element(screen.getByRole("heading", { name: "Code expired" })).toBeVisible();
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(UNTIL.toISOString());
});

test("lookup-failed: framed as transient, no <time>", async () => {
  const screen = await render(<CodeError verification={{ ok: false, reason: "lookup-failed" }} />);
  await expect
    .element(screen.getByRole("heading", { name: "Codes temporarily unavailable" }))
    .toBeVisible();
  expect(document.querySelector("time")).toBeNull();
});

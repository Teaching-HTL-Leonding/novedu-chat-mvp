import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { INCIDENT_2026_09_25 } from "@/lib/diagnostics-report.fixture";
import { CopyReportButton } from "./copy-report-button";

// The Copy-report button formats the DTO it was handed and writes it to the
// clipboard (spied, as in copy-code-button.browser.test.tsx); a refused clipboard
// falls back to a read-only text field holding the whole report.

test("copies the report and confirms", async () => {
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  try {
    const screen = await render(<CopyReportButton dto={INCIDENT_2026_09_25} />);
    await screen.getByRole("button", { name: "Copy report" }).click();

    await expect.element(screen.getByRole("button", { name: "Copied" })).toBeVisible();
    const text = String(writeText.mock.calls[0]?.[0]);
    expect(text.startsWith("Novedu — LLM diagnostics\n")).toBe(true);
    expect(text).toContain("Range:     2026-09-25T05:00Z – 2026-09-25T09:00Z");
    expect(text).toContain("Provider SCCH — 102 calls");
  } finally {
    writeText.mockRestore();
  }
});

test("shows the report in a text field when the clipboard is refused", async () => {
  const writeText = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValue(new Error("NotAllowedError"));
  try {
    const screen = await render(<CopyReportButton dto={INCIDENT_2026_09_25} />);
    await screen.getByRole("button", { name: "Copy report" }).click();

    const field = screen.getByRole("textbox", { name: "Diagnostics report" });
    await expect.element(field).toBeVisible();
    expect((field.element() as HTMLTextAreaElement).value).toContain("Student impact");
  } finally {
    writeText.mockRestore();
  }
});

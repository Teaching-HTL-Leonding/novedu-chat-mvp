// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Slice } from "@/lib/usage-range";

// `ModelsSection` renders the tokens-by-model pie from one `getTokensByModel`
// read; assert the slice labels reach the pie and that the empty-range and
// failed-read branches render the right copy. The client Recharts pie is stubbed
// so this stays a hermetic node render. No DB, runs in CI.

const getTokensByModel = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usage-stats-store", () => ({ getTokensByModel }));
vi.mock("./tokens-pie-chart", () => ({
  TokensPieChart: ({ slices }: { slices: { label: string }[] }) => (
    <div data-testid="pie">{slices.map((s) => s.label).join(",")}</div>
  ),
}));

import { ModelsSection } from "./models-section";

async function render(slices: Slice[] | undefined) {
  getTokensByModel.mockResolvedValue(slices);
  return renderToStaticMarkup(
    await ModelsSection({ range: "7d", now: new Date("2026-07-04T14:30:00Z") }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("renders the model slices (including the NULL-model '(unknown)' label)", async () => {
  const html = await render([
    { key: "gpt-5.4-mini", label: "gpt-5.4-mini", total: 500 },
    { key: "(unknown)", label: "(unknown)", total: 200 },
  ]);
  expect(html).toContain("Tokens by model");
  expect(html).toContain("gpt-5.4-mini");
  expect(html).toContain("(unknown)");
});

it("shows the empty-range copy when there are no slices", async () => {
  const html = await render([]);
  expect(html).toContain("No usage in this range");
});

it("degrades to the unavailable copy when the read fails", async () => {
  const html = await render(undefined);
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("No usage in this range");
});

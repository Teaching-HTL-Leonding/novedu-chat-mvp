// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Slice } from "@/lib/usage-range";

// `ModelsSection` renders the tokens-by-model and tokens-by-provider pies from two
// independent reads; assert the slice labels reach each pie and that the
// empty-range and failed-read branches render the right copy PER CARD (one failing
// read must not blank the other). The client Recharts pie is stubbed so this stays
// a hermetic node render. No DB, runs in CI.

const getTokensByModel = vi.hoisted(() => vi.fn());
const getTokensByProvider = vi.hoisted(() => vi.fn());

vi.mock("@/lib/usage-stats-store", () => ({ getTokensByModel, getTokensByProvider }));
vi.mock("./tokens-pie-chart", () => ({
  TokensPieChart: ({ slices }: { slices: { label: string }[] }) => (
    <div data-testid="pie">{slices.map((s) => s.label).join(",")}</div>
  ),
}));

import { ModelsSection } from "./models-section";

// Both reads are always passed explicitly: a default would swallow the `undefined`
// that stands for a failed read.
async function render(models: Slice[] | undefined, providers: Slice[] | undefined) {
  getTokensByModel.mockResolvedValue(models);
  getTokensByProvider.mockResolvedValue(providers);
  return renderToStaticMarkup(
    await ModelsSection({ range: "7d", now: new Date("2026-07-04T14:30:00Z") }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("renders the model slices (including the NULL-model '(unknown)' label)", async () => {
  const html = await render(
    [
      { key: "gpt-5.4-mini", label: "gpt-5.4-mini", total: 500 },
      { key: "(unknown)", label: "(unknown)", total: 200 },
    ],
    [],
  );
  expect(html).toContain("Tokens by model");
  expect(html).toContain("gpt-5.4-mini");
  expect(html).toContain("(unknown)");
});

it("renders the provider slices in their own card", async () => {
  const html = await render(
    [{ key: "gpt-5.4-mini", label: "gpt-5.4-mini", total: 500 }],
    [
      { key: "SCCH", label: "SCCH", total: 300 },
      { key: "OpenRouter", label: "OpenRouter", total: 200 },
    ],
  );
  expect(html).toContain("Tokens by provider");
  expect(html).toContain("SCCH");
  expect(html).toContain("OpenRouter");
});

it("shows the empty-range copy when there are no slices", async () => {
  const html = await render([], []);
  expect(html).toContain("No usage in this range");
});

it("degrades to the unavailable copy when the reads fail", async () => {
  const html = await render(undefined, undefined);
  expect(html).toContain("could not be loaded");
  expect(html).not.toContain("No usage in this range");
});

it("degrades only the card whose read failed", async () => {
  const html = await render(undefined, [{ key: "SCCH", label: "SCCH", total: 300 }]);
  expect(html).toContain("could not be loaded"); // the model card
  expect(html).toContain("SCCH"); // the provider card still rendered
});

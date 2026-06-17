import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ValidateTutorForm } from "@/app/validate-tutor/validate-tutor-form";

// The form navigates via useRouter for the "View in GUI" button, so a router must
// be present when it renders in isolation.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const SAMPLE_URL = "https://example.com/tutor.yaml";

function mockFetchOnce(data: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ json: async () => data })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("shows the assembled prompt as a syntax-highlighted, copyable source block", async () => {
  mockFetchOnce({ ok: true, prompt: "# Hello\n\nMass-energy: $E=mc^2$.", warnings: [] });
  const screen = await render(<ValidateTutorForm />);

  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Validate" }).click();

  // Rendered through the shared CodeBlock: language label, copy button, line numbers.
  await expect.element(screen.getByText("markdown")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: /copy code/i })).toBeVisible();
  expect(document.querySelectorAll(".linenumber").length).toBeGreaterThan(0);

  // The markdown is shown as SOURCE (verbatim text across token spans), not rendered.
  const code = document.querySelector('code[class*="language-"]');
  expect(code?.textContent).toContain("# Hello");
  expect(code?.textContent).toContain("$E=mc^2$");
  expect(document.querySelector("h1")).toBeNull();
  expect(document.querySelector(".katex")).toBeNull();
});

test("renders the structured error list on failure", async () => {
  mockFetchOnce({
    ok: false,
    errors: [{ code: "FRAGMENT_NOT_FOUND", message: "Fragment foo not found in file bar" }],
    warnings: [],
  });
  const screen = await render(<ValidateTutorForm />);

  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Validate" }).click();

  await expect.element(screen.getByText("FRAGMENT_NOT_FOUND")).toBeVisible();
  await expect.element(screen.getByText("Fragment foo not found in file bar")).toBeVisible();
});

test("shows a loading state while the request is in flight", async () => {
  let release: () => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ json: async () => ({ ok: true, prompt: "# Done", warnings: [] }) });
        }),
    ),
  );

  const screen = await render(<ValidateTutorForm />);
  await screen.getByRole("textbox").fill(SAMPLE_URL);
  await screen.getByRole("button", { name: "Validate" }).click();

  // Button flips to the loading label and is disabled until the request resolves.
  await expect.element(screen.getByRole("button", { name: "Validating…" })).toBeDisabled();

  release();
  await expect.element(screen.getByText("markdown")).toBeVisible();
  expect(document.querySelector('code[class*="language-"]')?.textContent).toContain("# Done");
});

import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  addToDatetimeLocal,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
} from "@/lib/datetime-local";

// Mock the server action: it needs auth + the signing secret, neither of which
// exists in the browser test runner. The mock captures the submitted FormData
// so the tests can assert the browser→server contract (especially the
// local-time → unix-seconds conversion done by the form).
const submitted: FormData[] = [];
let nextResult: { status: string; link?: string; message?: string } = {
  status: "success",
  link: "http://localhost:3000/?tutor=x&start=1&end=2&sig=abc",
};
// When set, the mocked action stays pending until this promise resolves —
// lets tests observe the form's in-flight state.
let hold: Promise<void> | null = null;

vi.mock("@/lib/share-link-actions", () => ({
  createShareLinkAction: vi.fn(async (_prev: unknown, formData: FormData) => {
    submitted.push(formData);
    if (hold) await hold;
    return nextResult;
  }),
}));

import { ShareTutorForm } from "@/app/share-tutor/share-tutor-form";

const TUTOR_URL = "https://example.com/tutor.yaml";
const START = "2026-06-10T10:00";
const END = "2026-06-10T12:00";

async function fillAndSubmit(screen: Awaited<ReturnType<typeof render>>) {
  await screen.getByLabelText("Tutor YAML URL").fill(TUTOR_URL);
  await screen.getByLabelText(/Available from/).fill(START);
  await screen.getByLabelText(/Available until/).fill(END);
  await screen.getByRole("button", { name: "Create Share Link" }).click();
}

test("submits the tutor URL and the window as unix seconds (local-time converted)", async () => {
  submitted.length = 0;
  nextResult = { status: "success", link: "http://localhost:3000/?sig=abc" };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);
  await expect.element(screen.getByRole("heading", { name: "Share link" })).toBeVisible();

  expect(submitted).toHaveLength(1);
  const formData = submitted[0];
  if (!formData) throw new Error("no FormData captured");
  expect(formData.get("tutor")).toBe(TUTOR_URL);
  // The hidden fields must carry the datetime-local values converted IN THE
  // BROWSER to unix seconds — the only place the user's timezone is known.
  expect(formData.get("startTs")).toBe(String(datetimeLocalToUnixSeconds(START)));
  expect(formData.get("endTs")).toBe(String(datetimeLocalToUnixSeconds(END)));
});

test("shows the generated link in a copyable, read-only field", async () => {
  const link = "http://localhost:3000/?tutor=x&start=1&end=2&sig=abc";
  nextResult = { status: "success", link };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  const output = screen.getByLabelText("Share link");
  await expect.element(output).toBeVisible();
  expect((output.element() as HTMLInputElement).value).toBe(link);
  expect((output.element() as HTMLInputElement).readOnly).toBe(true);

  // The Copy button puts the link on the clipboard.
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  await screen.getByRole("button", { name: "Copy" }).click();
  expect(writeText).toHaveBeenCalledWith(link);
  await expect.element(screen.getByRole("button", { name: "Copied!" })).toBeVisible();
  writeText.mockRestore();
});

test("renders the server action's error message", async () => {
  nextResult = {
    status: "error",
    message: "The end of the availability window must be after its start.",
  };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  await expect.element(screen.getByText(/end of the availability window/i)).toBeVisible();
  expect(screen.getByLabelText("Share link").query()).toBeNull();
});

function inputValue(locator: { element: () => Element }): string {
  return (locator.element() as HTMLInputElement).value;
}

test("the Now button fills 'Available from' with the current local time", async () => {
  const screen = await render(<ShareTutorForm />);

  await screen.getByRole("button", { name: "Now" }).click();

  const value = inputValue(screen.getByLabelText(/Available from/));
  // Tolerate a minute tick between click and assertion.
  const drift = Math.abs(
    datetimeLocalToUnixSeconds(value) - datetimeLocalToUnixSeconds(nowAsDatetimeLocal()),
  );
  expect(drift).toBeLessThanOrEqual(60);
});

test("+1h/+1d/+1w start from 'Available from' when until is empty, then extend until", async () => {
  const screen = await render(<ShareTutorForm />);
  await screen.getByLabelText(/Available from/).fill(START);

  // Until is empty → from + 1h.
  await screen.getByRole("button", { name: "+1h" }).click();
  const until = screen.getByLabelText(/Available until/);
  expect(inputValue(until)).toBe(addToDatetimeLocal(START, 1, "hours"));

  // Until is set → extend the existing value.
  await screen.getByRole("button", { name: "+1d" }).click();
  expect(inputValue(until)).toBe(
    addToDatetimeLocal(addToDatetimeLocal(START, 1, "hours"), 1, "days"),
  );

  await screen.getByRole("button", { name: "+1w" }).click();
  expect(inputValue(until)).toBe(
    addToDatetimeLocal(
      addToDatetimeLocal(addToDatetimeLocal(START, 1, "hours"), 1, "days"),
      1,
      "weeks",
    ),
  );
});

test("disables the form and shows a pending label while the action is in flight", async () => {
  // Hold the (mocked) action open so the pending state is observable.
  let release: (() => void) | undefined;
  hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  nextResult = { status: "error", message: "released" };

  const screen = await render(<ShareTutorForm />);
  await fillAndSubmit(screen);

  // While pending: label switches, inputs and submit are disabled (so a
  // double-click cannot create two links).
  await expect.element(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await expect.element(screen.getByLabelText("Tutor YAML URL")).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Now" })).toBeDisabled();

  release?.();
  hold = null;
  await expect.element(screen.getByText("released")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Create Share Link" })).toBeEnabled();
});

test("+1h falls back to now when neither field is set", async () => {
  const screen = await render(<ShareTutorForm />);

  await screen.getByRole("button", { name: "+1h" }).click();

  const value = inputValue(screen.getByLabelText(/Available until/));
  const expected = datetimeLocalToUnixSeconds(addToDatetimeLocal(nowAsDatetimeLocal(), 1, "hours"));
  expect(Math.abs(datetimeLocalToUnixSeconds(value) - expected)).toBeLessThanOrEqual(60);
});

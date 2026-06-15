import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  addToDatetimeLocal,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
} from "@/lib/datetime-local";

// Mock the server action: it needs auth + the database, neither of which
// exists in the browser test runner. The mock captures the submitted FormData
// so the tests can assert the browser→server contract (especially the
// local-time → unix-seconds conversion done by the form).
const submitted: FormData[] = [];
let nextResult: {
  status: string;
  link?: string;
  note?: string;
  message?: string;
  errors?: { code: string; message: string; zodIssues?: unknown }[];
} = {
  status: "success",
  link: "http://localhost:3000/a1b2c3d4e5",
  note: "",
};
// When set, the mocked action stays pending until this promise resolves —
// lets tests observe the form's in-flight state.
let hold: Promise<void> | null = null;

vi.mock("@/lib/tutor-code-actions", () => ({
  createTutorCodeAction: vi.fn(async (_prev: unknown, formData: FormData) => {
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
  await screen.getByRole("button", { name: "Create Tutor Code" }).click();
}

test("submits the tutor URL, note, and window as unix seconds (local-time converted)", async () => {
  submitted.length = 0;
  nextResult = { status: "success", link: "http://localhost:3000/a1b2c3d4e5", note: "My class" };
  const screen = await render(<ShareTutorForm />);

  await screen.getByLabelText(/Note/).fill("My class");
  await fillAndSubmit(screen);
  await expect.element(screen.getByRole("heading", { name: "Tutor Code" })).toBeVisible();

  expect(submitted).toHaveLength(1);
  const formData = submitted[0];
  if (!formData) throw new Error("no FormData captured");
  expect(formData.get("tutor")).toBe(TUTOR_URL);
  expect(formData.get("note")).toBe("My class");
  // The hidden fields must carry the datetime-local values converted IN THE
  // BROWSER to unix seconds — the only place the user's timezone is known.
  expect(formData.get("startTs")).toBe(String(datetimeLocalToUnixSeconds(START)));
  expect(formData.get("endTs")).toBe(String(datetimeLocalToUnixSeconds(END)));
});

test("shows the tutor code URL in a copyable, read-only field", async () => {
  const link = "http://localhost:3000/a1b2c3d4e5";
  nextResult = { status: "success", link, note: "" };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  const output = screen.getByLabelText("Tutor Code link", { exact: true });
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

test("offers an open-in-new-tab button beside Copy", async () => {
  const link = "http://localhost:3000/a1b2c3d4e5";
  nextResult = { status: "success", link, note: "" };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  // An anchor (not window.open) so it works without JS and middle-click etc.
  // behave normally; target=_blank with the opener severed.
  const open = screen.getByRole("link", { name: "Open Tutor Code link in new tab" });
  await expect.element(open).toBeVisible();
  expect(open.element().getAttribute("href")).toBe(link);
  expect(open.element().getAttribute("target")).toBe("_blank");
  expect(open.element().getAttribute("rel")).toContain("noopener");
});

test("renders the server action's error message (e.g. when storage failed)", async () => {
  nextResult = {
    status: "error",
    message: "The tutor code could not be stored. Try again, or contact the operator.",
  };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  await expect.element(screen.getByText(/could not be stored/i)).toBeVisible();
  expect(screen.getByLabelText("Tutor Code link", { exact: true }).query()).toBeNull();
});

test("renders the validator's structured error list (with zod field detail) on a broken tutor", async () => {
  nextResult = {
    status: "error",
    errors: [
      {
        code: "TUTOR_SCHEMA_ERROR",
        message: "Document does not match the expected structure",
        zodIssues: {
          errors: ['Unrecognized key: "nae"'],
          properties: { name: { errors: ["Invalid input: expected string, received undefined"] } },
        },
      },
    ],
  };
  const screen = await render(<ShareTutorForm />);

  await fillAndSubmit(screen);

  // The full, actionable detail is shown — not just a generic message.
  await expect.element(screen.getByRole("heading", { name: /Validation failed/ })).toBeVisible();
  await expect.element(screen.getByText("TUTOR_SCHEMA_ERROR")).toBeVisible();
  await expect.element(screen.getByText('Unrecognized key: "nae"')).toBeVisible();
  await expect
    .element(screen.getByText("name: Invalid input: expected string, received undefined"))
    .toBeVisible();
  expect(screen.getByLabelText("Tutor Code link", { exact: true }).query()).toBeNull();
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
  // double-click cannot create two codes).
  await expect.element(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
  await expect.element(screen.getByLabelText("Tutor YAML URL")).toBeDisabled();
  await expect.element(screen.getByLabelText(/Note/)).toBeDisabled();
  await expect.element(screen.getByRole("button", { name: "Now" })).toBeDisabled();

  release?.();
  hold = null;
  await expect.element(screen.getByText("released")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Create Tutor Code" })).toBeEnabled();
});

test("+1h falls back to now when neither field is set", async () => {
  const screen = await render(<ShareTutorForm />);

  await screen.getByRole("button", { name: "+1h" }).click();

  const value = inputValue(screen.getByLabelText(/Available until/));
  const expected = datetimeLocalToUnixSeconds(addToDatetimeLocal(nowAsDatetimeLocal(), 1, "hours"));
  expect(Math.abs(datetimeLocalToUnixSeconds(value) - expected)).toBeLessThanOrEqual(60);
});

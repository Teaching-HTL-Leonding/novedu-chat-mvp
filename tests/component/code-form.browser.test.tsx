import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import {
  addToDatetimeLocal,
  datetimeLocalToUnixSeconds,
  nowAsDatetimeLocal,
  unixSecondsToDatetimeLocal,
} from "@/lib/datetime-local";

// The form is reused for create AND edit. Server actions need auth + the
// database, neither of which exists in the browser runner, so they are mocked to
// capture the submitted FormData — letting the tests assert the browser→server
// contract (especially the local-time → unix-seconds conversion the form does).

const created: FormData[] = [];
const updated: { code: string; formData: FormData }[] = [];
let updateResult: { status: string; message?: string; errors?: unknown[] } = { status: "saved" };

vi.mock("@/lib/code-actions", () => ({
  createCodeAction: vi.fn(async (_prev: unknown, formData: FormData) => {
    created.push(formData);
    // The real action redirects; the form renders nothing extra in create mode.
    return { status: "idle" };
  }),
  updateCodeAction: vi.fn(async (code: string, _prev: unknown, formData: FormData) => {
    updated.push({ code, formData });
    return updateResult;
  }),
}));
// BackLink uses next/link.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: unknown; children: unknown }) => (
    <a href={String(href)}>{children as never}</a>
  ),
}));

import { CodeForm } from "@/app/codes/code-form";

const FILE_URL = "https://example.com/tutor.yaml";
const START = "2026-06-10T10:00";
const END = "2026-06-10T12:00";

function inputValue(locator: { element: () => Element }): string {
  return (locator.element() as HTMLInputElement).value;
}

test("create: submits module, file URL, note, and window as unix seconds (local-time converted)", async () => {
  created.length = 0;
  const screen = await render(<CodeForm mode="create" initialModule="quiz" />);

  await screen.getByLabelText("Activity YAML URL").fill(FILE_URL);
  await screen.getByLabelText(/Note/).fill("My class");
  await screen.getByLabelText(/Available from/).fill(START);
  await screen.getByLabelText(/Available until/).fill(END);
  await screen.getByRole("button", { name: "Create code" }).click();

  await vi.waitFor(() => expect(created).toHaveLength(1));
  const formData = created[0];
  if (!formData) throw new Error("no FormData captured");
  expect(formData.get("module")).toBe("quiz");
  expect(formData.get("file")).toBe(FILE_URL);
  expect(formData.get("note")).toBe("My class");
  // Converted IN THE BROWSER — the only place the user's timezone is known.
  expect(formData.get("startTs")).toBe(String(datetimeLocalToUnixSeconds(START)));
  expect(formData.get("endTs")).toBe(String(datetimeLocalToUnixSeconds(END)));
});

test("create: the Now button fills 'Available from' with the current local time", async () => {
  const screen = await render(<CodeForm mode="create" />);

  await screen.getByRole("button", { name: "Now" }).click();

  const value = inputValue(screen.getByLabelText(/Available from/));
  const drift = Math.abs(
    datetimeLocalToUnixSeconds(value) - datetimeLocalToUnixSeconds(nowAsDatetimeLocal()),
  );
  expect(drift).toBeLessThanOrEqual(60);
});

test("create: +1h/+1d/+1w start from 'Available from' when until is empty, then extend until", async () => {
  const screen = await render(<CodeForm mode="create" />);
  await screen.getByLabelText(/Available from/).fill(START);

  await screen.getByRole("button", { name: "+1h" }).click();
  const until = screen.getByLabelText(/Available until/);
  expect(inputValue(until)).toBe(addToDatetimeLocal(START, 1, "hours"));

  await screen.getByRole("button", { name: "+1d" }).click();
  expect(inputValue(until)).toBe(
    addToDatetimeLocal(addToDatetimeLocal(START, 1, "hours"), 1, "days"),
  );
});

test("create: the Clear button empties a date field and submits it as an open bound", async () => {
  created.length = 0;
  const screen = await render(<CodeForm mode="create" />);

  await screen.getByLabelText("Activity YAML URL").fill(FILE_URL);
  await screen.getByLabelText(/Available from/).fill(START);
  await screen.getByLabelText(/Available until/).fill(END);

  // Clear the start: the field empties and the open-ended bound is submitted blank.
  await screen.getByRole("button", { name: "Clear start" }).click();
  expect(inputValue(screen.getByLabelText(/Available from/))).toBe("");

  await screen.getByRole("button", { name: "Create code" }).click();

  await vi.waitFor(() => expect(created).toHaveLength(1));
  const formData = created[0];
  if (!formData) throw new Error("no FormData captured");
  expect(formData.get("startTs")).toBe("");
  expect(formData.get("endTs")).toBe(String(datetimeLocalToUnixSeconds(END)));
});

test("edit: file URL is read-only, fields are pre-filled, and the shareable link shows", async () => {
  const shareUrl = "http://localhost:3000/a1b2c3d4e5";
  const screen = await render(
    <CodeForm
      mode="edit"
      code="a1b2c3d4e5"
      initialModule="tutor"
      initialFileUrl={FILE_URL}
      initialNote="3AHIF exercise"
      initialStartSeconds={datetimeLocalToUnixSeconds(START)}
      initialEndSeconds={datetimeLocalToUnixSeconds(END)}
      shareUrl={shareUrl}
    />,
  );

  const url = screen.getByLabelText(/Activity YAML URL/);
  expect((url.element() as HTMLInputElement).readOnly).toBe(true);
  expect(inputValue(url)).toBe(FILE_URL);

  expect(inputValue(screen.getByLabelText(/Note/))).toBe("3AHIF exercise");
  expect(inputValue(screen.getByLabelText(/Available from/))).toBe(
    unixSecondsToDatetimeLocal(datetimeLocalToUnixSeconds(START)),
  );

  const link = screen.getByLabelText("Share link", { exact: true });
  await expect.element(link).toBeVisible();
  expect(inputValue(link)).toBe(shareUrl);
});

test("edit: Save submits the window + note to the bound code and shows 'Saved'", async () => {
  updated.length = 0;
  updateResult = { status: "saved" };
  const screen = await render(
    <CodeForm
      mode="edit"
      code="a1b2c3d4e5"
      initialModule="tutor"
      initialFileUrl={FILE_URL}
      initialNote="old"
      initialStartSeconds={datetimeLocalToUnixSeconds(START)}
      initialEndSeconds={datetimeLocalToUnixSeconds(END)}
      shareUrl="http://localhost:3000/a1b2c3d4e5"
    />,
  );

  await screen.getByLabelText(/Note/).fill("new note");
  await screen.getByRole("button", { name: "Save changes" }).click();

  await expect.element(screen.getByText("Saved")).toBeVisible();
  expect(updated).toHaveLength(1);
  const captured = updated[0];
  if (!captured) throw new Error("no update captured");
  expect(captured.code).toBe("a1b2c3d4e5");
  expect(captured.formData.get("note")).toBe("new note");
  expect(captured.formData.get("startTs")).toBe(String(datetimeLocalToUnixSeconds(START)));
});

test("edit: renders the server action's error message", async () => {
  updateResult = { status: "error", message: "This code no longer exists. Reload the list." };
  const screen = await render(
    <CodeForm
      mode="edit"
      code="a1b2c3d4e5"
      initialModule="tutor"
      initialFileUrl={FILE_URL}
      initialNote="x"
      initialStartSeconds={datetimeLocalToUnixSeconds(START)}
      initialEndSeconds={datetimeLocalToUnixSeconds(END)}
      shareUrl="http://localhost:3000/a1b2c3d4e5"
    />,
  );

  await screen.getByRole("button", { name: "Save changes" }).click();
  await expect.element(screen.getByText(/no longer exists/i)).toBeVisible();
});

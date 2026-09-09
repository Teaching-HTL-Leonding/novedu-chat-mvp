import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

// The image upload form's client behaviour: the checks that spare a teacher a
// pointless round trip (no file / empty / oversize / wrong type), the MIME
// inferred from the file NAME, the exact `FormData` the server action receives,
// the pending state, and the three outcomes (server message kept beside the
// retained inputs, network failure, success → the list). The action and the
// router are mocked; nothing here talks to storage.

const mocks = vi.hoisted(() => ({ uploadImage: vi.fn(), push: vi.fn() }));

vi.mock("@/lib/images-actions", () => ({ uploadImage: mocks.uploadImage }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
// `next/link` (behind the "Back to images" link) reads `process` at import time,
// which the browser project has no shim for — same stand-in as the file forms.
vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children }: { href: unknown; children: unknown }) => (
    <a href={String(href)}>{children as never}</a>
  ),
}));

import { UploadImageForm } from "@/app/images/new/upload-image-form";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Puts a file on the picker the way a teacher would, so React sees the change. */
function attach(file: File) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("file input not rendered");
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Submits the form directly — the button is disabled until a file is chosen. */
function submitForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("form not rendered");
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.uploadImage.mockResolvedValue({ ok: true, name: "diagram" });
});

test("without a file it asks for one and never calls the action", async () => {
  const screen = await render(<UploadImageForm />);
  submitForm();

  await expect.element(screen.getByText("Choose an image file to upload.")).toBeVisible();
  expect(mocks.uploadImage).not.toHaveBeenCalled();
});

test("an empty file is refused in the browser", async () => {
  const screen = await render(<UploadImageForm />);
  // The name field is `required`, so it must be filled or the browser blocks
  // the submit before the form's own checks can run.
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([], "empty.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await expect
    .element(screen.getByText("The image is empty — choose a file with content."))
    .toBeVisible();
  expect(mocks.uploadImage).not.toHaveBeenCalled();
});

test("a file over 5 MB is refused before the bytes leave the browser", async () => {
  const screen = await render(<UploadImageForm />);
  // The name field is `required`, so it must be filled or the browser blocks
  // the submit before the form's own checks can run.
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "big.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await expect
    .element(screen.getByText("The image is too large — the maximum is 5 MB."))
    .toBeVisible();
  expect(mocks.uploadImage).not.toHaveBeenCalled();
});

test("an unsupported extension is refused", async () => {
  const screen = await render(<UploadImageForm />);
  // The name field is `required`, so it must be filled or the browser blocks
  // the submit before the form's own checks can run.
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([new Uint8Array(8)], "animation.gif", { type: "image/gif" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await expect
    .element(screen.getByText("Only PNG, JPEG and SVG images are allowed."))
    .toBeVisible();
  expect(mocks.uploadImage).not.toHaveBeenCalled();
});

test("posts exactly the four fields, with the MIME taken from the file NAME", async () => {
  const screen = await render(<UploadImageForm />);
  await screen.getByLabelText(/^Name/).fill("linked-list-diagram");
  await screen.getByLabelText(/Content Credentials/).fill("CC BY 4.0");
  // The browser reported no type at all — the extension decides.
  attach(new File([new Uint8Array([1, 2, 3, 4])], "diagram.png", { type: "" }));

  await screen.getByRole("button", { name: "Upload image" }).click();

  await vi.waitFor(() => expect(mocks.uploadImage).toHaveBeenCalledTimes(1));
  const call = mocks.uploadImage.mock.calls[0];
  if (!call) throw new Error("the action was never called");
  const form: FormData = call[0];
  expect([...form.keys()].sort()).toEqual(["credit", "file", "mime", "name"]);
  expect(form.get("name")).toBe("linked-list-diagram");
  expect(form.get("mime")).toBe("image/png");
  expect(form.get("credit")).toBe("CC BY 4.0");
  const file = form.get("file") as File;
  expect(file).toBeInstanceOf(File);
  expect(file.name).toBe("diagram.png");
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("shows a pending label and disables the controls while the action runs", async () => {
  let release: (value: { ok: true; name: string }) => void = () => {};
  mocks.uploadImage.mockReturnValue(
    new Promise<{ ok: true; name: string }>((resolve) => {
      release = resolve;
    }),
  );

  const screen = await render(<UploadImageForm />);
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([new Uint8Array(4)], "diagram.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  const pending = screen.getByRole("button", { name: "Uploading…" });
  await expect.element(pending).toBeVisible();
  await expect.element(pending).toBeDisabled();
  await expect.element(screen.getByLabelText(/^Name/)).toBeDisabled();
  await expect.element(screen.getByLabelText(/Content Credentials/)).toBeDisabled();

  release({ ok: true, name: "diagram" });
  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/images"));
});

test("shows the server's message and keeps what the teacher entered", async () => {
  mocks.uploadImage.mockResolvedValue({
    ok: false,
    error: "An image with that name already exists. Choose another name.",
  });

  const screen = await render(<UploadImageForm />);
  await screen.getByLabelText(/^Name/).fill("diagram");
  await screen.getByLabelText(/Content Credentials/).fill("CC BY 4.0");
  attach(new File([new Uint8Array(4)], "diagram.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await expect
    .element(screen.getByText("An image with that name already exists. Choose another name."))
    .toBeVisible();
  await expect.element(screen.getByLabelText(/^Name/)).toHaveValue("diagram");
  await expect.element(screen.getByLabelText(/Content Credentials/)).toHaveValue("CC BY 4.0");
  expect(mocks.push).not.toHaveBeenCalled();
});

test("a rejected action call shows the network message", async () => {
  mocks.uploadImage.mockRejectedValue(new Error("Failed to fetch"));

  const screen = await render(<UploadImageForm />);
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([new Uint8Array(4)], "diagram.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await expect
    .element(screen.getByText("The upload could not be sent. Check your connection and try again."))
    .toBeVisible();
  expect(mocks.push).not.toHaveBeenCalled();
});

test("a successful upload navigates to the images list", async () => {
  const screen = await render(<UploadImageForm />);
  await screen.getByLabelText(/^Name/).fill("diagram");
  attach(new File([new Uint8Array(4)], "diagram.png", { type: "image/png" }));
  await screen.getByRole("button", { name: "Upload image" }).click();

  await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/images"));
});

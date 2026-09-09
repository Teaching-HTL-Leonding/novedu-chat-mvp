"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { PageBody } from "@/components/page-main";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldHint, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { imageMimeFromExtension, isImageMime } from "@/lib/file-name";
import { uploadImage } from "@/lib/images-actions";

// The largest image the upload flow accepts (5 MB) — enforced server-side too, but
// caught here first so a teacher learns before the bytes leave the browser. This
// literal is the CLIENT copy of `MAX_IMAGE_BYTES` in `lib/image-service.ts` (a
// client component may not import that server module); the guard test in
// `lib/image-service.unit.test.ts` fails if the two ever drift.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Upload form: name + a file picker. On submit the file is posted to the
// `uploadImage` SERVER ACTION as `FormData`, which stores the bytes and writes
// the metadata row in one round trip. Name and the chosen file are controlled
// state, and the form submits via `onSubmit` (not a React form `action`) so a
// rejected upload keeps what the teacher entered.
export function UploadImageForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [credit, setCredit] = useState("");
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, startUpload] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const file = fileInputRef.current?.files?.[0] ?? null;
    if (!file) {
      setMessage("Choose an image file to upload.");
      return;
    }
    if (file.size <= 0) {
      setMessage("The image is empty — choose a file with content.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setMessage("The image is too large — the maximum is 5 MB.");
      return;
    }

    // Infer the MIME from the file name (the canonical extension), falling back to
    // the browser-reported type only when it is one we accept.
    const mime = imageMimeFromExtension(file.name) ?? (isImageMime(file.type) ? file.type : null);
    if (!mime) {
      setMessage("Only PNG, JPEG and SVG images are allowed.");
      return;
    }

    startUpload(async () => {
      const formData = new FormData();
      formData.set("file", file, file.name);
      formData.set("name", name);
      formData.set("mime", mime);
      formData.set("credit", credit);

      let result: Awaited<ReturnType<typeof uploadImage>>;
      try {
        result = await uploadImage(formData);
      } catch {
        // The action never rejects on a handled failure, so this is the network
        // (or an aborted request) — the one case with no server message.
        setMessage("The upload could not be sent. Check your connection and try again.");
        return;
      }
      if (!result.ok) {
        setMessage(result.error);
        return;
      }

      router.push("/images");
    });
  }

  return (
    <PageBody>
      <BackLink href="/images">Back to images</BackLink>
      <FieldHint>
        Upload a PNG, JPEG or SVG (max 5 MB); reference the image by its name from your YAML
        content.
      </FieldHint>

      <form className="flex shrink-0 flex-col items-stretch gap-3.5" onSubmit={onSubmit}>
        <div className="flex flex-wrap items-end gap-3.5">
          <Field className="grow basis-72">
            <FieldLabel htmlFor="image-name">
              Name (letters, digits, underscore, hyphen — no spaces)
            </FieldLabel>
            <Input
              id="image-name"
              required
              maxLength={100}
              pattern="[A-Za-z0-9_-]+"
              autoComplete="off"
              placeholder="e.g. linked-list-diagram"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
              disabled={uploading}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="image-file">File</FieldLabel>
            <Input
              id="image-file"
              ref={fileInputRef}
              type="file"
              required
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={(event) => {
                setFileName(event.target.files?.[0]?.name ?? "");
                setMessage(null);
              }}
              disabled={uploading}
            />
          </Field>
        </div>

        <Field className="grow basis-72">
          <FieldLabel htmlFor="image-credit">Content Credentials (optional)</FieldLabel>
          <Input
            id="image-credit"
            maxLength={512}
            autoComplete="off"
            placeholder="e.g. Photo by Jane Doe — CC BY 4.0"
            value={credit}
            onChange={(event) => {
              setCredit(event.target.value);
              setMessage(null);
            }}
            disabled={uploading}
          />
          <FieldHint>
            Shown small below the image — use it to attribute an image you don't own (e.g. CC BY).
          </FieldHint>
        </Field>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={uploading || !fileName}>
            {uploading ? "Uploading…" : "Upload image"}
          </Button>
          {message ? <FieldError>{message}</FieldError> : null}
        </div>
      </form>
    </PageBody>
  );
}

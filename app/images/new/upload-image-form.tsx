"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState, useTransition } from "react";
import { BackLink } from "@/components/back-link";
import { imageMimeFromExtension, isImageMime } from "@/lib/file-name";
import { confirmImageUpload, requestImageUpload } from "@/lib/images-actions";
import styles from "../images.module.css";

// The largest image the upload flow accepts (5 MB) — enforced server-side too, but
// caught here first so a teacher learns before the bytes leave the browser.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Upload form: name + a file picker. On submit the browser PUTs the bytes STRAIGHT
// to Blob Storage with a short-lived create-only SAS (no app route serves image
// bytes), then confirms — at which point the metadata row is written. Name and the
// chosen file are controlled state, and the form submits via `onSubmit` (not a
// React form `action`) so a rejected upload keeps what the teacher entered.
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
      const requested = await requestImageUpload(name, mime, file.size);
      if (!requested.ok) {
        setMessage(requested.error);
        return;
      }

      try {
        const put = await fetch(requested.uploadUrl, {
          method: "PUT",
          headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": mime },
          body: file,
        });
        if (!put.ok) {
          setMessage("The upload did not complete. Try again.");
          return;
        }
      } catch {
        setMessage("The upload could not be sent. Check your connection and try again.");
        return;
      }

      const confirmed = await confirmImageUpload(name, requested.blobPath, mime, credit);
      if (!confirmed.ok) {
        setMessage(confirmed.error);
        return;
      }

      router.push("/images");
    });
  }

  return (
    <div className={styles.container}>
      <BackLink href="/images">Back to images</BackLink>
      <p className={styles.hint}>
        Upload a PNG, JPEG or SVG (max 5 MB). The bytes go straight to storage; reference the image
        by its name from your YAML content.
      </p>

      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.fieldRow}>
          <div className={`${styles.field} ${styles.fieldGrow}`}>
            <label className={styles.label} htmlFor="image-name">
              Name (letters, digits, underscore, hyphen — no spaces)
            </label>
            <input
              id="image-name"
              required
              maxLength={100}
              pattern="[A-Za-z0-9_-]+"
              autoComplete="off"
              className={styles.input}
              placeholder="e.g. linked-list-diagram"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setMessage(null);
              }}
              disabled={uploading}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="image-file">
              File
            </label>
            <input
              id="image-file"
              ref={fileInputRef}
              type="file"
              required
              accept="image/png,image/jpeg,image/svg+xml"
              className={styles.input}
              onChange={(event) => {
                setFileName(event.target.value);
                setMessage(null);
              }}
              disabled={uploading}
            />
          </div>
        </div>

        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label className={styles.label} htmlFor="image-credit">
            Content Credentials (optional)
          </label>
          <input
            id="image-credit"
            maxLength={512}
            autoComplete="off"
            className={styles.input}
            placeholder="e.g. Photo by Jane Doe — CC BY 4.0"
            value={credit}
            onChange={(event) => {
              setCredit(event.target.value);
              setMessage(null);
            }}
            disabled={uploading}
          />
          <p className={styles.hint}>
            Shown small below the image — use it to attribute an image you don't own (e.g. CC BY).
          </p>
        </div>

        <div className={styles.actionsBar}>
          <button type="submit" className={styles.button} disabled={uploading || !fileName}>
            {uploading ? "Uploading…" : "Upload image"}
          </button>
          {message ? <p className={styles.requestError}>{message}</p> : null}
        </div>
      </form>
    </div>
  );
}

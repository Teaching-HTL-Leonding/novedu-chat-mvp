"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "./tutor-code-entry.module.css";
import formStyles from "./validate-tutor/validate-tutor.module.css";

// Accepts a bare tutor code OR a pasted chat URL (`https://host/<code>`) and
// extracts the code — the last non-empty path segment. Lowercased so a code
// retyped from paper in caps still works. Returns undefined for input that
// cannot be a code.
export function extractTutorCode(input: string): string | undefined {
  let candidate = input.trim();
  if (candidate === "") return undefined;
  if (/^https?:\/\//i.test(candidate)) {
    try {
      const segments = new URL(candidate).pathname.split("/").filter(Boolean);
      candidate = segments[segments.length - 1] ?? "";
    } catch {
      return undefined;
    }
  }
  candidate = candidate.toLowerCase();
  return /^[a-z0-9]{10}$/.test(candidate) ? candidate : undefined;
}

// The tutor-code entry form with the user's recently used codes below it
// (loaded server-side by app/page.tsx). Submitting navigates to `/<code>`,
// where the server checks the code — this component validates only the FORMAT
// (instant feedback for typos), never the code's existence.
export function TutorCodeEntry({ recent }: { recent: { code: string; note: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [formatError, setFormatError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = extractTutorCode(value);
    if (!code) {
      setFormatError(true);
      return;
    }
    router.push(`/${code}`);
  }

  return (
    <div className={styles.container}>
      <section className={styles.card}>
        <h1 className={styles.heading}>Enter your tutor code</h1>
        <p className={styles.hint}>
          Your teacher gave you a tutor code (or a link containing one). Enter it here to start
          chatting with your tutor.
        </p>
        <form className={styles.form} onSubmit={submit}>
          <input
            className={`${formStyles.input} ${styles.codeInput}`}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setFormatError(false);
            }}
            placeholder="e.g. a1b2c3d4e5"
            aria-label="Tutor code"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <button type="submit" className={formStyles.button}>
            Open chat
          </button>
        </form>
        {formatError ? (
          <p className={formStyles.requestError}>
            A tutor code is 10 letters/digits — check for typos, or paste the full link.
          </p>
        ) : null}

        {recent.length > 0 ? (
          <div className={styles.recent}>
            <h2 className={styles.recentHeading}>Recently used</h2>
            <ul className={styles.recentList}>
              {recent.map((item) => (
                <li key={item.code}>
                  <Link href={`/${item.code}`} className={styles.recentLink} title={item.code}>
                    {item.note || item.code}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}

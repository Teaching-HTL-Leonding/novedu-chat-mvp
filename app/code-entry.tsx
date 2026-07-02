"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import styles from "./code-entry.module.css";

// Accepts a bare code OR a pasted activity URL (`https://host/<code>`) and
// extracts the code — the last non-empty path segment. Lowercased so a code
// retyped from paper in caps still works. Returns undefined for input that
// cannot be a code. Mirrors CODE_PATTERN (lib/code-store.ts): 1–32 chars of
// [a-z0-9-], so future memorable codes are accepted too.
export function extractCode(input: string): string | undefined {
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
  return /^[a-z0-9-]{1,32}$/.test(candidate) ? candidate : undefined;
}

// The code entry form with the user's recently used codes below it (loaded
// server-side by app/page.tsx). Submitting navigates to `/<code>`, where the
// server checks the code — this component validates only the FORMAT (instant
// feedback for typos), never the code's existence.
export function CodeEntryForm({ recent }: { recent: { code: string; note: string }[] }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [formatError, setFormatError] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    const code = extractCode(value);
    if (!code) {
      setFormatError(true);
      return;
    }
    router.push(`/${code}`);
  }

  return (
    <div className={styles.container}>
      <section className={styles.card}>
        <h1 className={styles.heading}>Enter your code</h1>
        <p className={styles.hint}>
          Your teacher gave you a code (or a link containing one). Enter it here to start.
        </p>
        <form className={styles.form} onSubmit={submit}>
          <Input
            className={cn("min-w-0 flex-1 font-mono", styles.codeInput)}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setFormatError(false);
            }}
            placeholder="e.g. a1b2c3d4e5"
            aria-label="Code"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
          />
          <Button type="submit">Open</Button>
        </form>
        {formatError ? (
          <p className="text-destructive">
            A code is up to 32 letters/digits/hyphens — check for typos, or paste the full link.
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

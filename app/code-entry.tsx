"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <div className="flex flex-1 items-start justify-center px-5 py-12">
      <section className="w-full max-w-xl rounded-xl border border-foreground/15 bg-foreground/5 px-7 py-6">
        <h1 className="mb-3 font-bold text-lg">Enter your code</h1>
        <p className="mb-4 text-foreground/70">
          Your teacher gave you a code (or a link containing one). Enter it here to start.
        </p>
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            className="min-w-0 flex-1 font-mono tracking-wider"
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
          <div className="mt-6 border-foreground/15 border-t pt-4">
            <h2 className="mb-2 font-semibold text-foreground/60 text-sm uppercase tracking-wide">
              Recently used
            </h2>
            <ul className="flex flex-col gap-1">
              {recent.map((item) => (
                <li key={item.code}>
                  <Link
                    href={`/${item.code}`}
                    className="block overflow-hidden text-ellipsis whitespace-nowrap rounded-lg px-2.5 py-2 hover:bg-foreground/5"
                    title={item.code}
                  >
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

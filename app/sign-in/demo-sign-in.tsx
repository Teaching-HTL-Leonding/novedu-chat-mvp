"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { DEMO_PASSWORD, DEMO_PERSONAS } from "@/lib/demo-personas";

// A demo build's sign-in (docs/auth.md, "Demo mode"): one button per demo persona,
// each signing in with the public demo password. Loaded only by `await import()` in
// the sign-in page's demo branch, so an Entra build carries no client reference to
// it. `callbackURL` is already validated as an app-relative path by the page.
export function DemoSignIn({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // As in SignInButton: a failure RESOLVES with `{ error }` on a non-2xx and
  // rejects on a network error. Both re-enable the buttons and show one line.
  function failure() {
    setPending(null);
    setFailed(true);
  }

  return (
    <>
      <ul className="flex flex-col gap-2">
        {DEMO_PERSONAS.map((persona) => (
          <li key={persona.id}>
            <Button
              variant="outline"
              className="w-full"
              disabled={pending !== null}
              onClick={() => {
                setPending(persona.id);
                setFailed(false);
                authClient.signIn
                  .email({ email: persona.email, password: DEMO_PASSWORD, callbackURL })
                  .then((result) => {
                    if (result.error) failure();
                  })
                  .catch(failure);
              }}
            >
              {pending === persona.id
                ? "Signing in…"
                : `${persona.name} · ${persona.role === "teacher" ? "Teacher" : "Student"}`}
            </Button>
          </li>
        ))}
      </ul>
      {failed && (
        <p className="mt-2 font-semibold text-destructive">Sign-in failed. Please try again.</p>
      )}
    </>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

// Starts the Entra redirect. `callbackURL` is where better-auth sends the browser
// after the callback completes; the server component already validated that it is
// an app-relative path. A failure inside the round trip comes back to
// `/sign-in?error=1`, which renders the generic error line.
export function SignInButton({ callbackURL }: { callbackURL: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  // The success path navigates away, so anything that lands here is a failure to
  // even START the redirect. It arrives in two shapes: `signIn.social` RESOLVES
  // with `{ error }` on a non-2xx (better-fetch only throws when configured to),
  // and rejects on a network error. Both must re-enable the button, or it stays
  // stuck on "Signing in…".
  function failure() {
    setPending(false);
    setFailed(true);
  }

  return (
    <>
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          setFailed(false);
          authClient.signIn
            .social({ provider: "microsoft", callbackURL, errorCallbackURL: "/sign-in?error=1" })
            .then((result) => {
              if (result.error) failure();
            })
            .catch(failure);
        }}
      >
        {pending ? "Signing in…" : "Sign in with Microsoft"}
      </Button>
      {failed && (
        <p className="mt-2 font-semibold text-destructive">Sign-in failed. Please try again.</p>
      )}
    </>
  );
}

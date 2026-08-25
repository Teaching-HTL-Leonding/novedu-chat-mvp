"use client";

import { useState, useTransition } from "react";
import { Spinner } from "@/components/spinner";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { mintCodingKeyAction } from "@/lib/coding-key-actions";

// The teacher's explicit "get me a key" control on the coding detail page: the
// page itself only READS the stored key, so this button is the only thing that
// puts the teacher in the code's issued-keys list (docs/coding.md). The
// attribution notice sits beside it, rendered by the server component.
//
// The action returns no key VALUE — it revalidates the detail page, and the
// re-render (delivered with the action's response, inside the transition) swaps
// this button for the connection block. On failure the message is shown inline
// and the button stays, so the teacher can retry; same pending-Spinner +
// FieldError recipe as the shared bulk-action buttons.
export function MintKeyButton({ code }: { code: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      const result = await mintCodingKeyAction(code);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <>
      <Button onClick={onClick} disabled={pending}>
        {pending ? (
          <>
            <Spinner /> Getting your key…
          </>
        ) : (
          "Get my API key"
        )}
      </Button>
      {error ? <FieldError>{error}</FieldError> : null}
    </>
  );
}

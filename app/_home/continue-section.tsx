import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CodeEntryForm } from "../code-entry";
import { HOME_CARD, HOME_CARD_PAD, HOME_MUTED } from "./home-ui";

// Continue — getting back into an activity comes first on every width: a
// greeting, the code field, and (signed in) the Recently used list beside it.
export function ContinueSection({
  givenName,
  recent,
}: {
  /** The signed-in user's given name ("" when unknown); absent when nobody is signed in. */
  givenName?: string;
  /** The Recently used slot (a Suspense boundary); absent when signed out. */
  recent?: ReactNode;
}) {
  const signedIn = givenName !== undefined;
  let heading = "Enter your code";
  if (signedIn) heading = givenName ? `Welcome back, ${givenName}` : "Welcome back";
  return (
    <section
      aria-labelledby="home-continue"
      className={cn(HOME_CARD, recent && "lg:grid lg:grid-cols-12")}
    >
      <div
        className={cn(
          HOME_CARD_PAD,
          "flex flex-col gap-1.5",
          recent && "border-foreground/15 max-lg:border-b lg:col-span-5 lg:border-r",
        )}
      >
        <h1 id="home-continue" className="text-balance font-bold text-2xl tracking-tight">
          {heading}
        </h1>
        <p className={cn(HOME_MUTED, "mb-3")}>
          {signedIn
            ? "Pick up where you left off, or open an activity with its code."
            : "Your teacher gave you a code (or a link containing one). Enter it here to start."}
        </p>
        <CodeEntryForm />
      </div>
      {recent ? <div className="px-4 pt-4 pb-3 md:px-6 lg:col-span-7">{recent}</div> : null}
    </section>
  );
}

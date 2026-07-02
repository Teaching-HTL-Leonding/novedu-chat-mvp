import { CopyableLinkRow } from "./copyable-link-row";

// The shared create/edit-screen result for the link-based modules (tutor, quiz,
// writing): the shareable `/<code>` link with a copy button — the behavior the screen
// has always had. Coding overrides this with its own connection config
// (`CodingResult`). A server component called as a plain function from the module
// registry's `renderResult`, so no JSX lives in the server-only registry.
export function ShareLinkResult({ shareUrl }: { shareUrl: string }) {
  return (
    <section className="flex flex-col gap-2 self-stretch rounded-xl border border-foreground/15 bg-foreground/5 px-4 py-3.5">
      <h2 className="font-bold">Share link</h2>
      <p className="text-foreground/60 text-sm">
        Send this link to your students — the last part of the URL is the code, which they can also
        type on the start page. It only works within the chosen time window.
      </p>
      <CopyableLinkRow link={shareUrl} label="Share link" />
    </section>
  );
}

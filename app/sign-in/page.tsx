import { CENTERED_CARD, CENTERED_CARD_HEADING, CENTERED_CARD_WRAPPER } from "@/components/notice";
import { Main } from "@/components/page-main";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { SignInButton } from "./sign-in-button";

// The app's only public page besides the teacher guide: the proxy redirects every
// unauthenticated request here with the path it wanted as `callbackURL`.
//
// It renders WITHOUT the app chrome (components/app-chrome.tsx), so it carries
// the product name itself and centres its card in the full viewport.

/**
 * Only an app-relative path may be handed back to the OAuth callback — an
 * absolute URL would turn the sign-in into an open redirect. A second `/` or `\`
 * makes the value protocol-relative in a browser (`//evil.com`, `/\evil.com`),
 * so both are rejected alongside anything that does not start with `/`.
 */
function safeCallbackURL(value: string | string[] | undefined): string {
  if (typeof value !== "string") return "/";
  if (!value.startsWith("/")) return "/";
  if (value[1] === "/" || value[1] === "\\") return "/";
  return value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const callbackURL = safeCallbackURL(params.callbackURL);

  return (
    <Main>
      {/* The shared centred-card recipe, vertically centred: with no status bar
          above it the card would otherwise sit alone at the top of the page. */}
      <section className={cn(CENTERED_CARD_WRAPPER, "items-center")}>
        <div className={CENTERED_CARD}>
          <p className="mb-1 font-semibold text-foreground/55 text-sm">{BRAND}</p>
          <h2 className={CENTERED_CARD_HEADING}>Sign in</h2>
          <div className="flex flex-col gap-2">
            <p className="text-foreground/70">Novedu uses your school Microsoft account.</p>
            {params.error !== undefined && (
              <p className="font-semibold text-destructive">
                Signing in did not complete. Please try again.
              </p>
            )}
            <div className="mt-2">
              <SignInButton callbackURL={callbackURL} />
            </div>
          </div>
        </div>
      </section>
    </Main>
  );
}

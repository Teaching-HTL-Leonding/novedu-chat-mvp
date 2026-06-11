import { Notice } from "@/components/notice";
import { resolveShortCode, selectShareSource } from "@/lib/share-link-store";
import { getShareLinkSecret, type ShareLinkVerification, verifyShareLink } from "@/lib/share-links";
import { defaultFetcher, loadAndBuildTutorPrompt } from "@/lib/tutors";
import styles from "./page.module.css";
import { ShareLinkError, type ShareLinkErrorInfo } from "./share-link-error";
import { TutorChat } from "./tutor-chat";
import { ErrorList, WarningList } from "./validate-tutor/result-views";

// The chat is reachable ONLY through a signed share link created by a teacher
// (`/?tutor=...&start=...&end=...&sig=...`) or its stored short form
// (`/?link=<code>`, resolved from the share-link table). This is a server
// component on purpose: the signature, the availability window, and the tutor
// YAML are all verified server-side, so nothing the browser does can skip the
// checks. (The CopilotKit runtime route re-verifies the same parameters on
// every chat request — this page only decides what to render.)
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const single = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const raw = {
    tutor: single(params.tutor),
    start: single(params.start),
    end: single(params.end),
    sig: single(params.sig),
    link: single(params.link),
  };

  // The full signed parameter set wins over a short code (no storage
  // round-trip needed). A resolved code feeds the SAME verification as a full
  // link, so the signature and window checks always apply.
  let verification: ShareLinkVerification | ShareLinkErrorInfo;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (selectShareSource(raw) === "code" && raw.link) {
    const resolved = await resolveShortCode(raw.link);
    verification = resolved.ok
      ? verifyShareLink(
          {
            tutor: resolved.link.tutor,
            start: String(resolved.link.start),
            end: String(resolved.link.end),
            sig: resolved.link.sig,
          },
          getShareLinkSecret(),
          nowSeconds,
        )
      : { ok: false, reason: resolved.reason };
  } else {
    verification = verifyShareLink(raw, getShareLinkSecret(), nowSeconds);
  }

  if (!verification.ok) {
    return (
      <main className={styles.main}>
        <ShareLinkError verification={verification} />
      </main>
    );
  }

  // The link is genuine and within its window — now the tutor itself must be
  // valid. (Deliberately uncached for this early preview: one fetch chain per
  // page load keeps edits to the tutor YAML visible immediately.)
  const result = await loadAndBuildTutorPrompt(verification.tutor, defaultFetcher);
  if (!result.ok) {
    return (
      <main className={styles.main}>
        <Notice heading="This tutor cannot be loaded">
          <p>
            The tutor behind this share link failed validation. Ask your teacher to check the tutor
            definition.
          </p>
        </Notice>
        <div className={styles.validationErrors}>
          {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
          <ErrorList errors={result.errors} />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <TutorChat
        tutorUrl={verification.tutor}
        runtimeHeaders={{
          "x-tutor-url": verification.tutor,
          "x-share-start": String(verification.start),
          "x-share-end": String(verification.end),
          "x-share-sig": verification.sig,
        }}
        prompt={result.prompt}
        warnings={result.warnings}
        imageInput={result.imageInput}
      />
    </main>
  );
}

import { Main, PageBody } from "@/components/page-main";
import { ATTRIBUTION_NOTICE } from "@/components/ui/attribution-notice";
import { resolveAppOriginOr } from "@/lib/app-origin";
import type { CodeEntry } from "@/lib/code-store";
import { codingConnectionProps, loadCoding } from "@/lib/coding-fetch";
import { getOrCreateCodingKey } from "@/lib/coding-key-store";
import { CodingConnection } from "./_coding/coding-connection";
import { KeyUnavailableNotice } from "./_coding/key-unavailable-notice";

// The coding module's STUDENT render: a connection page. There is no in-app chat —
// the student drives an external OpenAI-compatible coding agent (e.g. little-coder)
// against the public /api/coding/v1 endpoint, using a personal `nvk-…` key minted
// (or re-displayed, stable across visits) by `getOrCreateCodingKey`. This page just
// shows how to connect. The teacher's system prompt and the real model are NEVER
// sent here (the proxy applies them server-side); only the student-facing `title`
// is read from the YAML. Invoked by the module switch in app/[code]/page.tsx, which
// always passes the session's real oid (no student-mode substitution here).
export async function RenderCoding({
  entry,
  code,
  userId,
}: {
  entry: CodeEntry;
  code: string;
  userId: string;
}) {
  // Independent I/O — the YAML load, origin resolution, and key mint/lookup
  // share no data, so they overlap instead of paying three round trips in a row.
  const [loaded, origin, key] = await Promise.all([
    loadCoding(entry.fileUrl),
    resolveAppOriginOr(""),
    getOrCreateCodingKey(code, userId),
  ]);
  const title = loaded.ok ? loaded.coding.title : undefined;

  return (
    <Main>
      <PageBody className="block pt-6 pb-8">
        <section className="mx-auto w-full max-w-3xl">
          <h1 className="mb-3 font-bold text-2xl">{title ?? "Coding endpoint"}</h1>
          {key ? (
            <div className="flex flex-col gap-4">
              {/* MANDATORY, visually prominent: key issuance is attributed (the
                  second sanctioned user↔code link, alongside reports). */}
              <p className={ATTRIBUTION_NOTICE}>
                Requesting this activity&apos;s API key is recorded with your name for your teacher.
                Your coding conversations are not stored.
              </p>
              <CodingConnection {...codingConnectionProps(loaded, origin, key.apiKey)} />
            </div>
          ) : (
            <KeyUnavailableNotice />
          )}
        </section>
      </PageBody>
    </Main>
  );
}

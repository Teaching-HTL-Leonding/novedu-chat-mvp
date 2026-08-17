import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { Main, PageBody } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { codeModules } from "@/lib/code-modules/registry";
import { getCode } from "@/lib/code-store";

// Teacher-only detail page for ONE code — a thin dispatcher. It gates (any
// effective teacher may view any code; finer-grained RBAC is planned), loads the
// code, renders the shared chrome (back-link + which code this is), then hands off
// to the module's own `renderDetail`: tutor/quiz show conversation stats, writing
// shows its savers list. Server component.
export default async function CodeStatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { code } = await params;

  const denied = await requireTeacherPage();
  if (denied) return denied;

  const entry = await getCode(code);

  if (entry === undefined) {
    return (
      <Main>
        <Notice heading="Stats temporarily unavailable">
          <p>These stats could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </Main>
    );
  }
  if (entry === null) {
    return (
      <Main>
        <Notice heading="Code not found">
          <p>
            This code does not exist. <Link href="/codes">Back to codes</Link>.
          </p>
        </Notice>
      </Main>
    );
  }

  const body = await codeModules[entry.module].renderDetail(entry, await searchParams);

  return (
    <Main>
      <PageBody className="block">
        <BackLink href="/codes">Back to codes</BackLink>

        {/* The page title lives in the status bar ("Code Stats"); this is just
            context — which code this detail belongs to. */}
        <p className="mb-5 text-foreground/70 text-sm" title={entry.fileUrl}>
          {entry.note ? `${entry.note} · ` : null}
          <code className="rounded-sm bg-foreground/10 px-1.5 py-px text-[0.85em]">
            {entry.code}
          </code>
        </p>

        {/* Module-agnostic: a code with an LLM override serves its requests with
            this pair instead of the activity YAML's llm values (editable on the
            code's edit page). */}
        {entry.llm ? (
          <p className="mb-5 text-foreground/70 text-sm">
            LLM override: <code className="text-[0.85em]">{entry.llm.provider}</code> ·{" "}
            <code className="text-[0.85em]">{entry.llm.model}</code>
            {entry.llm.reasoning ? (
              <>
                {" · reasoning "}
                <code className="text-[0.85em]">{entry.llm.reasoning}</code>
              </>
            ) : null}
          </p>
        ) : null}

        {body}
      </PageBody>
    </Main>
  );
}

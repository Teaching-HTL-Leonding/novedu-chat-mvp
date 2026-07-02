import Link from "next/link";
import { BackLink } from "@/components/back-link";
import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { codeModules } from "@/lib/code-modules/registry";
import { getCode } from "@/lib/code-store";
import styles from "./stats.module.css";

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
      <div className={styles.container}>
        <BackLink href="/codes">Back to codes</BackLink>

        {/* The page title lives in the status bar ("Code Stats"); this is just
            context — which code this detail belongs to. */}
        <p className={styles.subhead} title={entry.fileUrl}>
          {entry.note ? `${entry.note} · ` : null}
          <code className={styles.code}>{entry.code}</code>
        </p>

        {body}
      </div>
    </Main>
  );
}

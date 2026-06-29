import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { renderCodeResult } from "@/lib/code-modules/registry";
import { getCode } from "@/lib/code-store";
import pageStyles from "../../../page.module.css";
import { CodeForm } from "../../code-form";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only: edit a code's note and availability window. The module + file URL
// are frozen (shown read-only). Any effective teacher may edit any code (RBAC
// planned) — the lookup is `getCode`, not the owner-gated one; the server action
// re-checks. The page resolves the shareable URL for the copy row.
export default async function EditCodePage({ params }: { params: Promise<{ code: string }> }) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const { code } = await params;
  const entry = await getCode(code);

  if (entry === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Code temporarily unavailable">
          <p>This code could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  if (entry === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Code not found">
          <p>This code does not exist or has been deleted.</p>
        </Notice>
      </main>
    );
  }

  const origin = await resolveAppOriginOr("");
  const shareUrl = origin ? `${origin}/${entry.code}` : `/${entry.code}`;
  // Per-module result body (the link-based modules show the share link; coding shows
  // its little-coder config). Rendered server-side and handed to the client form as a
  // slot, so the client never touches the server-only registry.
  const resultSlot = await renderCodeResult(entry, { shareUrl, origin });

  return (
    <main className={pageStyles.main}>
      <CodeForm
        mode="edit"
        code={entry.code}
        initialModule={entry.module}
        initialFileUrl={entry.fileUrl}
        initialNote={entry.note}
        initialStartSeconds={entry.validFrom ? seconds(entry.validFrom) : undefined}
        initialEndSeconds={entry.validUntil ? seconds(entry.validUntil) : undefined}
        resultSlot={resultSlot}
      />
    </main>
  );
}

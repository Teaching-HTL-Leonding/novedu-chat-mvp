import { Notice } from "@/components/notice";
import { requireTeacherPage } from "@/components/require-teacher-page";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { getTutorCode } from "@/lib/tutor-code-store";
import pageStyles from "../../../page.module.css";
import { TutorCodeForm } from "../../tutor-code-form";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Teacher-only: edit a Tutor Code's note and availability window. The tutor URL
// is frozen (shown read-only). Any effective teacher may edit any code (RBAC
// planned) — the lookup is `getTutorCode`, not the owner-gated one; the server
// action re-checks. The page resolves the shareable chat URL for the copy row.
export default async function EditTutorCodePage({ params }: { params: Promise<{ code: string }> }) {
  const denied = await requireTeacherPage();
  if (denied) return denied;

  const { code } = await params;
  const entry = await getTutorCode(code);

  if (entry === undefined) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Tutor code temporarily unavailable">
          <p>This tutor code could not be loaded right now. Try again in a moment.</p>
        </Notice>
      </main>
    );
  }
  if (entry === null) {
    return (
      <main className={pageStyles.main}>
        <Notice heading="Tutor code not found">
          <p>This tutor code does not exist or has been deleted.</p>
        </Notice>
      </main>
    );
  }

  const origin = await resolveAppOriginOr("");

  return (
    <main className={pageStyles.main}>
      <TutorCodeForm
        mode="edit"
        code={entry.code}
        initialTutorUrl={entry.tutorUrl}
        initialNote={entry.note}
        initialStartSeconds={seconds(entry.validFrom)}
        initialEndSeconds={seconds(entry.validUntil)}
        shareUrl={origin ? `${origin}/${entry.code}` : `/${entry.code}`}
      />
    </main>
  );
}

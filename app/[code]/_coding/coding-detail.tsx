import { auth } from "@/auth";
import { type ListColumn, ListTable } from "@/components/data-list";
import { Notice } from "@/components/notice";
import { studentColumn } from "@/components/student-column";
import { ATTRIBUTION_NOTICE } from "@/components/ui/attribution-notice";
import { META_LABEL } from "@/components/ui/meta-label";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { type CodeEntry, effectiveLlm } from "@/lib/code-store";
import { codingConnectionProps, loadCoding } from "@/lib/coding-fetch";
import {
  type CodingKeyIssuance,
  getStoredCodingKey,
  listCodingKeys,
  type StoredCodingKey,
} from "@/lib/coding-key-store";
import { LocalTime } from "../../local-time";
import { CODE_PANEL } from "./code-panel";
import { CodingConnection } from "./coding-connection";
import { KeyUnavailableNotice } from "./key-unavailable-notice";
import { MintKeyButton } from "./mint-key-button";

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// The coding module's teacher detail body on /codes/[code]: the resolved config
// (pinned model + the server-only system prompt, teacher-only), the teacher's OWN
// connection block once they hold a personal key (so they can test the endpoint
// end-to-end), and the read-only issued-keys list (who requested a key, and when).
// There are no per-student conversations (coding conversations are never stored),
// so unlike tutor/quiz this is config + connection + issuance, not stats. That
// list is an EMBEDDED table inside the detail page's own body, so it renders
// through the bare <ListTable> — the same shape ConversationStats uses for
// tutor/quiz — keeping the list pages' recipes.
//
// The key read is deliberately READ-ONLY (`getStoredCodingKey`): viewing a code
// must not attribute a key row to the teacher, so with no key stored the page
// offers the explicit "Get my API key" button (its action mints — see
// lib/coding-key-actions.ts) beside the same attribution notice the student page
// carries. A database failure is its own state and shows the unavailable notice,
// so the button is never offered when the answer "you have no key" is unproven.
//
// SERVER COMPONENT: reads the coding YAML via `loadCoding`, the session via
// `auth()`, and the key store. The descriptor calls it as a plain function so no
// JSX lives in the server-only registry .ts file. The page mounting this already
// gates on `requireTeacherPage()`, which uses the effective-teacher discipline.
export async function CodingDetail({ entry }: { entry: CodeEntry }) {
  // Independent I/O — the YAML load, origin resolution, and the session/key arm
  // share no data, so they overlap instead of paying the round trips in a row.
  const [loaded, origin, { stored, issuances }] = await Promise.all([
    loadCoding(entry.fileUrl),
    resolveAppOriginOr(""),
    (async () => {
      const teacherId = (await auth())?.user?.id;
      // Both reads now (nothing is written here), so they overlap too. A session
      // with no oid can hold no key and cannot be attributed one either — the same
      // "unavailable" state as a failed read.
      const [stored, issuances] = await Promise.all([
        teacherId
          ? getStoredCodingKey(entry.code, teacherId)
          : Promise.resolve<StoredCodingKey>({ status: "error" }),
        listCodingKeys(entry.code),
      ]);
      return { stored, issuances };
    })(),
  ]);
  // The EFFECTIVE llm — what the proxy actually pins: the code's LLM override
  // when set, the YAML's values otherwise.
  const llm = loaded.ok ? effectiveLlm(entry, loaded.coding) : undefined;

  const columns: ListColumn<CodingKeyIssuance>[] = [
    // "User", not "Student": a teacher who mints their own key to test the
    // endpoint appears in this list too.
    studentColumn<CodingKeyIssuance>("User"),
    {
      header: "Requested",
      kind: "time",
      render: (row) => <LocalTime seconds={seconds(row.createdAt)} />,
    },
  ];

  return (
    <>
      {loaded.ok ? (
        <>
          <div className="mb-6">
            <p className={`mb-1.5 ${META_LABEL}`}>Model (pinned)</p>
            <p>
              <code>{llm?.model}</code>
              {llm?.reasoning ? (
                <>
                  {" · reasoning "}
                  <code>{llm.reasoning}</code>
                </>
              ) : null}
              {entry.llm ? (
                <span className="text-foreground/70 text-sm"> (overridden by this code)</span>
              ) : null}
            </p>
          </div>
          <div className="mb-6">
            <p className={`mb-1.5 ${META_LABEL}`}>System prompt</p>
            <pre
              className={`${CODE_PANEL} wrap-anywhere max-h-72 overflow-auto whitespace-pre-wrap`}
            >
              {loaded.coding.instructions}
            </pre>
          </div>
        </>
      ) : (
        <div className="mb-6">
          <Notice heading="This coding activity could not be loaded">
            <p>{loaded.message}</p>
          </Notice>
        </div>
      )}

      <div className="mb-6">
        <p className={`mb-1.5 ${META_LABEL}`}>Your connection details</p>
        {stored.status === "found" ? (
          <CodingConnection {...codingConnectionProps(loaded, origin, stored.key.apiKey)} />
        ) : stored.status === "none" ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-foreground/70">
              You have no key for this activity yet. Get one to point your own coding tool at this
              endpoint and try it exactly as a student would.
            </p>
            {/* MANDATORY, visually prominent: minting attributes the key to you,
                just as it does for a student (docs/coding.md). */}
            <p className={ATTRIBUTION_NOTICE}>
              Requesting a key records your name in this activity&apos;s issued-keys list below.
              Coding conversations are not stored.
            </p>
            <MintKeyButton code={entry.code} />
          </div>
        ) : (
          <KeyUnavailableNotice />
        )}
      </div>

      <div>
        <p className={`mb-1.5 ${META_LABEL}`}>Issued keys</p>
        {issuances.length === 0 ? (
          <p className="text-foreground/70">No keys requested yet.</p>
        ) : (
          <ListTable rows={issuances} getRowKey={(row) => row.userId} columns={columns} />
        )}
      </div>
    </>
  );
}

import { Notice } from "@/components/notice";
import { META_LABEL } from "@/components/ui/meta-label";
import { resolveAppOriginOr } from "@/lib/app-origin";
import { type CodeEntry, effectiveLlm } from "@/lib/code-store";
import { codingConnectionProps, loadCoding } from "@/lib/coding-fetch";
import { CODE_PANEL } from "./code-panel";
import { CodingConnection } from "./coding-connection";

// The coding module's teacher detail body on /codes/[code]: the resolved config
// (pinned model + the server-only system prompt, teacher-only) and the connection
// details to hand to students. There are no per-student conversations (the API path
// is anonymous), so unlike tutor/quiz this is config + connection, not stats.
//
// SERVER COMPONENT: reads the coding YAML via `loadCoding`. The descriptor calls it
// as a plain function so no JSX lives in the server-only registry .ts file.
export async function CodingDetail({ entry }: { entry: CodeEntry }) {
  const loaded = await loadCoding(entry.fileUrl);
  const origin = await resolveAppOriginOr("");
  // The EFFECTIVE llm — what the proxy actually pins: the code's LLM override
  // when set, the YAML's values otherwise.
  const llm = loaded.ok ? effectiveLlm(entry, loaded.coding) : undefined;

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
        <p className={`mb-1.5 ${META_LABEL}`}>Connection details</p>
        <CodingConnection {...codingConnectionProps(loaded, origin, entry.code)} />
      </div>
    </>
  );
}

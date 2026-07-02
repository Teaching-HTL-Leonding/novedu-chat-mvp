import { Notice } from "@/components/notice";
import { Main } from "@/components/page-main";
import { ErrorList, WarningList } from "@/components/validation-result";
import type { CodeEntry } from "@/lib/code-store";
import { buildRuntimeHeaders } from "@/lib/runtime-headers";
import { defaultFetcher, loadAndBuildTutorPrompt, sampleExampleQuestions } from "@/lib/tutors";
import { TutorChat } from "../tutor-chat";

// The tutor module's student render: load + build the tutor prompt from the
// code's file_url (deliberately uncached so YAML edits show immediately), then
// render the chat. A build failure shows the validation errors. Invoked by the
// thin module switch in app/[code]/page.tsx.
export async function RenderTutor({
  entry,
  code,
  threadId,
  threadToken,
}: {
  entry: CodeEntry;
  code: string;
  threadId: string;
  threadToken: string;
}) {
  const result = await loadAndBuildTutorPrompt(entry.fileUrl, defaultFetcher);
  if (!result.ok) {
    return (
      <Main>
        <Notice heading="This tutor cannot be loaded">
          <p>
            The tutor behind this code failed validation. Ask your teacher to check the tutor
            definition.
          </p>
        </Notice>
        <div className="shrink-0 overflow-y-auto px-5 pb-5">
          {result.warnings.length > 0 ? <WarningList warnings={result.warnings} /> : null}
          <ErrorList errors={result.errors} />
        </div>
      </Main>
    );
  }

  return (
    <Main>
      <TutorChat
        code={code}
        threadId={threadId}
        tutorUrl={entry.fileUrl}
        // The runtime re-checks both headers server-side on every request — the
        // code gates access, the token proves the thread belongs to this user.
        runtimeHeaders={buildRuntimeHeaders(code, threadToken)}
        prompt={result.prompt}
        warnings={result.warnings}
        imageInput={result.imageInput}
        title={result.title}
        description={result.description}
        exampleQuestions={sampleExampleQuestions(result.exampleQuestions)}
      />
    </Main>
  );
}

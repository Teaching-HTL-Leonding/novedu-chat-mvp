"use client";

import { CopyIconButton } from "@/components/copy-icon-button";
import { FieldHint } from "@/components/ui/field";
import { META_LABEL } from "@/components/ui/meta-label";
import { buildLittleCoderConfig } from "@/lib/little-coder-config";

// The coding module's mono code panel, shared with the teacher detail
// (coding-detail.tsx).
export const CODE_PANEL =
  "overflow-x-auto rounded-lg border border-foreground/15 bg-foreground/5 px-3.5 py-3 text-sm leading-normal";

const FIELD_CODE = "wrap-anywhere text-sm";

// Connection details for an OpenAI-compatible coding agent (e.g. little-coder):
// the base URL, the code-as-API-key, the model id, a ready-to-paste
// little-coder `models.json` snippet, and a run command — each with a copy button.
// Shared by the student page (render-coding) and the teacher detail (coding-detail).
//
// Receives ONLY non-secret values: the code (which the student already holds), the
// app origin, and a generic model id. The teacher's system prompt and the real SCCH
// model never reach this client component — the proxy pins the model server-side and
// ignores whatever the client sends.
export function CodingConnection({
  baseUrl,
  apiKey,
  modelId,
  modelName,
}: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
}) {
  const modelRef = `novedu/${modelId}`;
  const modelsJson = buildLittleCoderConfig({ baseUrl, apiKey, modelId, modelName });
  const runCommand = `little-coder --model ${modelRef} -p "Write a Python program that ..."`;

  return (
    <section className="flex flex-col gap-5">
      <p className="text-foreground/70">
        Use this with an OpenAI-compatible coding agent such as{" "}
        <a href="https://github.com/itayinbarr/little-coder" target="_blank" rel="noreferrer">
          little-coder
        </a>
        . Point it at the endpoint below and use the code as the API key.
      </p>

      <dl className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <dt className={`w-24 shrink-0 ${META_LABEL}`}>Base URL</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-1.5">
            <code className={FIELD_CODE}>{baseUrl}</code>
            <CopyIconButton text={baseUrl} label="Copy base URL" />
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className={`w-24 shrink-0 ${META_LABEL}`}>API key</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-1.5">
            <code className={FIELD_CODE}>{apiKey}</code>
            <CopyIconButton text={apiKey} label="Copy API key" />
          </dd>
        </div>
        <div className="flex items-center gap-3">
          <dt className={`w-24 shrink-0 ${META_LABEL}`}>Model</dt>
          <dd className="flex min-w-0 flex-1 items-center gap-1.5">
            <code className={FIELD_CODE}>{modelRef}</code>
            <CopyIconButton text={modelRef} label="Copy model" />
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm">
            little-coder <code>models.json</code>
          </span>
          <CopyIconButton text={modelsJson} label="Copy models.json" />
        </div>
        <FieldHint>
          Save to <code>~/.config/little-coder/models.json</code>. See{" "}
          <a
            href="https://github.com/itayinbarr/little-coder#configuring-models"
            target="_blank"
            rel="noreferrer"
          >
            configuring models
          </a>{" "}
          for more detail.
        </FieldHint>
        <pre className={CODE_PANEL}>
          <code>{modelsJson}</code>
        </pre>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-sm">Run</span>
          <CopyIconButton text={runCommand} label="Copy command" />
        </div>
        <pre className={CODE_PANEL}>
          <code>{runCommand}</code>
        </pre>
      </div>
    </section>
  );
}

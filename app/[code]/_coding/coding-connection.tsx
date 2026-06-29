"use client";

import { CopyIconButton } from "@/components/copy-icon-button";
import { buildLittleCoderConfig } from "@/lib/little-coder-config";
import styles from "./coding.module.css";

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
    <section className={styles.connection}>
      <p className={styles.intro}>
        Use this with an OpenAI-compatible coding agent such as{" "}
        <a href="https://github.com/itayinbarr/little-coder" target="_blank" rel="noreferrer">
          little-coder
        </a>
        . Point it at the endpoint below and use the code as the API key.
      </p>

      <dl className={styles.fields}>
        <div className={styles.field}>
          <dt className={styles.fieldLabel}>Base URL</dt>
          <dd className={styles.fieldValue}>
            <code>{baseUrl}</code>
            <CopyIconButton text={baseUrl} label="Copy base URL" className={styles.iconButton} />
          </dd>
        </div>
        <div className={styles.field}>
          <dt className={styles.fieldLabel}>API key</dt>
          <dd className={styles.fieldValue}>
            <code>{apiKey}</code>
            <CopyIconButton text={apiKey} label="Copy API key" className={styles.iconButton} />
          </dd>
        </div>
        <div className={styles.field}>
          <dt className={styles.fieldLabel}>Model</dt>
          <dd className={styles.fieldValue}>
            <code>{modelRef}</code>
            <CopyIconButton text={modelRef} label="Copy model" className={styles.iconButton} />
          </dd>
        </div>
      </dl>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <span className={styles.blockTitle}>
            little-coder <code>models.json</code>
          </span>
          <CopyIconButton
            text={modelsJson}
            label="Copy models.json"
            className={styles.iconButton}
          />
        </div>
        <p className={styles.hint}>
          Save to <code>~/.config/little-coder/models.json</code>. See{" "}
          <a
            href="https://github.com/itayinbarr/little-coder#configuring-models"
            target="_blank"
            rel="noreferrer"
          >
            configuring models
          </a>{" "}
          for more detail.
        </p>
        <pre className={styles.pre}>
          <code>{modelsJson}</code>
        </pre>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <span className={styles.blockTitle}>Run</span>
          <CopyIconButton text={runCommand} label="Copy command" className={styles.iconButton} />
        </div>
        <pre className={styles.pre}>
          <code>{runCommand}</code>
        </pre>
      </div>
    </section>
  );
}

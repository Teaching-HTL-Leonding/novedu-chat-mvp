"use client";

import { CopyIconButton } from "@/components/copy-icon-button";
import type { CodeModule } from "@/lib/code-modules/types";
import { CODING_MODEL_ID, codingBaseUrl, DEFAULT_CODING_MODEL_NAME } from "@/lib/coding-connection";
import { buildLittleCoderConfig } from "@/lib/little-coder-config";
import styles from "./codes.module.css";

// The per-row copy affordance on the /codes list. What it copies depends on the
// module: a `coding` code is an API key (not a web link), so it copies the
// ready-to-paste little-coder config (`models.json`) — the same artifact the
// connection block shows; every other module copies the `/<code>` share link. Both
// values are built in the browser from window.location.origin (via the getter form),
// so they always match wherever the teacher is currently working.
export function CopyCodeButton({ code, module }: { code: string; module: CodeModule }) {
  if (module === "coding") {
    return (
      <CopyIconButton
        text={() =>
          buildLittleCoderConfig({
            baseUrl: codingBaseUrl(window.location.origin),
            apiKey: code,
            modelId: CODING_MODEL_ID,
            modelName: DEFAULT_CODING_MODEL_NAME,
          })
        }
        label="Copy little-coder config"
        className={styles.iconButton}
        promptLabel="Copy the little-coder config:"
      />
    );
  }

  return (
    <CopyIconButton
      text={() => `${window.location.origin}/${code}`}
      label="Copy link"
      className={styles.iconButton}
      promptLabel="Copy the chat link:"
    />
  );
}

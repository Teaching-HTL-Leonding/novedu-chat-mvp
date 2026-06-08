"use client";

import { CopilotChat } from "@copilotkit/react-core/v2";
import { useEffect, useState } from "react";
import styles from "./page.module.css";

interface ModelOption {
  id: string;
  label: string;
}

export function ModelChat() {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [selected, setSelected] = useState<string>("");

  // Load the SCCH model list (proxied — no key in the browser) and default to
  // the first one.
  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json() as Promise<ModelOption[]>)
      .then((list) => {
        setModels(list);
        setSelected((prev) => prev || list[0]?.id || "");
      })
      .catch(() => setModels([]));
  }, []);

  return (
    <>
      <div className={styles.toolbar}>
        <label htmlFor="model" className={styles.toolbarLabel}>
          Model
        </label>
        <select
          id="model"
          className={styles.modelSelect}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          disabled={models.length === 0}
        >
          {models.length === 0 ? (
            <option value="">No models available</option>
          ) : (
            models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))
          )}
        </select>
      </div>
      <div className={styles.chat}>
        {selected ? (
          // `key` remounts the chat when the model changes, starting a fresh
          // conversation against the newly selected agent.
          <CopilotChat key={selected} agentId={selected} />
        ) : null}
      </div>
    </>
  );
}

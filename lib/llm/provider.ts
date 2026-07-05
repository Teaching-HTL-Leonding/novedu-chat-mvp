import { z } from "zod";

// The SINGLE definition of the app's LLM providers. Every other module — the four
// activity schemas, the lenient runtime parsers, the two resolvers in this folder,
// and the usage exporter — imports these literals from here; the provider names
// never appear as string literals anywhere else. Pure and client-safe (no I/O, no
// server-only imports), so the studio GUI may import it later.

export type LlmProvider = "SCCH" | "Azure Foundry";

export const DEFAULT_PROVIDER: LlmProvider = "SCCH";

// The `llm.provider` field of every activity YAML: optional, defaulting to SCCH,
// so all existing YAML keeps its meaning without migration.
export const providerSchema = z.enum(["SCCH", "Azure Foundry"]).default(DEFAULT_PROVIDER);

// ai-sdk provider names, passed as `createOpenAI({ name })`. They are the METERING
// contract: Mastra stamps `<name>.chat` as `attributes.provider` on every
// MODEL_GENERATION span, and the usage exporter maps it back via
// `providerFromModelProviderId`. Renaming one silently breaks that attribution.
export const SCCH_PROVIDER_NAME = "scch";
export const FOUNDRY_PROVIDER_NAME = "azure-foundry";

// Maps an ai-sdk model's `provider` id (e.g. "scch.chat") back to the LlmProvider
// it was created from; `undefined` for anything this app didn't name.
export function providerFromModelProviderId(id: string | undefined): LlmProvider | undefined {
  const name = id?.split(".")[0];
  if (name === SCCH_PROVIDER_NAME) return "SCCH";
  if (name === FOUNDRY_PROVIDER_NAME) return "Azure Foundry";
  return undefined;
}

// For the lenient runtime parsers: a valid literal passes through, anything else —
// including a non-string — is `undefined`. The CALLER decides how to treat a
// missing value (`?? DEFAULT_PROVIDER`) vs. a present-but-invalid one (reject, so
// a Foundry-intended activity never silently runs against SCCH).
export function parseLenientProvider(value: unknown): LlmProvider | undefined {
  return value === "SCCH" || value === "Azure Foundry" ? value : undefined;
}

// The little-coder provider config (`models.json`) — the ready-to-paste artifact a
// student drops into `~/.config/little-coder/models.json`. CLIENT-SAFE and pure (no
// I/O, no server-only imports), so it is the single source of truth shared by the
// `CodingConnection` block (student page, teacher detail, create/edit result) AND the
// `/codes` list copy button — they can never drift. Carries only non-secret values;
// the teacher's system prompt + the real model never appear here.

export function buildLittleCoderConfig(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelName: string;
}): string {
  return JSON.stringify(
    {
      providers: {
        novedu: {
          api: "openai-completions",
          baseUrl: opts.baseUrl,
          apiKey: opts.apiKey,
          models: [
            {
              id: opts.modelId,
              name: opts.modelName,
              reasoning: false,
              input: ["text"],
              contextWindow: 32768,
              maxTokens: 4096,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            },
          ],
        },
      },
    },
    null,
    2,
  );
}

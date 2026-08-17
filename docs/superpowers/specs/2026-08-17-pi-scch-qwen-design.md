# Pi SCCH Qwen 3.8 configuration design

## Goal

Make SCCH's reasoning-enabled `Qwen/Qwen3.8-27B-FP8` model available in Pi through SCCH's OpenAI-compatible vLLM endpoint.

## Configuration

Create the user-scoped Pi model catalog `~/.pi/agent/models.json` with an `scch` provider. The provider will use:

- the existing `SCCH_BASE_URL` value from the project's `.env`;
- Pi's `openai-completions` API adapter;
- the exact server-advertised model ID `Qwen/Qwen3.8-27B-FP8`;
- reasoning enabled with the local-Qwen `qwen-chat-template` compatibility format;
- compatibility settings appropriate for vLLM, including the `system` role and `max_tokens` field;
- zero cost metadata because SCCH does not expose billing rates.

Copy the existing `SCCH_API_KEY` value from `.env` into the `scch` API-key entry in `~/.pi/agent/auth.json`. Do not put the key in `models.json`, repository files, command output, or commits. Preserve every existing credential in `auth.json` and retain restrictive user-only file permissions.

The existing OpenRouter default in `~/.pi/agent/settings.json` will remain unchanged. SCCH can be selected explicitly with:

```bash
pi --provider scch --model Qwen/Qwen3.8-27B-FP8
```

## Validation

Validate both JSON files without printing credentials, verify that `auth.json` remains mode `0600`, and use Pi's model-list command to confirm the SCCH model is selectable. Then make a minimal non-interactive Pi request to verify authentication, streaming text, reasoning compatibility, and basic tool-capable coding-agent operation. If vLLM rejects a compatibility field, adjust only the SCCH provider compatibility settings and repeat the test.

## Scope

This is user-local Pi configuration. It does not change the application's SCCH integration, the project `.env`, Pi's current default model, or any repository source code apart from this design record.

// Base URL of the Novedu web app for API commands. The production URL is
// baked in as the default; `--server <url>` (per command) beats the
// NOVEDU_SERVER env var beats the default — localhost development uses either
// override.
const DEFAULT_SERVER = "https://novedu-chat-mvp-at.azurewebsites.net";

export function resolveServerUrl(cliOption?: string): string {
  return cliOption || process.env.NOVEDU_SERVER || DEFAULT_SERVER;
}

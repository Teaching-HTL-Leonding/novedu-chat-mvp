// Fail fast (and clearly) at startup if a required setting is missing, rather than
// interpolating `undefined` into, say, the Entra issuer URL and failing mid-sign-in
// with an opaque OAuth discovery error.
export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

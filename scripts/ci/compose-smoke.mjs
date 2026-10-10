// Smoke test for compose.yaml: run against a stack started with
// `docker compose up -d --wait`, it signs in through the demo login and checks
// that the app reaches its database, the fake LLM and the image root. Used by
// the `demo` leg of `prod-build` in .github/workflows/qa.yml (docs/testing.md,
// "Fake LLM"). Plain Node `fetch`, no dependencies.
//
// Reads NOVEDU_PORT and NOVEDU_FAKE_LLM_PORT like compose.yaml does.

const appOrigin = `http://localhost:${process.env.NOVEDU_PORT || 3000}`;
const fakeOrigin = `http://127.0.0.1:${process.env.NOVEDU_FAKE_LLM_PORT || 4010}`;

// The demo teacher Anna Berger — redeclared from lib/demo-personas.ts
// (`demo-teacher-1`, DEMO_PASSWORD); keep the two in step.
const TEACHER = {
  id: "demo-teacher-1",
  email: "anna.berger@demo.novedu.invalid",
  password: "novedu-demo-login-not-a-secret",
};

let failed = false;

function report(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed = true;
}

async function check(what, fn) {
  try {
    const result = await fn();
    report(result.ok, what, result.detail);
  } catch (err) {
    report(false, what, err instanceof Error ? err.message : String(err));
  }
}

await check("GET /api/version", async () => {
  const res = await fetch(`${appOrigin}/api/version`);
  const body = res.ok ? await res.json() : undefined;
  return {
    ok: res.ok && Boolean(body?.version),
    detail: `HTTP ${res.status} ${body?.version ?? ""}`,
  };
});

await check("GET /sign-in", async () => {
  const res = await fetch(`${appOrigin}/sign-in`);
  return { ok: res.ok, detail: `HTTP ${res.status}` };
});

let cookie = "";
await check(`sign in as ${TEACHER.id}`, async () => {
  const res = await fetch(`${appOrigin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: appOrigin },
    body: JSON.stringify({ email: TEACHER.email, password: TEACHER.password }),
  });
  cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { ok: res.ok && cookie.includes("session_token"), detail: `HTTP ${res.status}` };
});

await check("GET /api/auth/get-session", async () => {
  const res = await fetch(`${appOrigin}/api/auth/get-session`, { headers: { cookie } });
  const body = res.ok ? await res.json() : undefined;
  const userId = body?.user?.id;
  return { ok: userId === TEACHER.id, detail: `HTTP ${res.status}, user ${userId ?? "none"}` };
});

for (const probe of ["db", "scch", "images"]) {
  await check(`GET /api/health?probe=${probe}`, async () => {
    const res = await fetch(`${appOrigin}/api/health?probe=${probe}`, { headers: { cookie } });
    const body = res.ok ? await res.json() : undefined;
    return { ok: body?.ok === true, detail: `HTTP ${res.status} ${body?.detail ?? ""}` };
  });
}

await check("GET fake LLM /v1/models", async () => {
  const res = await fetch(`${fakeOrigin}/v1/models`);
  return { ok: res.ok, detail: `HTTP ${res.status}` };
});

if (failed) {
  console.error("compose-smoke: at least one check failed");
  process.exit(1);
}
console.log("compose-smoke: all checks passed");

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const EXPECTED_SHA256 = "0cd806133160f4e9dff40b8ce1b891345cdf34587c24290f6b6ab1d913c28fcc";
const enc = new TextEncoder();

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Secret-safe telemetry: never logs the supplied header value or the expected hash.
function logEvent(kind: "auth_failure" | "auth_success" | "bad_method", req: Request, extra: Record<string, unknown> = {}) {
  const entry = {
    event: kind,
    ts: new Date().toISOString(),
    method: req.method,
    source_ip: req.headers.get("x-forwarded-for") ?? req.headers.get("cf-connecting-ip") ?? "unknown",
    user_agent: req.headers.get("user-agent") ?? "unknown",
    secret_provided: req.headers.has("x-cron-secret"),
    ...extra,
  };
  console.log(JSON.stringify(entry));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    logEvent("bad_method", req);
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "content-type": "application/json" } });
  }

  const provided = req.headers.get("x-cron-secret") ?? "";
  if (!provided || (await sha256Hex(provided)) !== EXPECTED_SHA256) {
    logEvent("auth_failure", req);
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRole) {
    return new Response(JSON.stringify({ error: "server credential unavailable" }), { status: 500, headers: { "content-type": "application/json" } });
  }

  let body: unknown = {};
  try { body = await req.json(); } catch {}

  const upstream = await fetch(`${supabaseUrl}/functions/v1/process-distribution-job`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${serviceRole}`,
    },
    body: JSON.stringify(body ?? {}),
  });

  logEvent("auth_success", req, { upstream_status: upstream.status });

  const text = await upstream.text();
  return new Response(text, {
    status: upstream.status,
    headers: { "content-type": upstream.headers.get("content-type") ?? "application/json" },
  });
});

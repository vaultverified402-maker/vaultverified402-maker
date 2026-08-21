import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_EMAIL = "vaultverified402@gmail.com";

const cors = {
  "access-control-allow-origin": "https://www.vaultverified.app",
  "access-control-allow-headers": "authorization, content-type, apikey",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const email = authData.user?.email?.toLowerCase();
  if (authError || !email) return json({ error: "unauthorized" }, 401);
  if (email !== ADMIN_EMAIL) return json({ error: "forbidden" }, 403);

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "mark_contacted" || !body?.prospect_id || !body?.channel) {
      return json({ error: "invalid_action" }, 400);
    }
    const { data: marked, error: markError } = await admin.rpc("mark_conversion_outreach_contacted_api", {
      p_prospect_id: String(body.prospect_id),
      p_channel: String(body.channel),
    });
    if (markError) return json({ error: "mark_contacted_failed" }, 503);
    return json({ ok: true, result: marked });
  }

  const [{ data, error }, { data: outreachTasks, error: outreachError }] = await Promise.all([
    admin.rpc("get_operator_command_center"),
    admin.rpc("get_conversion_outreach_tasks_api"),
  ]);
  if (error || outreachError) {
    console.error("operator command center RPC failed", error || outreachError);
    return json({ error: "command_center_unavailable" }, 503);
  }

  const rows = Array.isArray(data) ? data : [];
  const tasks = Array.isArray(outreachTasks) ? outreachTasks : [];
  const counts = rows.reduce((acc: Record<string, number>, row: Record<string, unknown>) => {
    const state = String(row.activation_state || "UNKNOWN");
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {});

  return json({
    generated_at: new Date().toISOString(),
    counts,
    operators: rows,
    outreach_tasks: tasks,
    outreach_count: tasks.length,
  });
});
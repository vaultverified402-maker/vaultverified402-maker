import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPERATOR_AUTH_URL = `${SUPABASE_URL}/functions/v1/operator-auth-request`;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, apikey, authorization",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" },
  });
}

function asString(v: unknown, max = 500) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function validEmail(email: string) {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (req.method === "GET") {
    const now = new Date().toISOString();
    const horizon = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();
    const [{ data: events, error: eventsError }, { data: markets, error: marketsError }] = await Promise.all([
      admin.from("events")
        .select("event_id,sport,league,home_team,away_team,scheduled_start")
        .eq("event_status", "scheduled")
        .gt("scheduled_start", now)
        .lt("scheduled_start", horizon)
        .order("scheduled_start", { ascending: true })
        .limit(150),
      admin.from("canonical_markets")
        .select("market_code,default_label,requires_line,selection_shape")
        .order("market_code"),
    ]);

    if (eventsError || marketsError) {
      console.error("first-pick catalog lookup failed", { eventsError, marketsError });
      return json({ error: "catalog_unavailable" }, 503);
    }

    return json({ events: events ?? [], markets: markets ?? [] });
  }

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const requestId = asString(body.request_id, 64);
  const fullName = asString(body.full_name, 80);
  const handle = asString(body.handle, 40).replace(/^@/, "").toLowerCase();
  const email = asString(body.email, 320).toLowerCase();
  const eventId = asString(body.event_id, 120);
  const marketCode = asString(body.market_code, 30).toUpperCase();
  const side = asString(body.side, 20).toLowerCase();
  const odds = asString(body.odds, 12) || null;
  const thesis = asString(body.thesis, 1000);
  const propPlayer = asString(body.prop_player, 120) || null;
  const propStatCode = asString(body.prop_stat_code, 80) || null;
  const confidence = Number(body.confidence);
  const line = body.line === null || body.line === "" || body.line === undefined ? null : Number(body.line);
  const ack = body.ack_preevent === true;

  if (!requestId || !fullName || !handle || !validEmail(email) || !eventId || !marketCode || !side || !ack) {
    return json({ error: "invalid_request" }, 400);
  }
  if (!Number.isInteger(confidence) || confidence < 1 || confidence > 10) return json({ error: "invalid_confidence" }, 400);
  if (thesis.length < 10) return json({ error: "thesis_too_short" }, 400);
  if (line !== null && !Number.isFinite(line)) return json({ error: "invalid_line" }, 400);

  const { data, error } = await admin.rpc("activate_first_pick", {
    p_request_id: requestId,
    p_full_name: fullName,
    p_handle: handle,
    p_email: email,
    p_event_id: eventId,
    p_market_code: marketCode,
    p_side: side,
    p_line: line,
    p_prop_player: propPlayer,
    p_prop_stat_code: propStatCode,
    p_odds: odds,
    p_thesis: thesis,
    p_confidence: confidence,
  });

  if (error) {
    console.error("activate_first_pick RPC failed", error);
    return json({ error: "activation_failed" }, 500);
  }

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.success) {
    const code = result?.error_code ?? "activation_failed";
    const status = code === "event_cutoff_passed" || code === "handle_taken" || code === "email_enrolled" ? 409 : 400;
    return json({ error: code }, status);
  }

  try {
    await fetch(OPERATOR_AUTH_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email }),
    });
  } catch (authErr) {
    console.error("first-pick account access email request failed", authErr);
  }

  return json({
    success: true,
    record_id: result.record_id,
    profile_id: result.profile_id,
    operator_handle: result.operator_handle,
    filed_at: result.preserved_at,
    record_hash: result.record_hash,
  }, result.replay ? 200 : 201);
});

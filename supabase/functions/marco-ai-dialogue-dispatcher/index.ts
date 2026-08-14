import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const NOTION_VERSION = "2026-03-11";
const NOTION_API = "https://api.notion.com/v1";
const QUEUE_DATA_SOURCE_ID = Deno.env.get("NOTION_HANDOFF_DATA_SOURCE_ID") ?? "";
const NOTION_API_KEY = Deno.env.get("NOTION_API_KEY") ?? "";
const NOTION_WEBHOOK_VERIFICATION_TOKEN = Deno.env.get("NOTION_WEBHOOK_VERIFICATION_TOKEN") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") ?? "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "";
const ACTOR = "Marco OS Hosted Dispatcher";
const SUPPORTED_AUTH = new Set(["READ_ONLY", "WRITE_REPLY"]);
const SUPPORTED_SCOPE = new Set(["Notion only"]);

type Json = Record<string, unknown>;

class DispatchError extends Error {}

function response(status: number, body: Json = { ok: true }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function notion(path: string, init: RequestInit = {}) {
  if (!NOTION_API_KEY) throw new DispatchError("NOTION_API_KEY is not configured");
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${NOTION_API_KEY}`,
      "Notion-Version": NOTION_VERSION,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new DispatchError(`Notion ${res.status}: ${await res.text()}`);
  return await res.json();
}

function plain(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title" || prop.type === "rich_text") {
    return (prop[prop.type] ?? []).map((x: any) => x.plain_text ?? "").join("");
  }
  if (prop.type === "select") return prop.select?.name ?? "";
  return "";
}

function num(prop: any, fallback = 0): number {
  const value = prop?.number;
  return value == null ? fallback : Number(value);
}

function checkbox(prop: any): boolean {
  return Boolean(prop?.checkbox);
}

function multi(prop: any): string[] {
  return (prop?.multi_select ?? []).map((x: any) => x.name).filter(Boolean);
}

function richText(value: string) {
  const chunks = value.match(/[\s\S]{1,1900}/g) ?? [""];
  return { rich_text: chunks.map((content) => ({ type: "text", text: { content } })) };
}

async function patchPage(pageId: string, properties: Json) {
  return await notion(`/pages/${pageId}`, {
    method: "PATCH",
    body: JSON.stringify({ properties }),
  });
}

async function verifyNotionSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!NOTION_WEBHOOK_VERIFICATION_TOKEN || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(NOTION_WEBHOOK_VERIFICATION_TOKEN),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return signature === `sha256=${hex}`;
}

function validatePage(page: any): string | null {
  const p = page.properties ?? {};
  if (plain(p.Status) !== "QUEUED") return "Status is no longer QUEUED";
  if (plain(p["Claimed By"])) return "Claimed By is already populated";
  const target = plain(p.To);
  if (target !== "Claude" && target !== "OpenAI") return `unsupported target ${target || "(empty)"}`;
  const auth = plain(p.Authorization);
  if (!SUPPORTED_AUTH.has(auth)) return `unsupported Authorization=${auth || "(empty)"}`;
  if (checkbox(p["Requires Human Approval"])) return "Requires Human Approval is true";
  const unsupportedScopes = multi(p.Scope).filter((scope) => !SUPPORTED_SCOPE.has(scope));
  if (unsupportedScopes.length) return `unsupported Scope values: ${unsupportedScopes.join(", ")}`;
  if (num(p["Turn Count"]) >= num(p["Max Turns"], 10)) return "Max Turns reached";
  if (!plain(p.Message).trim()) return "Message is empty";
  return null;
}

function makePrompt(page: any): string {
  const p = page.properties ?? {};
  return [
    "You are processing one governed Marco OS AI Handoff Queue turn.",
    "The queue is the audit ledger. You do not own lifecycle fields and you have no external tools in this execution.",
    "Use only the Task and Message supplied below plus general reasoning.",
    "Do not claim to inspect GitHub, Supabase, Vercel, email, files, or other connected systems.",
    "If the question requires information not present in the Message, say what visibility is missing.",
    `Task: ${plain(p.Task)}`,
    `Authorization: ${plain(p.Authorization)}`,
    `Scope: ${multi(p.Scope).join(", ") || "(none)"}`,
    `Turn Count: ${num(p["Turn Count"])}/${num(p["Max Turns"], 10)}`,
    "",
    "Message:",
    plain(p.Message),
    "",
    "Return only the substantive Reply text. Do not output JSON or lifecycle updates.",
  ].join("\n");
}

async function withTimeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await work(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAI(prompt: string, timeoutMs: number): Promise<{ text: string; model: string }> {
  if (!OPENAI_API_KEY || !OPENAI_MODEL) throw new DispatchError("OpenAI provider credentials/model are not configured");
  const json: any = await withTimeout(timeoutMs, async (signal) => {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: OPENAI_MODEL, input: prompt, store: false }),
    });
    if (!res.ok) throw new DispatchError(`OpenAI ${res.status}: ${await res.text()}`);
    return await res.json();
  });
  const text = (json.output ?? [])
    .flatMap((item: any) => item.content ?? [])
    .filter((item: any) => item.type === "output_text")
    .map((item: any) => item.text ?? "")
    .join("\n")
    .trim();
  if (!text) throw new DispatchError("OpenAI returned no output_text");
  return { text, model: json.model ?? OPENAI_MODEL };
}

async function callAnthropic(prompt: string, timeoutMs: number): Promise<{ text: string; model: string }> {
  if (!ANTHROPIC_API_KEY || !ANTHROPIC_MODEL) throw new DispatchError("Anthropic provider credentials/model are not configured");
  const json: any = await withTimeout(timeoutMs, async (signal) => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new DispatchError(`Anthropic ${res.status}: ${await res.text()}`);
    return await res.json();
  });
  const text = (json.content ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text ?? "").join("\n").trim();
  if (!text) throw new DispatchError("Anthropic returned no text content");
  return { text, model: json.model ?? ANTHROPIC_MODEL };
}

async function processPage(pageId: string) {
  let page: any = await notion(`/pages/${pageId}`);
  const parentDataSource = page.parent?.data_source_id ?? page.parent?.database_id ?? "";
  if (QUEUE_DATA_SOURCE_ID && parentDataSource && parentDataSource !== QUEUE_DATA_SOURCE_ID) return;

  const reason = validatePage(page);
  if (reason) return;

  await patchPage(pageId, {
    Status: { select: { name: "IN_PROGRESS" } },
    "Claimed By": richText(ACTOR),
    "Claimed At": { date: { start: new Date().toISOString() } },
  });

  page = await notion(`/pages/${pageId}`);
  if (plain(page.properties?.Status) !== "IN_PROGRESS" || plain(page.properties?.["Claimed By"]) !== ACTOR) return;

  const p = page.properties ?? {};
  const prompt = makePrompt(page);
  const maxRuntimeSeconds = Math.max(1, Math.min(num(p["Max Runtime Seconds"], 180), 180));
  const target = plain(p.To);

  try {
    const result = target === "Claude"
      ? await callAnthropic(prompt, maxRuntimeSeconds * 1000)
      : await callOpenAI(prompt, maxRuntimeSeconds * 1000);
    await patchPage(pageId, {
      Reply: richText(result.text),
      Model: richText(result.model),
      "Turn Count": { number: num(p["Turn Count"]) + 1 },
      Status: { select: { name: "REPLIED" } },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await patchPage(pageId, {
      Reply: richText(`Dispatcher interrupted safely: ${message}`),
      Model: richText("Marco OS Hosted Dispatcher"),
      "Turn Count": { number: num(p["Turn Count"]) + 1 },
      Status: { select: { name: "INTERRUPTED" } },
    });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return response(405, { error: "method_not_allowed" });
  const rawBody = await req.text();
  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return response(400, { error: "invalid_json" });
  }

  if (event.verification_token) {
    return response(200, { ok: true, verification_received: true });
  }

  if (!(await verifyNotionSignature(rawBody, req.headers.get("x-notion-signature")))) {
    return response(401, { error: "invalid_signature" });
  }

  if (event.type !== "page.created" && event.type !== "page.properties_updated") {
    return response(200, { ok: true, ignored: true });
  }

  const pageId = event.entity?.id;
  const dataSourceId = event.data?.parent?.data_source_id;
  if (!pageId || (QUEUE_DATA_SOURCE_ID && dataSourceId !== QUEUE_DATA_SOURCE_ID)) {
    return response(200, { ok: true, ignored: true });
  }

  // Acknowledge only after the governed turn has been processed. Notion retries failed deliveries.
  await processPage(pageId);
  return response(200, { ok: true });
});

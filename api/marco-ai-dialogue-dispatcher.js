const crypto = require('crypto');

// Vercel must not pre-parse Notion webhook bodies. Signature verification is
// computed over the exact raw request bytes.
module.exports.config = { api: { bodyParser: false } };

const NOTION_VERSION = process.env.NOTION_VERSION || '2026-03-11';
const NOTION_API = 'https://api.notion.com/v1';
const QUEUE_DATA_SOURCE_ID = process.env.NOTION_HANDOFF_DATA_SOURCE_ID || '';
const ACTOR = 'Marco OS Vercel Primary';
const LEASE_OWNER = 'vercel-primary';
const SUPABASE_SCHEMA = process.env.SUPABASE_DIALOG_SCHEMA || 'marco_dialog';
const SUPPORTED_AUTH = new Set(['READ_ONLY', 'WRITE_REPLY']);
// Scope labels describe the subject of the dialogue, not runtime capability.
// The hosted model receives text only and has no tool/function calling.
const SUPPORTED_SCOPE = new Set(['Notion only', 'GitHub', 'Vercel', 'Supabase']);

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing configuration: ${name}`);
  return value;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function safeEqual(a, b) {
  const aa = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function verifyNotionSignature(raw, signature) {
  const secret = process.env.NOTION_WEBHOOK_VERIFICATION_TOKEN || '';
  if (!secret || !signature || !signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return safeEqual(expected, signature);
}

async function notion(path, init = {}) {
  const response = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('NOTION_API_KEY')}`,
      'Notion-Version': NOTION_VERSION,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!response.ok) throw new Error(`Notion request failed (${response.status})`);
  return response.json();
}

async function patchPage(pageId, properties) {
  return notion(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) });
}

function plain(prop) {
  if (!prop) return '';
  if (prop.type === 'title' || prop.type === 'rich_text') {
    return (prop[prop.type] || []).map((x) => x.plain_text || '').join('');
  }
  if (prop.type === 'select') return prop.select?.name || '';
  if (prop.type === 'status') return prop.status?.name || '';
  return '';
}

function number(prop, fallback = 0) {
  return prop?.number == null ? fallback : Number(prop.number);
}

function checkbox(prop) {
  return Boolean(prop?.checkbox);
}

function multi(prop) {
  return (prop?.multi_select || []).map((x) => x.name).filter(Boolean);
}

function richText(value) {
  const chunks = String(value || '').match(/[\s\S]{1,1900}/g) || [''];
  return { rich_text: chunks.map((content) => ({ type: 'text', text: { content } })) };
}

function title(value) {
  return { title: [{ type: 'text', text: { content: String(value || '').slice(0, 1900) } }] };
}

function select(value) {
  return { select: { name: value } };
}

function multiSelect(values) {
  return { multi_select: values.map((name) => ({ name })) };
}

function pageIsInQueue(page) {
  const actual = page?.parent?.data_source_id || page?.parent?.database_id || '';
  return actual.replace(/-/g, '') === QUEUE_DATA_SOURCE_ID.replace(/-/g, '');
}

function validatePage(page) {
  if (!pageIsInQueue(page)) return 'page is outside configured handoff queue';
  const p = page.properties || {};
  if (plain(p.Status) !== 'QUEUED') return 'status is not QUEUED';
  if (plain(p['Claimed By'])) return 'already claimed';
  if (plain(p.Reply).trim()) return 'reply already exists';
  const target = plain(p.To);
  if (!['Claude', 'OpenAI'].includes(target)) return 'unsupported target';
  if (!SUPPORTED_AUTH.has(plain(p.Authorization))) return 'unsupported authorization';
  if (checkbox(p['Requires Human Approval'])) return 'human approval required';
  const scopes = multi(p.Scope);
  if (!scopes.length || scopes.some((s) => !SUPPORTED_SCOPE.has(s))) return 'unsupported scope';
  if (number(p['Turn Count']) >= number(p['Max Turns'], 10)) return 'max turns reached';
  if (!plain(p.Message).trim()) return 'empty message';
  return null;
}

async function supabaseRpc(name, payload) {
  const base = env('SUPABASE_DIALOG_URL').replace(/\/$/, '');
  const key = env('SUPABASE_DIALOG_SERVICE_KEY');
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      'Content-Profile': SUPABASE_SCHEMA,
      'Accept-Profile': SUPABASE_SCHEMA,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`dialog state RPC ${name} failed (${response.status})`);
  return response.json();
}

async function acquireLease(handoffId, leaseToken, ttlSeconds) {
  const rows = await supabaseRpc('acquire_turn_lease', {
    p_handoff_id: handoffId,
    p_owner: LEASE_OWNER,
    p_lease_token: leaseToken,
    p_ttl_seconds: ttlSeconds,
  });
  return Array.isArray(rows) ? rows[0] : rows;
}

async function completeLease(handoffId, leaseToken, state, provider, requestId) {
  return supabaseRpc('complete_turn_lease', {
    p_handoff_id: handoffId,
    p_owner: LEASE_OWNER,
    p_lease_token: leaseToken,
    p_state: state,
    p_provider: provider || null,
    p_provider_request_id: requestId || null,
  });
}

function utcBuckets(now = new Date()) {
  const iso = now.toISOString();
  return { day: `provider:${iso.slice(0, 10)}`, month: `provider:${iso.slice(0, 7)}` };
}

async function reserveBudget() {
  const dailyLimit = Math.max(1, Number(process.env.DIALOG_DAILY_PROVIDER_CALL_LIMIT || 100));
  const monthlyLimit = Math.max(1, Number(process.env.DIALOG_MONTHLY_PROVIDER_CALL_LIMIT || 1000));
  const b = utcBuckets();
  const daily = await supabaseRpc('reserve_budget', { p_bucket: b.day, p_limit: dailyLimit });
  const d = Array.isArray(daily) ? daily[0] : daily;
  if (!d?.allowed) return { allowed: false, reason: 'daily provider-call circuit breaker' };
  const monthly = await supabaseRpc('reserve_budget', { p_bucket: b.month, p_limit: monthlyLimit });
  const m = Array.isArray(monthly) ? monthly[0] : monthly;
  if (!m?.allowed) return { allowed: false, reason: 'monthly provider-call circuit breaker' };
  return { allowed: true };
}

function makePrompt(page) {
  const p = page.properties || {};
  return [
    'You are processing one governed Marco OS AI Handoff Queue turn.',
    'You have NO external tools or credentials in this execution. Use only the Task, Message, and metadata below plus general reasoning.',
    'Scope labels describe the dialogue topic only. They do NOT grant runtime access to those systems.',
    'Never claim you inspected GitHub, Supabase, Vercel, email, files, Vault Verified production, or other systems.',
    'If the requested answer requires unavailable external inspection or execution, state that limitation instead of inventing access.',
    'If another response from the other model is genuinely useful to complete the task, begin your output with CONTINUE:.',
    'If the task is complete or further dialogue is unnecessary, begin your output with DONE:.',
    'After that marker, provide only the substantive reply. Do not output lifecycle JSON.',
    `Task: ${plain(p.Task)}`,
    `Authorization: ${plain(p.Authorization)}`,
    `Scope: ${multi(p.Scope).join(', ')}`,
    `Turn: ${number(p['Turn Count'])}/${number(p['Max Turns'], 10)}`,
    '',
    'Message:',
    plain(p.Message),
  ].join('\n');
}

async function withTimeout(ms, fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await fn(controller.signal); }
  finally { clearTimeout(timer); }
}

async function callOpenAI(prompt, timeoutMs) {
  const response = await withTimeout(timeoutMs, (signal) => fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal,
    headers: { Authorization: `Bearer ${env('OPENAI_API_KEY')}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: env('OPENAI_MODEL'), input: prompt, store: false }),
  }));
  if (!response.ok) throw new Error(`OpenAI provider error (${response.status})`);
  const json = await response.json();
  const text = (json.output || []).flatMap((x) => x.content || []).filter((x) => x.type === 'output_text').map((x) => x.text || '').join('\n').trim();
  if (!text) throw new Error('OpenAI returned empty output');
  return { text, model: json.model || env('OPENAI_MODEL'), requestId: json.id || null, provider: 'OpenAI' };
}

async function callAnthropic(prompt, timeoutMs) {
  const response = await withTimeout(timeoutMs, (signal) => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal,
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: env('ANTHROPIC_MODEL'), max_tokens: 1400, messages: [{ role: 'user', content: prompt }] }),
  }));
  if (!response.ok) throw new Error(`Anthropic provider error (${response.status})`);
  const json = await response.json();
  const text = (json.content || []).filter((x) => x.type === 'text').map((x) => x.text || '').join('\n').trim();
  if (!text) throw new Error('Anthropic returned empty output');
  return { text, model: json.model || env('ANTHROPIC_MODEL'), requestId: json.id || null, provider: 'Anthropic' };
}

function parseDirective(text) {
  const trimmed = text.trim();
  if (/^CONTINUE\s*:/i.test(trimmed)) return { continue: true, reply: trimmed.replace(/^CONTINUE\s*:\s*/i, '').trim() };
  if (/^DONE\s*:/i.test(trimmed)) return { continue: false, reply: trimmed.replace(/^DONE\s*:\s*/i, '').trim() };
  return { continue: false, reply: trimmed };
}

async function createNextTurn(page, reply) {
  const p = page.properties || {};
  const currentTarget = plain(p.To);
  const nextTarget = currentTarget === 'Claude' ? 'OpenAI' : 'Claude';
  const nextTurn = number(p['Turn Count']) + 1;
  const maxTurns = number(p['Max Turns'], 10);
  if (nextTurn >= maxTurns) return null;

  const created = await notion('/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { type: 'data_source_id', data_source_id: QUEUE_DATA_SOURCE_ID },
      properties: {
        Task: title(plain(p.Task)),
        From: select(currentTarget),
        To: select(nextTarget),
        Message: richText(reply),
        Status: select('QUEUED'),
        Authorization: select(plain(p.Authorization)),
        Scope: multiSelect(multi(p.Scope)),
        'Requires Human Approval': { checkbox: false },
        'Max Turns': { number: maxTurns },
        'Max Runtime Seconds': { number: number(p['Max Runtime Seconds'], 180) },
        'Turn Count': { number: nextTurn },
        'Handoff ID': richText(`${page.id}:turn:${nextTurn}`),
      },
    }),
  });
  return created.id;
}

function extractPageId(event) {
  return event?.entity?.id || event?.data?.entity?.id || event?.data?.page_id || event?.page_id || null;
}

async function interrupt(pageId, claimLabel, message) {
  const page = await notion(`/pages/${pageId}`);
  const p = page.properties || {};
  if (plain(p.Status) !== 'IN_PROGRESS' || plain(p['Claimed By']) !== claimLabel || plain(p.Reply).trim()) return false;
  await patchPage(pageId, { Status: select('INTERRUPTED'), Reply: richText(message) });
  return true;
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { ok: false });

  let raw;
  let event;
  try {
    raw = await readRawBody(req);
    event = JSON.parse(raw.toString('utf8') || '{}');
  } catch {
    return send(res, 400, { ok: false });
  }

  // Notion's one-time endpoint verification has no execution side effects.
  if (event?.verification_token && !req.headers['x-notion-signature']) {
    return send(res, 200, { ok: true, verification: true });
  }

  if (!verifyNotionSignature(raw, req.headers['x-notion-signature'])) {
    return send(res, 401, { ok: false });
  }

  const pageId = extractPageId(event);
  if (!pageId) return send(res, 202, { ok: true, ignored: true });

  const leaseToken = crypto.randomUUID();
  const claimLabel = `${ACTOR}:${leaseToken.slice(0, 8)}`;
  let leaseAcquired = false;
  let providerResult = null;

  try {
    let page = await notion(`/pages/${pageId}`);
    const validation = validatePage(page);
    if (validation) return send(res, 202, { ok: true, ignored: true, reason: validation });

    const ttlSeconds = Math.min(900, Math.max(30, number(page.properties?.['Max Runtime Seconds'], 180) + 30));
    const lease = await acquireLease(page.id, leaseToken, ttlSeconds);
    if (!lease?.acquired) return send(res, 202, { ok: true, ignored: true, reason: 'lease not acquired' });
    leaseAcquired = true;

    const attempts = Math.max(1, number(page.properties?.['Attempt Count']) + 1);
    await patchPage(page.id, {
      Status: select('IN_PROGRESS'),
      'Claimed By': richText(claimLabel),
      'Claimed At': { date: { start: new Date().toISOString() } },
      'Attempt Count': { number: attempts },
    });

    page = await notion(`/pages/${page.id}`);
    if (plain(page.properties?.Status) !== 'IN_PROGRESS' || plain(page.properties?.['Claimed By']) !== claimLabel || plain(page.properties?.Reply).trim()) {
      await completeLease(page.id, leaseToken, 'INTERRUPTED', null, null);
      return send(res, 202, { ok: true, ignored: true, reason: 'claim verification failed' });
    }

    const budget = await reserveBudget();
    if (!budget.allowed) {
      await interrupt(page.id, claimLabel, `Marco OS paused this turn: ${budget.reason}. No model call was made.`);
      await completeLease(page.id, leaseToken, 'INTERRUPTED', null, null);
      return send(res, 429, { ok: false, circuit_breaker: true });
    }

    const timeoutMs = Math.min(180000, Math.max(5000, number(page.properties?.['Max Runtime Seconds'], 180) * 1000));
    const prompt = makePrompt(page);
    providerResult = plain(page.properties?.To) === 'OpenAI'
      ? await callOpenAI(prompt, timeoutMs)
      : await callAnthropic(prompt, timeoutMs);

    const directive = parseDirective(providerResult.text);
    if (!directive.reply) throw new Error('provider returned empty substantive reply');

    page = await notion(`/pages/${page.id}`);
    if (plain(page.properties?.Status) !== 'IN_PROGRESS' || plain(page.properties?.['Claimed By']) !== claimLabel || plain(page.properties?.Reply).trim()) {
      throw new Error('final ownership check failed');
    }

    await patchPage(page.id, {
      Reply: richText(directive.reply),
      Model: richText(providerResult.model),
      'Turn Count': { number: number(page.properties?.['Turn Count']) + 1 },
      Status: select('REPLIED'),
    });

    if (directive.continue) await createNextTurn(page, directive.reply);

    await completeLease(page.id, leaseToken, 'COMPLETED', providerResult.provider, providerResult.requestId);
    return send(res, 200, { ok: true, page_id: page.id, continued: directive.continue });
  } catch (error) {
    try {
      if (pageId && leaseAcquired) {
        await interrupt(pageId, claimLabel, 'Marco OS interrupted this turn safely. No reply was fabricated.');
        await completeLease(pageId, leaseToken, 'INTERRUPTED', providerResult?.provider || null, providerResult?.requestId || null);
      }
    } catch {}
    console.error('marco-dialog-dispatcher', { page_id: pageId || null, error: error?.name || 'Error' });
    return send(res, 500, { ok: false });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };

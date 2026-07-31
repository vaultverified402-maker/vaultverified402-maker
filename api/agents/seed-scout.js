const crypto = require('node:crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_SECRET = process.env.AGENT_SECRET;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function normalize(value) {
  return String(value || '').trim();
}

function seedKey(platform, handle) {
  return `${normalize(platform).toLowerCase()}:${normalize(handle).toLowerCase().replace(/^@/, '')}`;
}

function fingerprint(input) {
  return crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function scoreCandidate(candidate) {
  let score = 10;
  const reasons = [];
  const followers = Number(candidate.follower_count || 0);

  if (candidate.public_picks_detected) {
    score += 35;
    reasons.push('public_picks_detected');
  }
  if (candidate.profile_url) {
    score += 10;
    reasons.push('public_profile_available');
  }
  if (followers >= 1000) {
    score += 10;
    reasons.push('audience_1k_plus');
  }
  if (followers >= 10000) {
    score += 10;
    reasons.push('audience_10k_plus');
  }
  if (candidate.contact_available) {
    score += 10;
    reasons.push('contact_available');
  }
  if (candidate.recent_activity) {
    score += 15;
    reasons.push('recent_activity');
  }

  return { score: Math.min(score, 100), reasons };
}

async function supabase(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      prefer: 'return=representation,resolution=merge-duplicates',
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`Supabase ${response.status}: ${text}`);
  }
  return data;
}

async function upsertCandidate(candidate, sourceType = 'manual') {
  const platform = normalize(candidate.primary_platform || candidate.platform);
  const handle = normalize(candidate.primary_handle || candidate.handle).replace(/^@/, '');
  if (!platform || !handle) throw new Error('Candidate requires platform and handle');

  const scoring = scoreCandidate(candidate);
  const key = seedKey(platform, handle);
  const lifecycle = scoring.score >= 70 ? 'outreach_ready' : scoring.score >= 45 ? 'qualified' : 'discovered';

  const row = {
    seed_key: key,
    display_name: normalize(candidate.display_name) || null,
    primary_handle: handle,
    primary_platform: platform.toLowerCase(),
    profile_url: normalize(candidate.profile_url) || null,
    follower_count: Number.isFinite(Number(candidate.follower_count)) ? Number(candidate.follower_count) : null,
    public_picks_detected: Boolean(candidate.public_picks_detected),
    lifecycle_state: lifecycle,
    opportunity_score: scoring.score,
    score_reasons: scoring.reasons,
    source_type: sourceType,
    source_ref: normalize(candidate.source_ref) || null,
    last_seen_at: new Date().toISOString(),
    last_public_activity_at: candidate.last_public_activity_at || null,
    next_action_at: lifecycle === 'outreach_ready' ? new Date().toISOString() : null,
    metadata: candidate.metadata || {}
  };

  const seeds = await supabase('seed_consultants?on_conflict=seed_key', {
    method: 'POST',
    body: JSON.stringify([row])
  });
  const seed = seeds[0];

  const observation = {
    seed_id: seed.id,
    observation_type: candidate.observation_type || 'candidate_discovered',
    observed_at: candidate.observed_at || new Date().toISOString(),
    source_url: normalize(candidate.source_url || candidate.profile_url) || null,
    source_fingerprint: fingerprint({ key, candidate }),
    payload: candidate
  };

  await supabase('seed_observations?on_conflict=seed_id,source_fingerprint', {
    method: 'POST',
    body: JSON.stringify([observation])
  });

  if (lifecycle === 'outreach_ready') {
    await supabase('seed_actions', {
      method: 'POST',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify([{
        seed_id: seed.id,
        action_type: 'draft_personalized_outreach',
        priority: scoring.score,
        payload: { channel: platform.toLowerCase(), reason_codes: scoring.reasons }
      }])
    });
  }

  return { seed_key: key, lifecycle_state: lifecycle, opportunity_score: scoring.score };
}

async function ingestFeeds() {
  const raw = process.env.SEED_DISCOVERY_FEEDS_JSON;
  if (!raw) return [];

  const feeds = JSON.parse(raw);
  const candidates = [];
  for (const feed of feeds) {
    const response = await fetch(feed.url, { headers: feed.headers || {} });
    if (!response.ok) throw new Error(`Feed failed ${feed.url}: ${response.status}`);
    const body = await response.json();
    const items = Array.isArray(body) ? body : body.items || body.candidates || [];
    for (const item of items) candidates.push({ ...item, source_ref: feed.name || feed.url });
  }
  return candidates;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === 'GET' && req.query && req.query.health === '1') {
      return json(res, 200, { agent: 'seed-scout', status: 'ready' });
    }

    const auth = req.headers.authorization || '';
    if (!AGENT_SECRET || auth !== `Bearer ${AGENT_SECRET}`) {
      return json(res, 401, { error: 'unauthorized' });
    }

    const runKey = req.headers['x-run-key'] || `seed-scout:${new Date().toISOString().slice(0, 10)}`;
    const existing = await supabase(`agent_runs?run_key=eq.${encodeURIComponent(runKey)}&select=*`, { method: 'GET' });
    if (existing.length && existing[0].status === 'completed') {
      return json(res, 200, { idempotent_replay: true, run: existing[0] });
    }

    await supabase('agent_runs?on_conflict=run_key', {
      method: 'POST',
      body: JSON.stringify([{ agent_name: 'seed-scout', run_key: runKey, status: 'running' }])
    });

    const body = req.body || {};
    const supplied = Array.isArray(body.candidates) ? body.candidates : [];
    const discovered = req.method === 'GET' ? await ingestFeeds() : [];
    const candidates = [...supplied, ...discovered];
    const results = [];
    const errors = [];

    for (const candidate of candidates) {
      try {
        results.push(await upsertCandidate(candidate, supplied.includes(candidate) ? 'api' : 'feed'));
      } catch (error) {
        errors.push({ candidate: candidate.handle || candidate.primary_handle, error: error.message });
      }
    }

    const status = errors.length ? (results.length ? 'partial' : 'failed') : 'completed';
    await supabase(`agent_runs?run_key=eq.${encodeURIComponent(runKey)}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({
        status,
        finished_at: new Date().toISOString(),
        input_count: candidates.length,
        output_count: results.length,
        error_count: errors.length,
        summary: { results, errors }
      })
    });

    return json(res, errors.length ? 207 : 200, { run_key: runKey, status, results, errors });
  } catch (error) {
    return json(res, 500, { error: error.message });
  }
};

const crypto = require('node:crypto');
const postgres = require('postgres');

const SCOUT_DATABASE_URL = process.env.SCOUT_DATABASE_URL;
const AGENT_SECRET = process.env.AGENT_SECRET;

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function normalize(value) {
  return String(value || '').trim();
}

function canonicalUrl(value) {
  const raw = normalize(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_')) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return raw;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function scoreCandidate(candidate) {
  let score = 10;
  const reasons = [];
  const followers = Number(candidate.follower_count || 0);

  if (candidate.public_picks_detected) { score += 35; reasons.push('public_picks_detected'); }
  if (candidate.profile_url) { score += 10; reasons.push('public_profile_available'); }
  if (followers >= 1000) { score += 10; reasons.push('audience_1k_plus'); }
  if (followers >= 10000) { score += 10; reasons.push('audience_10k_plus'); }
  if (candidate.contact_available) { score += 10; reasons.push('contact_available'); }
  if (candidate.recent_activity) { score += 15; reasons.push('recent_activity'); }

  return { score: Math.min(score, 100), reasons };
}

function buildObservationFingerprint(seedKey, candidate) {
  return digest({
    seed_key: seedKey,
    observation_type: candidate.observation_type || 'candidate_discovered',
    source_url: canonicalUrl(candidate.source_url || candidate.profile_url),
    source_post_id: normalize(candidate.source_post_id || candidate.publication_id) || null,
    published_at: candidate.published_at || candidate.last_public_activity_at || null,
    evidence_key: normalize(candidate.evidence_key || candidate.selection_key) || null
  });
}

function buildActionKey(seedId, actionType, triggerFingerprint) {
  return `${seedId}:${actionType}:${triggerFingerprint}`;
}

function getSql() {
  if (!SCOUT_DATABASE_URL) throw new Error('Missing SCOUT_DATABASE_URL');
  return postgres(SCOUT_DATABASE_URL, {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 10,
    ssl: 'require',
    prepare: false
  });
}

async function upsertCandidate(sql, candidate, sourceType = 'manual') {
  const platform = normalize(candidate.primary_platform || candidate.platform).toLowerCase();
  const handle = normalize(candidate.primary_handle || candidate.handle).replace(/^@/, '').toLowerCase();
  if (!platform || !handle) throw new Error('Candidate requires platform and handle');

  const scoring = scoreCandidate(candidate);
  const seedKey = `${platform}:${handle}`;
  const sourceUrl = canonicalUrl(candidate.source_url || candidate.profile_url);
  const observationFingerprint = buildObservationFingerprint(seedKey, candidate);

  const candidatePayload = {
    ...candidate,
    platform,
    handle,
    profile_url: canonicalUrl(candidate.profile_url),
    opportunity_score: scoring.score,
    score_reasons: scoring.reasons,
    source_type: sourceType,
    source_ref: normalize(candidate.source_ref) || null
  };

  const [seedRow] = await sql`select private.scout_upsert_candidate(${sql.json(candidatePayload)}::jsonb) as value`;
  const seed = seedRow.value;

  await sql`select private.scout_append_observation(
    ${seed.id}::uuid,
    ${candidate.observation_type || 'candidate_discovered'}::text,
    ${candidate.observed_at || new Date().toISOString()}::timestamptz,
    ${sourceUrl}::text,
    ${observationFingerprint}::text,
    ${sql.json(candidate)}::jsonb
  )`;

  if (seed.lifecycle_state === 'outreach_ready') {
    const actionType = 'draft_personalized_outreach';
    const idempotencyKey = buildActionKey(seed.id, actionType, observationFingerprint);
    await sql`select private.scout_queue_action(
      ${seed.id}::uuid,
      ${idempotencyKey}::text,
      ${actionType}::text,
      ${scoring.score}::integer,
      ${sql.json({ channel: platform, reason_codes: scoring.reasons, trigger_fingerprint: observationFingerprint })}::jsonb
    )`;
  }

  return {
    seed_key: seedKey,
    lifecycle_state: seed.lifecycle_state,
    opportunity_score: seed.opportunity_score,
    observation_fingerprint: observationFingerprint
  };
}

async function ingestFeeds() {
  const raw = process.env.SEED_DISCOVERY_FEEDS_JSON;
  if (!raw) return [];

  const feeds = JSON.parse(raw);
  const candidates = [];
  for (const feed of feeds) {
    if (!feed.url || !/^https:\/\//i.test(feed.url)) throw new Error('Discovery feeds must use HTTPS');
    const response = await fetch(feed.url, { headers: feed.headers || {}, signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Feed failed ${feed.url}: ${response.status}`);
    const body = await response.json();
    const items = Array.isArray(body) ? body : body.items || body.candidates || [];
    for (const item of items) candidates.push({ ...item, source_ref: feed.name || feed.url });
  }
  return candidates;
}

module.exports = async function handler(req, res) {
  let sql;
  try {
    if (req.method === 'GET' && req.query && req.query.health === '1') {
      return json(res, 200, { agent: 'seed-scout', status: 'ready' });
    }

    const auth = req.headers.authorization || '';
    if (!AGENT_SECRET || !crypto.timingSafeEqual(
      Buffer.from(auth),
      Buffer.from(`Bearer ${AGENT_SECRET}`)
    )) {
      return json(res, 401, { error: 'unauthorized' });
    }

    sql = getSql();
    const body = req.body || {};
    const supplied = Array.isArray(body.candidates) ? body.candidates : [];
    const discovered = req.method === 'GET' ? await ingestFeeds() : [];
    const candidates = [...supplied.map(item => ({ item, source: 'api' })), ...discovered.map(item => ({ item, source: 'feed' }))];

    const ownerToken = crypto.randomUUID();
    const runKey = req.headers['x-run-key'] || `seed-scout:${new Date().toISOString()}`;
    const [beginRow] = await sql`select private.scout_begin_run(${runKey}::text, ${ownerToken}::uuid, 900) as value`;
    const run = beginRow.value;

    if (!run.acquired) {
      return json(res, run.status === 'completed' ? 200 : 409, {
        run_key: runKey,
        status: run.status,
        acquired: false
      });
    }

    const results = [];
    const errors = [];
    for (const entry of candidates) {
      try {
        results.push(await upsertCandidate(sql, entry.item, entry.source));
      } catch (error) {
        errors.push({ candidate: entry.item.handle || entry.item.primary_handle, error: error.message });
      }
    }

    const status = errors.length ? (results.length ? 'partial' : 'failed') : 'completed';
    await sql`select private.scout_finish_run(
      ${runKey}::text,
      ${ownerToken}::uuid,
      ${status}::text,
      ${candidates.length}::integer,
      ${results.length}::integer,
      ${errors.length}::integer,
      ${sql.json({ results, errors })}::jsonb
    )`;

    return json(res, errors.length ? 207 : 200, { run_key: runKey, status, results, errors });
  } catch (error) {
    return json(res, 500, { error: error.message });
  } finally {
    if (sql) await sql.end({ timeout: 1 }).catch(() => {});
  }
};

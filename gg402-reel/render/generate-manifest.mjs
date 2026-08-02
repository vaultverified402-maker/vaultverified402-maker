import { readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

const [, , recordDataPath, contentHash, outputDirArg] = process.argv;
if (!recordDataPath || !contentHash || !outputDirArg) {
  console.error('Usage: node generate-manifest.mjs <record-data.json> <content-hash> <output-dir>');
  process.exit(1);
}

const d = JSON.parse(readFileSync(resolve(recordDataPath), 'utf-8'));
const outputDir = resolve(outputDirArg);
const manifest = {
  record_id: d.record_id,
  consultant_id: d.consultant_id,
  artifact_type: 'reel_shortform',
  template_version: 'gg402-reel-v1',
  duration_seconds: 10,
  aspect_ratio: '9:16',
  width: 1080,
  height: 1920,
  content_hash: contentHash,
  approval_status: 'required',
  platform_targets: ['tiktok', 'instagram', 'facebook', 'youtube'],
  created_at: new Date().toISOString()
};

const baseFact = `${d.selection}${d.odds ? ` (${d.odds})` : ''} — ${d.event}`;
const handle = `@${d.handle}`;
const url = d.record_url || `https://vaultverified.app/record/${d.record_id}`;
const caption = {
  default: `${handle} preserved a record.\n${baseFact}\nView the canonical record: ${url}`,
  tiktok: `${baseFact}\n\nPreserved and public — ${handle}\n${url}\n#VaultVerified #GG402`,
  instagram: `${baseFact}\n\nPreserved and public before the event. Nothing here is a guarantee — ${handle}\n${url}`,
  facebook: `${handle} filed a public, immutable record.\n${baseFact}\nSee it here: ${url}`,
  youtube: `${baseFact} — a preserved, timestamped public record from ${handle}. ${url}`
};

writeFileSync(join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(join(outputDir, 'caption.json'), JSON.stringify(caption, null, 2));
console.log(JSON.stringify({ ok: true, manifest, caption }, null, 2));

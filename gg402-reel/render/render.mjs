// Render worker for the GG402 reel template.
// Usage:
//   node render.mjs <record-data.json> <output-dir> [--tamper-selection-for-test]

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, renameSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', 'templates', 'reel-v1');
const TEMPLATE_ID = 'gg402-reel';
const TEMPLATE_VERSION = 'reel-v1';
const DURATION_MS = 10_000;
const WIDTH = 1080;
const HEIGHT = 1920;
const REQUIRED_FIELDS = ['record_id', 'event', 'selection', 'status'];
const COMPARE_FIELDS = ['event', 'selection', 'odds', 'status', 'record_id'];

function normalize(value) {
  return String(value ?? '').trim().toUpperCase();
}

async function main() {
  const args = process.argv.slice(2);
  const tamperFlag = args.includes('--tamper-selection-for-test');
  const [recordDataPath, outputDirArg] = args.filter((arg) => !arg.startsWith('--'));

  if (!recordDataPath || !outputDirArg) {
    console.error('Usage: node render.mjs <record-data.json> <output-dir> [--tamper-selection-for-test]');
    process.exit(1);
  }

  const recordData = JSON.parse(readFileSync(resolve(recordDataPath), 'utf-8'));
  const outputDir = resolve(outputDirArg);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const missing = REQUIRED_FIELDS.filter((key) => !String(recordData[key] ?? '').trim());
  if (missing.length) {
    throw new Error(`Missing required record data: ${missing.join(', ')}`);
  }

  const browser = await chromium.launch({ headless: true });

  try {
    // Capture a dedicated static cover in a context with no video
    // recording, preventing a stray second webm in the output folder.
    const coverContext = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
    const coverPage = await coverContext.newPage();
    await coverPage.addInitScript((data) => { window.RECORD_DATA = data; }, recordData);
    await coverPage.goto(`file://${join(TEMPLATE_DIR, 'index.html')}?cover=1`, { waitUntil: 'load' });
    await coverPage.evaluate(() => document.fonts.ready);
    await coverPage.waitForFunction(() => window.REEL_READY === true, { timeout: 5000 });
    await coverPage.screenshot({ path: join(outputDir, 'cover.png') });
    await coverContext.close();

    const context = await browser.newContext({
      viewport: { width: WIDTH, height: HEIGHT },
      recordVideo: { dir: outputDir, size: { width: WIDTH, height: HEIGHT } },
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(`console.error: ${message.text()}`);
    });

    await page.addInitScript((data) => { window.RECORD_DATA = data; }, recordData);
    await page.goto(`file://${join(TEMPLATE_DIR, 'index.html')}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.REEL_READY === true, { timeout: 5000 });

    if (tamperFlag) {
      await page.evaluate(() => {
        const element = document.getElementById('selection-value');
        if (!element) throw new Error('Missing selection-value during negative test');
        element.textContent = 'INTENTIONAL VALIDATION MISMATCH';
      });
    }

    const rendered = await page.evaluate(() => ({
      event: document.getElementById('event-value')?.textContent ?? '',
      selection: document.getElementById('selection-value')?.textContent ?? '',
      odds: document.getElementById('odds-value')?.textContent?.replace(/^ODDS\s*/, '') ?? '',
      status: document.getElementById('status-value')?.textContent ?? '',
      record_id: document.getElementById('record-id-value')?.textContent ?? '',
    }));

    const expected = {
      event: recordData.event,
      selection: recordData.selection,
      odds: recordData.odds ?? '',
      status: recordData.status,
      record_id: recordData.record_id,
    };

    const mismatches = COMPARE_FIELDS.filter(
      (key) => normalize(rendered[key]) !== normalize(expected[key]),
    );

    console.log(JSON.stringify({ validation: 'input-vs-rendered', expected, rendered, mismatches }, null, 2));

    if (mismatches.length) {
      await context.close();
      throw new Error(`Rendered data mismatch on: ${mismatches.join(', ')}`);
    }
    if (pageErrors.length) {
      await context.close();
      throw new Error(`Page errors during render: ${pageErrors.join('; ')}`);
    }

    const video = page.video();
    await page.waitForTimeout(DURATION_MS);
    await context.close();

    const rawPath = await video.path();
    const canonicalPath = join(outputDir, 'reel.raw.webm');
    renameSync(rawPath, canonicalPath);

    writeFileSync(
      join(outputDir, 'validation.json'),
      JSON.stringify({ expected, rendered, mismatches }, null, 2),
    );

    console.log(JSON.stringify({
      ok: true,
      template_id: TEMPLATE_ID,
      template_version: TEMPLATE_VERSION,
      output_dir: outputDir,
      raw_video_path: canonicalPath,
      duration_ms: DURATION_MS,
      deterministic: false,
      tampered_test: tamperFlag,
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }));
  process.exit(1);
});

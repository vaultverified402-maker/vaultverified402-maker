import { chromium } from 'playwright';
import { readFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, '..', 'templates', 'reel-v1');
const DURATION_MS = 10_000;
const WIDTH = 1080;
const HEIGHT = 1920;

function normalizeExpected(recordData) {
  return {
    event: String(recordData.event ?? '').trim(),
    selection: String(recordData.selection ?? '').trim(),
    odds: recordData.odds ? `ODDS ${String(recordData.odds).trim()}` : '',
    status: String(recordData.status || 'PRESERVED').trim().toUpperCase(),
    record_id: String(recordData.record_id ?? '').trim(),
  };
}

async function main() {
  const [, , recordDataPath, outputDirArg, testMode] = process.argv;
  if (!recordDataPath || !outputDirArg) {
    console.error('Usage: node render.mjs <record-data.json> <output-dir> [--tamper-selection-for-test]');
    process.exit(1);
  }

  const recordData = JSON.parse(readFileSync(resolve(recordDataPath), 'utf-8'));
  const required = ['record_id', 'event', 'selection', 'status'];
  const missing = required.filter((key) => !String(recordData[key] ?? '').trim());
  if (missing.length) {
    throw new Error(`Missing required record data: ${missing.join(', ')}`);
  }

  const expected = normalizeExpected(recordData);
  const outputDir = resolve(outputDirArg);
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: outputDir, size: { width: WIDTH, height: HEIGHT } },
  });

  try {
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.addInitScript((data) => { window.RECORD_DATA = data; }, recordData);
    await page.goto(`file://${join(TEMPLATE_DIR, 'index.html')}`, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.REEL_READY === true);

    if (testMode === '--tamper-selection-for-test') {
      await page.evaluate(() => {
        const element = document.getElementById('selection-value');
        if (!element) throw new Error('Missing selection-value during negative test');
        element.textContent = 'INTENTIONAL VALIDATION MISMATCH';
      });
    }

    const rendered = await page.evaluate(() => ({
      event: document.getElementById('event-value')?.textContent?.trim() ?? '',
      selection: document.getElementById('selection-value')?.textContent?.trim() ?? '',
      odds: document.getElementById('odds-value')?.textContent?.trim() ?? '',
      status: document.getElementById('status-value')?.textContent?.trim() ?? '',
      record_id: document.getElementById('record-value')?.textContent?.trim() ?? '',
    }));

    console.log(JSON.stringify({ validation: 'input-vs-rendered', expected, rendered }));

    if (pageErrors.length) {
      throw new Error(`Template error: ${pageErrors.join(' | ')}`);
    }

    const mismatches = Object.keys(expected).filter((key) => rendered[key] !== expected[key]);
    if (mismatches.length) {
      throw new Error(`Rendered data mismatch: ${JSON.stringify({ mismatches, expected, rendered })}`);
    }

    const video = page.video();
    await page.waitForTimeout(DURATION_MS);
    await page.evaluate(() => document.documentElement.classList.add('cover-mode'));
    await page.screenshot({ path: join(outputDir, 'cover.png') });
    await context.close();
    const rawPath = await video.path();
    renameSync(rawPath, join(outputDir, 'reel.raw.webm'));

    console.log(JSON.stringify({ ok: true, output: join(outputDir, 'reel.raw.webm'), duration_ms: DURATION_MS }));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err), stack: err?.stack }));
  process.exit(1);
});

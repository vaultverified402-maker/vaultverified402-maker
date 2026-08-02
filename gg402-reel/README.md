# GG402 Reel

Phase 1 HTML-to-MP4 content-package generator. It does not publish to social platforms.

## Output

A successful manual GitHub Actions run produces:

- `reel.mp4`
- `cover.png`
- `manifest.json`
- `caption.json`
- `validation.json`

Artifacts are retained for one day and include the GitHub run ID in the artifact name.

## Workflow

Use **Actions → Render GG402 Reel → Run workflow** and supply the record fields.

The workflow:

1. Builds `record-data.json` safely from environment variables.
2. Runs a deliberate negative test through the same renderer and validator.
3. Renders the real HTML reel in Chromium.
4. Verifies event, selection, odds, status, and record ID against the DOM.
5. Converts the Playwright WebM to H.264/AAC MP4.
6. Generates the manifest and platform caption package.
7. Uploads the temporary review artifact.

## Architecture

```text
record data
→ HTML/CSS template
→ Playwright browser capture
→ FFmpeg MP4 conversion
→ manifest and captions
```

HTML/CSS is the creative source of truth. The MP4 is a temporary social distribution file, not a preserved Vault Verified record artifact.

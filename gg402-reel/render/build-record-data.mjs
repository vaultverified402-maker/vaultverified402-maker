// Reads record fields from environment variables (set via GitHub
// Actions' `env:` block, which passes literal string values — never
// shell-reinterpreted) and serializes with JSON.stringify, which
// correctly escapes quotes, backslashes, and newlines.

const data = {
  record_id: process.env.RECORD_ID || '',
  consultant_id: process.env.CONSULTANT_ID || '',
  handle: process.env.HANDLE || '',
  event: process.env.EVENT_TEXT || '',
  selection: process.env.SELECTION_TEXT || '',
  odds: process.env.ODDS_TEXT || '',
  status: process.env.STATUS_TEXT || 'preserved',
  record_url: `https://vaultverified.app/record/${process.env.RECORD_ID || ''}`,
};

process.stdout.write(JSON.stringify(data, null, 2));

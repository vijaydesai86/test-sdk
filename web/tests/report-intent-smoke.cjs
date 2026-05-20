/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

process.env.VERCEL = '1';
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const jiti = createJiti(__filename);
const { inferReportFallback } = jiti(path.join(process.cwd(), 'app/lib/reportIntent.ts'));

function assertFallback(message, toolName, fields = {}) {
  const fallback = inferReportFallback(message);
  assert.ok(fallback, `expected fallback for: ${message}`);
  assert.equal(fallback.toolName, toolName, `wrong tool for: ${message}`);
  for (const [key, expected] of Object.entries(fields)) {
    assert.equal(fallback.args[key], expected, `wrong ${key} for: ${message}`);
  }
  return fallback;
}

function assertNoFallback(message) {
  assert.equal(inferReportFallback(message), null, `did not expect report fallback for: ${message}`);
}

function main() {
  assertFallback('Give me a stock report on Arm Holdings', 'generate_stock_report');
  assertFallback('Should I buy Arm?', 'generate_stock_report');
  assertFallback('Deep dive Arm Holdings', 'generate_stock_report');
  assertFallback('How does ARM look?', 'generate_stock_report');
  assertFallback('Arm Holdings', 'generate_stock_report');
  assertFallback('ARM', 'generate_stock_report');

  assertFallback('Compare Nvidia, AMD, and Intel', 'generate_research_report');
  assertFallback('Nvidia vs AMD vs Intel', 'generate_research_report');
  assertFallback('Deep research on AI infrastructure stocks', 'generate_research_report');

  assertFallback('Generate daily report for my watchlist', 'generate_watchlist_daily_report');
  assertFallback('portfolio pulse please', 'generate_watchlist_daily_report');

  assertNoFallback('What is a price to earnings ratio?');
  assertNoFallback('How does P/E work?');
  assertNoFallback('hello');

  console.log('report intent smoke tests passed');
}

main();

/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('assert/strict');
const path = require('path');
const { createJiti } = require('jiti');

const jiti = createJiti(__filename);
const {
  formatRecentRequestForMemory,
  isReportGeneratingRequest,
  neutralizeHistoricalReportRequests,
  planReportToolExecution,
} = jiti(path.join(process.cwd(), 'app/lib/reportReplayGuard.ts'));

function toolCall(id, name, args = {}) {
  return {
    id,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function testHistoricalReportRequestsAreCompletedNotes() {
  const messages = neutralizeHistoricalReportRequests([
    { role: 'system', content: 'system' },
    { role: 'user', content: 'Give me a stock report on Arm Holdings' },
    { role: 'assistant', content: 'The report has been saved.' },
    { role: 'user', content: 'What is a P/E ratio?' },
  ]);

  assert.equal(messages[1].role, 'assistant');
  assert.match(messages[1].content, /Completed previous report request; do not rerun/);
  assert.match(messages[1].content, /Arm Holdings/);
  assert.equal(messages[3].role, 'user');
  assert.equal(messages[3].content, 'What is a P/E ratio?');
}

function testMemorySummaryDoesNotReplayReportRequests() {
  assert.equal(isReportGeneratingRequest('Generate daily report for my watchlist'), true);
  assert.match(
    formatRecentRequestForMemory('Generate daily report for my watchlist'),
    /^Completed previous report request; do not rerun:/
  );
  assert.equal(
    formatRecentRequestForMemory('What is a price to earnings ratio?'),
    'Recent user request: What is a price to earnings ratio?'
  );
}

function testOnlyCurrentReportToolCanSave() {
  const plan = planReportToolExecution(
    [
      toolCall('old-stock', 'generate_stock_report', { symbol: 'ARM' }),
      toolCall('current-watchlist', 'generate_watchlist_daily_report', { range: '1y' }),
      toolCall('old-research', 'generate_research_report', { sector: 'AI infrastructure' }),
      toolCall('data', 'get_stock_price', { symbol: 'NVDA' }),
    ],
    'Generate daily report for my watchlist'
  );

  assert.equal(plan.allowedReportToolName, 'generate_watchlist_daily_report');
  assert.equal(plan.skippedReportToolCallIds.has('old-stock'), true);
  assert.equal(plan.skippedReportToolCallIds.has('old-research'), true);
  assert.equal(plan.skippedReportToolCallIds.has('current-watchlist'), false);
  assert.equal(plan.skippedReportToolCallIds.has('data'), false);
}

function testReportAlreadySavedSkipsFurtherReportTools() {
  const plan = planReportToolExecution(
    [
      toolCall('next-report', 'generate_stock_report', { symbol: 'MSFT' }),
      toolCall('data', 'search_stock', { query: 'Microsoft' }),
    ],
    'Report on Microsoft',
    { reportAlreadySaved: true }
  );

  assert.equal(plan.skippedReportToolCallIds.has('next-report'), true);
  assert.equal(plan.skippedReportToolCallIds.has('data'), false);
}

function main() {
  testHistoricalReportRequestsAreCompletedNotes();
  testMemorySummaryDoesNotReplayReportRequests();
  testOnlyCurrentReportToolCanSave();
  testReportAlreadySavedSkipsFurtherReportTools();
  console.log('report replay guard smoke tests passed');
}

main();

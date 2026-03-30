/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import type { DataTrustSummary, DecisionSnapshot, PortfolioProfile, WatchlistPositionMeta } from './investmentTypes';

type PricePoint = { date: string; close: string | number };
type EarningsPoint = { fiscalQuarter: string; reportedEPS: string | number };
type ActionLabel = 'Buy' | 'Hold' | 'Watch' | 'Sell';
type OwnerAction = 'Add' | 'Hold' | 'Trim' | 'Sell';
type NonOwnerAction = 'Buy' | 'Watch' | 'Avoid';

export interface StockReportData {
  symbol: string;
  generatedAt: string;
  price: any;
  priceHistory?: { prices?: PricePoint[] };
  companyOverview?: any;
  basicFinancials?: any;
  earningsHistory?: { quarterlyEarnings?: EarningsPoint[] };
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
  analystRatings?: any;
  analystRecommendations?: any;
  insiderTrading?: any;
  priceTargets?: any;
  peers?: any;
  newsSentiment?: any;
  companyNews?: { articles?: any[] };
  /** LLM-generated competitive moat assessment */
  moatAnalysis?: MoatAnalysis;
  /** LLM-generated rich investment conclusion narrative (full markdown text) */
  llmConclusion?: string;
  dataTrust?: DataTrustSummary;
  decisionSnapshot?: DecisionSnapshot;
  portfolioProfile?: PortfolioProfile;
  watchlistPosition?: Partial<WatchlistPositionMeta>;
}

export interface ComparisonReportItem {
  symbol: string;
  price?: any;
  overview?: any;
  basicFinancials?: any;
  insiderTrading?: any;
  priceTargets?: any;
  priceHistory?: { prices?: PricePoint[] };
  incomeStatement?: any;
  balanceSheet?: any;
  cashFlow?: any;
  analystRatings?: any;
  peers?: any;
  newsSentiment?: any;
  companyNews?: { articles?: any[] };
  /** LLM-generated competitive moat assessment */
  moatAnalysis?: MoatAnalysis;
  dataTrust?: DataTrustSummary;
  decisionSnapshot?: DecisionSnapshot;
}

export interface ComparisonReportData {
  generatedAt: string;
  range: string;
  universe: string[];
  items: ComparisonReportItem[];
  notes?: string[];
  sources?: Record<string, Record<string, string>>;
  /** LLM-generated rich investment conclusion narrative (full markdown text) */
  llmConclusion?: string;
}

export interface SectorReportData extends ComparisonReportData {
  /** The original sector/theme query, e.g. "AI data center" */
  sectorQuery: string;
  /** How the universe was selected */
  selectedBy?: 'llm' | 'manual';
}

export interface DeepSectorReportData extends SectorReportData {
  /** The broad initial candidate list before refinement */
  initialCandidates?: string[];
  /** LLM-generated narrative covering supply chain, customer, market and news dependencies */
  dependencyAnalysis?: string;
  /** Mermaid diagram source for the sector ecosystem map */
  ecosystemDiagram?: string;
  /** LLM rationale for which companies were kept / excluded in the refinement step */
  refinementNotes?: string;
  /** Per-company 1-2 sentence investment thesis for each company in the final refined list */
  companySnapshots?: Record<string, string>;
}
export interface WatchlistDailyReportItem {
  symbol: string;
  companyName?: string;
  stock: StockReportData;
  action?: ActionLabel | 'Wait';
  reason?: string;
}

export interface WatchlistDailyReportData {
  generatedAt: string;
  watchlistName: string;
  items: WatchlistDailyReportItem[];
}

/**
 * LLM-generated competitive moat assessment for a single company.
 * The moat framework follows Warren Buffett's five economic-moat sources.
 */
export interface MoatAnalysis {
  /** Primary moat category, e.g. "Network Effects", "Cost Advantage", "Switching Costs",
   *  "Intangible Assets", "Efficient Scale", "Mixed", or "None" */
  moatType: string;
  /** Overall moat width: "Wide" (durable 10+ yr advantage), "Narrow" (3-10 yr), or "None" */
  moatStrength: string;
  /** Composite moat score 0-100. 0-30 = none, 31-60 = narrow, 61-100 = wide */
  moatScore: number;
  /** Specific, concrete barriers, e.g. "Apple ecosystem lock-in", "AWS scale economics" */
  barriers: string[];
  /** 2-4 sentence descriptive narrative explaining moat sources and their sustainability */
  narrative: string;
  /** 1-2 sentences: what this company excels at and who/what it is best for */
  bestFor: string;
}

const DEFAULT_REPORTS_DIR =
  process.env.REPORTS_DIR || (process.env.VERCEL ? '/tmp/reports' : 'reports');

function formatDateLabel(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    return date.slice(0, 10);
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: '2-digit',
  }).format(parsed);
}

function downsample<T>(items: T[], maxPoints: number): T[] {
  if (items.length <= maxPoints) return items;
  const result: T[] = [];
  const step = (items.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i += 1) {
    result.push(items[Math.round(i * step)]);
  }
  return result;
}

function formatChartNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) >= 1000) {
    return Number(value.toFixed(0));
  }
  return Number(value.toFixed(2));
}

function buildPriceChart(prices: PricePoint[] = []): string {
  if (prices.length === 0) return '';
  const series = downsample([...prices].reverse(), 60);
  const labels = series.map((p) => formatDateLabel(p.date));
  const values = series.map((p) => formatChartNumber(Number(p.close)));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Price History', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'Closing Price (Daily)',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        areaStyle: { opacity: 0.2 },
        data: filtered.values,
      },
    ],
  });
}

function buildEpsChart(earnings: EarningsPoint[] = []): string {
  if (earnings.length === 0) return '';
  const series = downsample([...earnings].reverse(), 20);
  const labels = series.map((e) => formatDateLabel(e.fiscalQuarter));
  const values = series.map((e) => formatChartNumber(Number(e.reportedEPS)));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Quarterly EPS', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'Reported EPS (Quarter)',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: filtered.values,
      },
    ],
  });
}

function buildPeChart(prices: PricePoint[] = [], earnings: EarningsPoint[] = []): string {
  if (prices.length === 0 || earnings.length < 4) return '';
  const sortedPrices = [...prices]
    .map((point) => ({
      date: point.date,
      value: toNumber(point.close),
    }))
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedPrices.length === 0) return '';

  const sortedEarnings = [...earnings]
    .map((point) => ({
      date: point.fiscalQuarter,
      value: toNumber(point.reportedEPS),
    }))
    .filter((point): point is { date: string; value: number } => point.value !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sortedEarnings.length < 4) return '';

  const findClosestPrice = (date: string): number | null => {
    const target = new Date(date).getTime();
    if (Number.isNaN(target)) return null;
    let closest: { diff: number; value: number } | null = null;
    for (const point of sortedPrices) {
      const time = new Date(point.date).getTime();
      if (Number.isNaN(time)) continue;
      const diff = Math.abs(time - target);
      if (!closest || diff < closest.diff) {
        closest = { diff, value: point.value };
      }
    }
    return closest?.value ?? null;
  };

  const pePoints: Array<{ date: string; value: number }> = [];
  for (let index = 3; index < sortedEarnings.length; index += 1) {
    const window = sortedEarnings.slice(index - 3, index + 1);
    const ttmEps = window.reduce((sum, point) => sum + point.value, 0);
    if (ttmEps <= 0) continue;
    const price = findClosestPrice(sortedEarnings[index].date);
    if (price === null) continue;
    pePoints.push({
      date: sortedEarnings[index].date,
      value: price / ttmEps,
    });
  }
  if (pePoints.length === 0) return '';

  const series = downsample(pePoints, 16);
  const labels = series.map((point) => formatDateLabel(point.date));
  const values = series.map((point) => formatChartNumber(point.value));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'P/E Trend (TTM)', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true, name: 'P/E' },
    series: [
      {
        name: 'P/E',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: filtered.values,
      },
    ],
  });
}

function buildRevenueChart(incomeStatement?: any): string {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length === 0) return '';
  const series = downsample(reports.slice(0, 12).reverse(), 8);
  const labels = series.map((r: any) => formatDateLabel(r.fiscalQuarter || r.fiscalYear || r.fiscalDateEnding || ''));
  const values = series.map((r: any) => formatChartNumber(Number(r.totalRevenue)));
  const filtered = filterSeries(labels, values);

  if (filtered.values.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Revenue Trend', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true },
    series: [
      {
        name: 'Revenue',
        type: 'bar',
        data: filtered.values,
        barMaxWidth: 32,
      },
    ],
  });
}

function buildMarginChart(incomeStatement?: any): string {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length === 0) return '';
  const series = downsample(reports.slice(0, 12).reverse(), 8);
  const labels = series.map((r: any) => formatDateLabel(r.fiscalQuarter || r.fiscalYear || r.fiscalDateEnding || ''));
  const grossMargins = series.map((r: any) => {
    const revenue = Number(r.totalRevenue);
    const gross = Number(r.grossProfit);
    if (!revenue || Number.isNaN(revenue) || Number.isNaN(gross)) return 0;
    return formatChartNumber((gross / revenue) * 100);
  });
  const operatingMargins = series.map((r: any) => {
    const revenue = Number(r.totalRevenue);
    const operating = Number(r.operatingIncome);
    if (!revenue || Number.isNaN(revenue) || Number.isNaN(operating)) return 0;
    return formatChartNumber((operating / revenue) * 100);
  });
  const grossFiltered = filterSeries(labels, grossMargins);
  const operatingFiltered = filterSeries(labels, operatingMargins);
  if (grossFiltered.labels.length === 0 && operatingFiltered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: 'Margin Trends', left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: labels },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
    series: [
      {
        name: 'Gross Margin',
        type: 'line',
        smooth: true,
        data: grossMargins,
      },
      {
        name: 'Operating Margin',
        type: 'line',
        smooth: true,
        data: operatingMargins,
      },
    ],
    legend: { bottom: 0 },
  });
}

function buildTargetDistribution(priceTargets?: any): string {
  if (!priceTargets) return '';
  const low = toNumber(priceTargets.targetLow);
  const mean = toNumber(priceTargets.targetMean);
  const median = toNumber(priceTargets.targetMedian);
  const high = toNumber(priceTargets.targetHigh);
  const points = [
    { symbol: 'Low', value: low },
    { symbol: 'Mean', value: mean },
    { symbol: 'Median', value: median },
    { symbol: 'High', value: high },
  ].filter((item) => item.value !== null) as { symbol: string; value: number }[];

  return buildBarChart('Analyst Target Distribution', 'Price', points);
}

function buildBarChart(title: string, label: string, items: { symbol: string; value: number }[]): string {
  if (items.length === 0) return '';
  const labels = items.map((item) => item.symbol);
  const values = items.map((item) => formatChartNumber(item.value));
  const filtered = filterSeries(labels, values);
  if (filtered.labels.length === 0) return '';

  return buildChartBlock({
    title: { text: title, left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category', data: filtered.labels },
    yAxis: { type: 'value', scale: true, name: label },
    series: [
      {
        name: label,
        type: 'bar',
        data: filtered.values,
        barMaxWidth: 32,
      },
    ],
  });
}

function buildComparisonPerformanceChart(items: ComparisonReportItem[], title: string): string {
  const series = items
    .map((item) => {
      const prices = item.priceHistory?.prices || [];
      if (prices.length < 2) return null;
      const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
      const base = toNumber(sorted[0].close);
      if (!base) return null;
      const sampled = downsample(sorted, 60);
      return {
        name: item.symbol,
        data: sampled.map((point) => {
          const value = toNumber(point.close);
          if (!value) return null;
          return [formatDateLabel(point.date), Number(((value / base) * 100).toFixed(2))];
        }).filter((row): row is [string, number] => row !== null),
      };
    })
    .filter((row): row is { name: string; data: [string, number][] } => row !== null && row.data.length > 0);

  if (series.length === 0) return '';

  return buildChartBlock({
    title: { text: title, left: 'center' },
    tooltip: { trigger: 'axis' },
    grid: { left: 40, right: 20, top: 50, bottom: 40 },
    xAxis: { type: 'category' },
    yAxis: { type: 'value', name: 'Index (Base=100)' },
    legend: { bottom: 0 },
    series: series.map((row) => ({
      name: row.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: row.data,
    })),
  });
}

function buildChartBlock(option: Record<string, any>): string {
  return ['```chart', JSON.stringify(applyChartTheme(option), null, 2), '```'].join('\n');
}

function filterSeries(labels: string[], values: number[]) {
  return labels.reduce<{ labels: string[]; values: number[] }>((acc, label, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) return acc;
    acc.labels.push(label);
    acc.values.push(value);
    return acc;
  }, { labels: [], values: [] });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || /^n\/a$/i.test(trimmed) || trimmed === '-' || trimmed === '—') {
      return null;
    }
    const cleaned = trimmed
      .replace(/[$£€,]/g, '')
      .replace(/%$/g, '')
      .replace(/^\((.+)\)$/, '-$1');
    const num = Number(cleaned);
    if (Number.isNaN(num)) return null;
    return num;
  }
  const num = Number(value);
  if (Number.isNaN(num)) return null;
  return num;
}

function normalizePercent(value: unknown): number | null {
  const num = toNumber(value);
  if (num === null) return null;
  if (num <= 1 && num >= -1) return num * 100;
  return num;
}

function formatNumber(value: unknown, decimals = 2): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  return num.toFixed(decimals);
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatMarketCap(value: unknown): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  if (num >= 1e9) {
    return `${trimTrailingZeros((num / 1e9).toFixed(2))}B`;
  }
  if (num >= 1e6) {
    return `${trimTrailingZeros((num / 1e6).toFixed(2))}M`;
  }
  return trimTrailingZeros(num.toFixed(0));
}

function formatPercent(value: unknown, decimals = 1): string {
  const num = normalizePercent(value);
  if (num === null) return 'N/A';
  return `${num.toFixed(decimals)}%`;
}

function formatSignedPercentValue(value: unknown, decimals = 2, options?: { alreadyPercent?: boolean }): string {
  const num = options?.alreadyPercent ? toNumber(value) : normalizePercent(value);
  if (num === null) return 'N/A';
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

function formatPrice(value: unknown, decimals = 2): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  return `$${num.toFixed(decimals)}`;
}

function formatCurrency(value: unknown): string {
  const formatted = formatMarketCap(value);
  if (formatted === 'N/A') return 'N/A';
  return `$${formatted}`;
}

function formatCompactNumber(value: unknown): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  if (Math.abs(num) >= 1e9) {
    return `${trimTrailingZeros((num / 1e9).toFixed(2))}B`;
  }
  if (Math.abs(num) >= 1e6) {
    return `${trimTrailingZeros((num / 1e6).toFixed(2))}M`;
  }
  return new Intl.NumberFormat('en-US').format(Math.round(num));
}

function getMetricValue(metrics: any, keys: string[]): number | null {
  for (const key of keys) {
    const value = toNumber(metrics?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function summarizeDescription(description: string, maxSentences = 2): string {
  const sentences = description.split('. ').filter(Boolean);
  if (sentences.length <= maxSentences) return description.trim();
  const snippet = sentences.slice(0, maxSentences).join('. ');
  return snippet.endsWith('.') ? snippet : `${snippet}.`;
}

function extractThemes(text?: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const themes = [
    { label: 'AI / ML', pattern: /(ai|artificial intelligence|machine learning)/ },
    { label: 'Data Center', pattern: /(data center|datacenter|hyperscale)/ },
    { label: 'Mobile & Consumer', pattern: /(mobile|smartphone|consumer|handset)/ },
    { label: 'Automotive', pattern: /(automotive|vehicle|car|autonomous)/ },
    { label: 'IoT / Edge', pattern: /(iot|edge|embedded)/ },
    { label: 'Cloud & SaaS', pattern: /(cloud|saas|subscription|platform)/ },
    { label: 'Licensing / IP', pattern: /(licensing|royalty|ip core)/ },
    { label: 'Security', pattern: /(security|trust|secure)/ },
  ];
  return themes.filter((theme) => theme.pattern.test(lower)).map((theme) => theme.label);
}

function getReportCollection(reportSet?: any): any[] {
  const quarterly = Array.isArray(reportSet?.quarterlyReports) ? reportSet.quarterlyReports : [];
  const annual = Array.isArray(reportSet?.annualReports) ? reportSet.annualReports : [];
  return quarterly.length ? quarterly : annual;
}

function hasMeaningfulValue(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed.toUpperCase() === "N/A" || trimmed === "--") return false;
    const numeric = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(numeric) || trimmed.length > 0;
  }
  return true;
}

function countReportFields(report: any, fields: string[]): number {
  return fields.reduce((count, field) => count + (hasMeaningfulValue(report?.[field]) ? 1 : 0), 0);
}

function getLatestReport(reportSet?: any): any | null {
  const reports = getReportCollection(reportSet);
  if (!reports.length) return null;
  return reports[0];
}

function getMostCompleteReport(reportSet: any, fields: string[]): any | null {
  const reports = getReportCollection(reportSet);
  if (!reports.length) return null;
  let best = reports[0];
  let bestScore = countReportFields(best, fields);
  for (const report of reports.slice(1)) {
    const score = countReportFields(report, fields);
    if (score > bestScore) {
      best = report;
      bestScore = score;
      if (bestScore >= fields.length) break;
    }
  }
  return best;
}

function getRecentReports(reportSet: any, fields: string[], limit: number): any[] {
  const reports = getReportCollection(reportSet);
  return reports
    .filter((report) => countReportFields(report, fields) > 0)
    .slice(0, limit);
}

function deriveFreeCashFlow(report: any): number | null {
  const direct = toNumber(report?.freeCashFlow);
  if (direct !== null) return direct;
  const operating = toNumber(report?.operatingCashflow);
  const capex = toNumber(report?.capitalExpenditures);
  if (operating === null || capex === null) return null;
  return operating - Math.abs(capex);
}

function formatPeriodLabel(report: any): string {
  return report?.fiscalQuarter || report?.fiscalYear || report?.fiscalDateEnding || 'N/A';
}

function buildTable(headers: string[], rows: string[][], alignments?: Array<'left' | 'center' | 'right'>): string {
  const headerRow = `| ${headers.join(' | ')} |`;
  const safeAlignments = alignments && alignments.length === headers.length
    ? alignments
    : headers.map(() => 'left');
  const dividerRow = `| ${safeAlignments.map((alignment) => {
    if (alignment === 'right') return '---:';
    if (alignment === 'center') return ':---:';
    return '---';
  }).join(' | ')} |`;
  return [headerRow, dividerRow, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
}

function hasMeaningfulTableValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'n/a' && normalized !== '—' && normalized !== 'unavailable';
}

function buildPositionGuidanceTable(rows: Array<{ company: string; guidance: PositionGuidance }>): string {
  return buildTable(
    ['Company', 'Signal', 'Confidence', 'For owners', 'For non-owners', 'Why'],
    rows.map(({ company, guidance }) => [
      company,
      guidance.stance,
      guidance.confidence,
      guidance.forOwners,
      describeNonOwnerAction(guidance.forNonOwners),
      guidance.rationale,
    ]),
    ['left', 'left', 'left', 'left', 'left', 'left']
  );
}

function applyAxisTheme(axis: any): any {
  if (!axis) return axis;
  return {
    ...axis,
    axisLine: {
      ...(axis.axisLine || {}),
      lineStyle: { color: '#94a3b8', ...(axis.axisLine?.lineStyle || {}) },
    },
    axisTick: {
      ...(axis.axisTick || {}),
      lineStyle: { color: '#94a3b8', ...(axis.axisTick?.lineStyle || {}) },
    },
    axisLabel: { color: '#475569', fontSize: 11, ...(axis.axisLabel || {}) },
    splitLine: {
      ...(axis.splitLine || {}),
      lineStyle: { color: '#e2e8f0', ...(axis.splitLine?.lineStyle || {}) },
    },
  };
}

function applyChartTheme(option: Record<string, any>): Record<string, any> {
  const base = {
    backgroundColor: '#ffffff',
    color: ['#6366f1', '#14b8a6', '#f59e0b', '#ef4444', '#0ea5e9', '#a855f7'],
    textStyle: {
      fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
      color: '#0f172a',
    },
    title: {
      left: 'center',
      top: 8,
      textStyle: { color: '#0f172a', fontSize: 14, fontWeight: 600 },
    },
    tooltip: {
      backgroundColor: '#0f172a',
      borderColor: '#1e293b',
      textStyle: { color: '#f8fafc' },
    },
    legend: { textStyle: { color: '#475569' } },
  };

  const themed = { ...base, ...option };
  const mergedTitle = option.title
    ? {
        ...base.title,
        ...option.title,
        show: false,
        textStyle: { ...base.title.textStyle, ...(option.title.textStyle || {}) },
      }
    : { ...base.title, show: false };

  return {
    ...themed,
    title: mergedTitle,
    grid: {
      left: 50,
      right: 24,
      top: 40,
      bottom: 50,
      containLabel: true,
      ...(option.grid || {}),
    },
    tooltip: { ...base.tooltip, ...(option.tooltip || {}) },
    legend: { ...base.legend, ...(option.legend || {}) },
    xAxis: Array.isArray(option.xAxis)
      ? option.xAxis.map((axis: any) => applyAxisTheme(axis))
      : applyAxisTheme(option.xAxis),
    yAxis: Array.isArray(option.yAxis)
      ? option.yAxis.map((axis: any) => applyAxisTheme(axis))
      : applyAxisTheme(option.yAxis),
  };
}

function getStockRevenueGrowth(data: StockReportData): number | null {
  const metric = getMetricValue(data.basicFinancials?.metric, [
    'revenueGrowthTTM',
    'revenueGrowthAnnual',
    'revenueGrowth5Y',
  ]);
  return normalizePercent(metric ?? data.companyOverview?.quarterlyRevenueGrowth);
}

function getStockEpsGrowth(data: StockReportData): number | null {
  const metric = getMetricValue(data.basicFinancials?.metric, ['epsGrowthTTM', 'epsGrowthAnnual']);
  return normalizePercent(metric ?? data.companyOverview?.quarterlyEarningsGrowth);
}

function getTargetUpsideStock(data: StockReportData): number | null {
  const price = toNumber(data.price?.price);
  const target = toNumber(
    data.priceTargets?.targetMean
    ?? (data.analystRatings?.analystTargetPrice !== 'N/A' ? data.analystRatings?.analystTargetPrice : null)
    ?? data.companyOverview?.analystTargetPrice
  );
  if (!price || !target) return null;
  return ((target - price) / price) * 100;
}

function buildScorecardRadar(scorecard: ReturnType<typeof computeScorecard>): string {
  const entries = [
    { label: 'Growth', value: scorecard.components.growth },
    { label: 'Profitability', value: scorecard.components.profitability },
    { label: 'Valuation', value: scorecard.components.valuation },
    { label: 'Momentum', value: scorecard.components.momentum },
    { label: 'Moat', value: scorecard.components.moat },
  ].filter((entry) => entry.value !== null);

  if (entries.length === 0) return '';

  const indicators = entries.map((entry) => ({ name: entry.label, max: 100 }));
  const values = entries.map((entry) => Number((entry.value as number).toFixed(1)));

  return buildChartBlock({
    title: { text: 'Scorecard Radar', left: 'center' },
    tooltip: { trigger: 'item' },
    radar: {
      indicator: indicators,
      radius: '65%',
      splitNumber: 4,
      axisName: { color: '#334155', fontSize: 12 },
      splitLine: { lineStyle: { color: '#cbd5f5' } },
      axisLine: { lineStyle: { color: '#cbd5f5' } },
      splitArea: { areaStyle: { color: ['#f8fafc', '#eef2ff'] } },
    },
    series: [
      {
        name: 'Scorecard',
        type: 'radar',
        data: [{ value: values, name: 'Scorecard' }],
        areaStyle: { opacity: 0.2 },
        lineStyle: { width: 2 },
        symbolSize: 6,
      },
    ],
  });
}

function computePriceChange(prices: PricePoint[] = []): number | null {
  if (prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (!first || !last) return null;
  return ((last - first) / first) * 100;
}

function computeSimpleMovingAverage(prices: PricePoint[] = [], window: number): number | null {
  if (prices.length < window) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < window) return null;
  const slice = closes.slice(-window);
  const total = slice.reduce((sum, value) => sum + value, 0);
  return total / slice.length;
}

function computeRsi(prices: PricePoint[] = [], period = 14): number | null {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - period; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return 100;
  const rs = averageGain / averageLoss;
  return 100 - (100 / (1 + rs));
}

function computeEMA(prices: PricePoint[], period: number): number[] {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < period) return [];
  const multiplier = 2 / (period + 1);
  const ema: number[] = new Array(closes.length).fill(NaN);
  let smaSum = 0;
  for (let i = 0; i < period; i += 1) smaSum += closes[i];
  ema[period - 1] = smaSum / period;
  for (let i = period; i < closes.length; i += 1) {
    ema[i] = (closes[i] - ema[i - 1]) * multiplier + ema[i - 1];
  }
  return ema;
}

function computeMACD(prices: PricePoint[]): { macd: number | null; signal: number | null; histogram: number | null; trend: string } {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < 26 + 9) return { macd: null, signal: null, histogram: null, trend: "Unavailable" };

  const pricePoints: PricePoint[] = closes.map((c, i) => ({ date: String(i), close: c }));
  const ema12 = computeEMA(pricePoints, 12);
  const ema26 = computeEMA(pricePoints, 26);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i += 1) {
    if (isNaN(ema12[i]) || isNaN(ema26[i])) {
      macdLine.push(NaN);
    } else {
      macdLine.push(ema12[i] - ema26[i]);
    }
  }

  // Compute signal line as EMA(9) of the MACD values (skip NaN prefix)
  const validMacd = macdLine.filter((v) => !isNaN(v));
  if (validMacd.length < 9) return { macd: null, signal: null, histogram: null, trend: "Unavailable" };

  const macdPoints: PricePoint[] = validMacd.map((v, i) => ({ date: String(i), close: v }));
  const signalEma = computeEMA(macdPoints, 9);

  const latestMacd = validMacd[validMacd.length - 1];
  const latestSignal = signalEma[signalEma.length - 1];
  if (isNaN(latestSignal)) return { macd: latestMacd, signal: null, histogram: null, trend: "Unavailable" };

  const histogram = latestMacd - latestSignal;
  const trend = latestMacd > latestSignal ? "Bullish" : latestMacd < latestSignal ? "Bearish" : "Neutral";
  return { macd: latestMacd, signal: latestSignal, histogram, trend };
}

function computeBollingerBands(
  prices: PricePoint[],
  period = 20,
  stdDev = 2,
): { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null; percentB: number | null } {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < period) return { upper: null, middle: null, lower: null, bandwidth: null, percentB: null };

  const slice = closes.slice(-period);
  const middle = slice.reduce((s, v) => s + v, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  const bandwidth = middle !== 0 ? ((upper - lower) / middle) * 100 : null;
  const currentPrice = closes[closes.length - 1];
  const percentB = upper !== lower ? ((currentPrice - lower) / (upper - lower)) * 100 : null;
  return { upper, middle, lower, bandwidth, percentB };
}

function computeStochastic(
  prices: PricePoint[],
  kPeriod = 14,
  dPeriod = 3,
): { k: number | null; d: number | null; state: string } {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < kPeriod + dPeriod - 1) return { k: null, d: null, state: "Unavailable" };

  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i += 1) {
    const window = closes.slice(i - kPeriod + 1, i + 1);
    const highest = Math.max(...window);
    const lowest = Math.min(...window);
    kValues.push(highest === lowest ? 100 : ((closes[i] - lowest) / (highest - lowest)) * 100);
  }

  // %D = SMA of %K over dPeriod
  if (kValues.length < dPeriod) return { k: null, d: null, state: "Unavailable" };
  const dSlice = kValues.slice(-dPeriod);
  const d = dSlice.reduce((s, v) => s + v, 0) / dPeriod;
  const k = kValues[kValues.length - 1];
  const state = k > 80 ? "Overbought" : k < 20 ? "Oversold" : "Neutral";
  return { k, d, state };
}

function computeATR(prices: PricePoint[], period = 14): number | null {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const closes = sorted
    .map((point) => toNumber(point.close))
    .filter((value): value is number => value !== null);
  if (closes.length < period + 1) return null;
  const trValues: number[] = [];
  for (let i = 1; i < closes.length; i += 1) {
    trValues.push(Math.abs(closes[i] - closes[i - 1]));
  }
  const slice = trValues.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / period;
}

/** Exported for reuse in stockTools.ts */
export function computeVolumeAnalysis(priceHistory: any): { avgVolume20: number | null; relativeVolume: number | null; volumeTrend: string } {
  if (!Array.isArray(priceHistory) || priceHistory.length === 0) {
    return { avgVolume20: null, relativeVolume: null, volumeTrend: "N/A" };
  }
  const volumes = priceHistory
    .map((p: any) => (p && typeof p.volume !== "undefined" ? toNumber(p.volume) : null))
    .filter((v: number | null): v is number => v !== null && v > 0);
  if (volumes.length === 0) return { avgVolume20: null, relativeVolume: null, volumeTrend: "N/A" };
  const recent = volumes.slice(-20);
  const avgVolume20 = recent.reduce((s: number, v: number) => s + v, 0) / recent.length;
  const latestVolume = volumes[volumes.length - 1];
  const relativeVolume = avgVolume20 > 0 ? latestVolume / avgVolume20 : null;
  const volumeTrend =
    relativeVolume === null ? "N/A" : relativeVolume > 1.5 ? "Above Average" : relativeVolume < 0.5 ? "Below Average" : "Normal";
  return { avgVolume20, relativeVolume, volumeTrend };
}

type TechnicalSnapshot = {
  rsi14: number | null;
  rsiState: "Overbought" | "Oversold" | "Bullish" | "Bearish" | "Neutral" | "Unavailable";
  moving50: number | null;
  moving200: number | null;
  vs50: number | null;
  vs200: number | null;
  trend: string;
  rangePosition: number | null;
  macd: { macd: number | null; signal: number | null; histogram: number | null; trend: string };
  bollinger: { upper: number | null; middle: number | null; lower: number | null; bandwidth: number | null; percentB: number | null };
  stochastic: { k: number | null; d: number | null; state: string };
  atr: number | null;
  ema12: number | null;
  ema26: number | null;
};

function getTechnicalSnapshot(price: number | null, prices: PricePoint[] = [], overview: any = {}): TechnicalSnapshot {
  const moving50 = toNumber(overview["50DayMovingAverage"]) ?? computeSimpleMovingAverage(prices, 50);
  const moving200 = toNumber(overview["200DayMovingAverage"]) ?? computeSimpleMovingAverage(prices, 200);
  const vs50 = price !== null && moving50 ? ((price - moving50) / moving50) * 100 : null;
  const vs200 = price !== null && moving200 ? ((price - moving200) / moving200) * 100 : null;
  const rsi14 = computeRsi(prices, 14);
  const rsiState = rsi14 === null
    ? "Unavailable"
    : rsi14 >= 70
      ? "Overbought"
      : rsi14 <= 30
        ? "Oversold"
        : rsi14 >= 60
          ? "Bullish"
          : rsi14 <= 40
            ? "Bearish"
            : "Neutral";
  const weekHigh = toNumber(overview["52WeekHigh"]);
  const weekLow = toNumber(overview["52WeekLow"]);
  const rangePosition = price !== null && weekHigh !== null && weekLow !== null && weekHigh !== weekLow
    ? ((price - weekLow) / (weekHigh - weekLow)) * 100
    : null;

  let trend = "Trend unavailable";
  if (vs50 !== null && vs200 !== null) {
    if (vs50 >= 0 && vs200 >= 0) trend = "Above 50D and 200D averages";
    else if (vs50 < 0 && vs200 < 0) trend = "Below 50D and 200D averages";
    else if (vs50 >= 0 && vs200 < 0) trend = "Short-term recovery, long-term trend still weak";
    else trend = "Near-term pullback inside longer-term uptrend";
  } else if (vs50 !== null) {
    trend = vs50 >= 0 ? "Above 50D average" : "Below 50D average";
  } else if (vs200 !== null) {
    trend = vs200 >= 0 ? "Above 200D average" : "Below 200D average";
  }

  const macd = computeMACD(prices);
  const bollinger = computeBollingerBands(prices);
  const stochastic = computeStochastic(prices);
  const atr = computeATR(prices);
  const ema12Arr = computeEMA(prices, 12);
  const ema26Arr = computeEMA(prices, 26);
  const ema12Val = ema12Arr.length > 0 && !isNaN(ema12Arr[ema12Arr.length - 1]) ? ema12Arr[ema12Arr.length - 1] : null;
  const ema26Val = ema26Arr.length > 0 && !isNaN(ema26Arr[ema26Arr.length - 1]) ? ema26Arr[ema26Arr.length - 1] : null;

  return { rsi14, rsiState, moving50, moving200, vs50, vs200, trend, rangePosition, macd, bollinger, stochastic, atr, ema12: ema12Val, ema26: ema26Val };
}

/** Exported alias for getTechnicalSnapshot — used by tools that need technical analysis outside reports. */
export const computeTechnicalSnapshot = getTechnicalSnapshot;

type ActionStance = {
  label: ActionLabel;
  rationale: string;
  ownerAction: OwnerAction;
  nonOwnerAction: NonOwnerAction;
  confidence: 'High' | 'Medium' | 'Low';
  missingInputs: string[];
};

type PositionGuidance = {
  stance: ActionLabel;
  rationale: string;
  forOwners: OwnerAction;
  forNonOwners: NonOwnerAction;
  confidence: 'High' | 'Medium' | 'Low';
  missingInputs: string[];
};

type RecommendationProfile = {
  signal: ActionLabel;
  rationale: string;
  ownerAction: OwnerAction;
  nonOwnerAction: NonOwnerAction;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceScore: number;
  missingInputs: string[];
  qualityScore: number | null;
  valuationScore: number | null;
  trendScore: number | null;
  overallScore: number | null;
};

const POSITION_GUIDANCE_NOTE = '_For owners = you already hold the stock. For non-owners = you are considering a fresh entry. Confidence reflects data completeness and signal alignment._';

function normalizeActionLabel(label?: string | null): ActionLabel {
  if (label === 'Wait') return 'Watch';
  if (label === 'Buy' || label === 'Hold' || label === 'Watch' || label === 'Sell') return label;
  return 'Hold';
}

function actionFromDecisionSnapshot(action?: DecisionSnapshot['action']): ActionLabel {
  if (action === 'Initiate' || action === 'Add') return 'Buy';
  if (action === 'Trim') return 'Watch';
  if (action === 'Exit') return 'Sell';
  if (action === 'Hold') return 'Hold';
  return 'Watch';
}

function describeDecisionAction(action?: DecisionSnapshot['action']): string {
  if (action === 'Initiate') return 'Start a position';
  if (action === 'Add') return 'Add to the position';
  if (action === 'Hold') return 'Keep holding';
  if (action === 'Trim') return 'Trim the position';
  if (action === 'Exit') return 'Exit the position';
  return 'Wait for a better setup';
}

function describeNonOwnerAction(action: NonOwnerAction): string {
  if (action === 'Buy') return 'Start a position';
  if (action === 'Watch') return 'Stay on watchlist';
  return 'Avoid new entry';
}

function derivePortfolioRoleLabel(data: StockReportData, scorecard: ReturnType<typeof computeScorecard>, guidance: PositionGuidance): string {
  if (data.decisionSnapshot) {
    switch (data.decisionSnapshot.action) {
      case 'Initiate':
        return 'Starter position candidate — begin with measured sizing if it fits your portfolio limits';
      case 'Add':
        return 'Accumulation candidate — add only toward your target weight, not beyond it';
      case 'Hold':
        return 'Existing position to keep — maintain exposure, but this is not a forced add';
      case 'Trim':
        return 'Risk reduction candidate — trim exposure and rebalance sizing';
      case 'Exit':
        return 'Capital preservation candidate — exit or avoid until the thesis improves';
      case 'Wait':
      default:
        return 'Watchlist candidate — wait for a better setup or fresher confirmation';
    }
  }

  const composite = scorecard.composite;
  const moatScore = data.moatAnalysis?.moatScore ?? 0;
  if (composite !== null && composite >= 65 && moatScore >= 61) {
    return 'Core holding — quality compounder with durable competitive advantage';
  }
  if (composite !== null && composite >= 65) {
    return 'Growth tilt — strong fundamentals; monitor entry valuation';
  }
  if (composite !== null && composite >= 45 && moatScore >= 31) {
    return 'Stable business candidate — narrower moat; revisit on meaningful pullback';
  }
  if (composite !== null && composite < 40) {
    return 'Speculative / avoid — fundamentals under pressure';
  }
  return guidance.stance === 'Buy'
    ? 'Starter position candidate — positive setup, but size with discipline'
    : guidance.stance === 'Hold'
      ? 'General equity exposure — hold existing position'
      : guidance.stance === 'Watch'
        ? 'Watchlist candidate — wait for a better entry'
        : 'Avoid / reduce exposure';
}

function buildDecisionActionTable(snapshot: DecisionSnapshot): string {
  return buildTable(
    ['Field', 'Value'],
    [
      ['Action', describeDecisionAction(snapshot.action)],
      ['Confidence', snapshot.confidence],
      ['Freshness', snapshot.freshness],
      ['Overall Score', snapshot.overallScore !== null ? `${snapshot.overallScore}/100` : 'Unavailable'],
      ['Portfolio Impact', snapshot.portfolioImpact],
      ['Invalidation', snapshot.invalidation],
      ['Next Trigger', snapshot.nextTrigger],
    ],
    ['left', 'left']
  );
}

function buildWhatChangedSection(snapshot?: DecisionSnapshot): string {
  if (!snapshot) return '';
  return [
    '## What Changed',
    ...snapshot.changed.map((item) => `- ${item}`),
  ].join('\n');
}

function buildFreshnessSection(trust?: DataTrustSummary): string {
  if (!trust || trust.entries.length === 0) return '';
  return [
    '## Data Freshness',
    buildTable(
      ['Input', 'Provider', 'Fetched', 'As Of', 'Freshness'],
      trust.entries.map((entry) => [
        entry.label,
        entry.provider,
        entry.fetchedAt.replace('T', ' ').slice(0, 16),
        entry.asOf || 'Unavailable',
        entry.freshness,
      ]),
      ['left', 'left', 'left', 'left', 'left']
    ),
  ].join('\n\n');
}

function buildDecisionSection(snapshot?: DecisionSnapshot): string {
  if (!snapshot) return '';
  const whyNow = snapshot.whyNow.length
    ? snapshot.whyNow.map((item) => `- ${item}`).join('\n')
    : '- No strong positive catalyst is currently differentiated.';
  const whyNot = snapshot.whyNot.length
    ? snapshot.whyNot.map((item) => `- ${item}`).join('\n')
    : '- No major disqualifying risk was detected from the current data bundle.';
  const missing = snapshot.missingInputs.length
    ? snapshot.missingInputs.map((item) => `- ${item}`).join('\n')
    : '- None';
  return [
    '## Decision Snapshot',
    buildDecisionActionTable(snapshot),
    '### Why Now',
    whyNow,
    '### Why Not',
    whyNot,
    '### Missing Inputs',
    missing,
  ].join('\n\n');
}

function formatMissingInputs(inputs: string[], maxItems = 2): string {
  if (inputs.length === 0) return '';
  const shown = inputs.slice(0, maxItems);
  if (inputs.length === 1) return shown[0];
  if (inputs.length === 2) return `${shown[0]} and ${shown[1]}`;
  return `${shown[0]}, ${shown[1]}, and more`;
}

function sentenceCase(text: string): string {
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
}

function weightedAverage(entries: Array<{ value: number | null; weight: number }>): number | null {
  const available = entries.filter((entry) => entry.value !== null);
  if (!available.length) return null;
  const totalWeight = available.reduce((sum, entry) => sum + entry.weight, 0);
  if (!totalWeight) return null;
  const value = available.reduce((sum, entry) => sum + (entry.value as number) * (entry.weight / totalWeight), 0);
  return clampScore(value);
}

function scoreTargetUpside(upside: number | null): number | null {
  if (upside === null) return null;
  return clampScore(50 + upside * 1.5);
}

function scoreTechnicalTrend(technical: TechnicalSnapshot, momentum: number | null): number | null {
  let trendBase: number | null = null;
  if (technical.vs50 !== null && technical.vs200 !== null) {
    if (technical.vs50 >= 0 && technical.vs200 >= 0) trendBase = 80;
    else if (technical.vs50 >= 0 && technical.vs200 < 0) trendBase = 56;
    else if (technical.vs50 < 0 && technical.vs200 >= 0) trendBase = 44;
    else trendBase = 24;
  } else if (technical.vs50 !== null) {
    trendBase = technical.vs50 >= 0 ? 62 : 38;
  } else if (technical.vs200 !== null) {
    trendBase = technical.vs200 >= 0 ? 58 : 34;
  }

  const rsiScore = technical.rsi14 === null
    ? null
    : technical.rsi14 >= 75
      ? 38
      : technical.rsi14 >= 65
        ? 50
        : technical.rsi14 >= 55
          ? 64
          : technical.rsi14 >= 40
            ? 56
            : technical.rsi14 >= 30
              ? 44
              : 58;

  return weightedAverage([
    { value: trendBase, weight: 0.45 },
    { value: rsiScore, weight: 0.2 },
    { value: momentum, weight: 0.35 },
  ]);
}

function deriveRecommendationConfidence(args: {
  price: number | null;
  qualityScore: number | null;
  valuationScore: number | null;
  trendScore: number | null;
  targetUpside: number | null;
  hasBalanceSheet: boolean;
  hasCashFlow: boolean;
}): { score: number; label: 'High' | 'Medium' | 'Low'; missingInputs: string[] } {
  const { price, qualityScore, valuationScore, trendScore, targetUpside, hasBalanceSheet, hasCashFlow } = args;
  const missingInputs: string[] = [];
  let score = 0;

  if (price !== null) score += 20;
  else missingInputs.push('current price');

  if (qualityScore !== null) score += 25;
  else missingInputs.push('quality metrics');

  if (valuationScore !== null) score += 20;
  else missingInputs.push('valuation anchor');

  if (trendScore !== null) score += 20;
  else missingInputs.push('trend data');

  if (targetUpside !== null) score += 7.5;
  else missingInputs.push('analyst target data');

  if (hasBalanceSheet) score += 3.75;
  else missingInputs.push('balance-sheet detail');

  if (hasCashFlow) score += 3.75;
  else missingInputs.push('cash-flow detail');

  const label = score >= 80 ? 'High' : score >= 58 ? 'Medium' : 'Low';
  return { score, label, missingInputs };
}

function buildRecommendationRationale(profile: {
  signal: ActionLabel;
  qualityScore: number | null;
  valuationScore: number | null;
  trendScore: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  missingInputs: string[];
}): string {
  const positives: string[] = [];
  const cautions: string[] = [];

  if (profile.qualityScore !== null) {
    if (profile.qualityScore >= 70) positives.push('business quality is strong');
    else if (profile.qualityScore >= 55) positives.push('business quality is solid');
    else if (profile.qualityScore < 38) cautions.push('business quality is weak');
  }

  if (profile.valuationScore !== null) {
    if (profile.valuationScore >= 60) positives.push('valuation offers room for upside');
    else if (profile.valuationScore < 40) cautions.push('valuation support is weak');
  }

  if (profile.trendScore !== null) {
    if (profile.trendScore >= 58) positives.push('trend is supportive');
    else if (profile.trendScore < 35) cautions.push('trend is working against the setup');
  }

  let opening = 'Signals are mixed across quality, valuation, and trend.';
  if (profile.signal === 'Buy') {
    opening = positives.length >= 2
      ? `${sentenceCase(positives.slice(0, 2).join(' and '))}.`
      : 'Quality, valuation, and trend are supportive enough to justify fresh exposure.';
  } else if (profile.signal === 'Hold') {
    opening = positives.length
      ? `${positives[0][0].toUpperCase()}${positives[0].slice(1)}, but the setup is not attractive enough for an aggressive add.`
      : 'The thesis is still investable, but this is not a high-conviction entry point.';
  } else if (profile.signal === 'Watch') {
    opening = cautions.length
      ? `${cautions[0][0].toUpperCase()}${cautions[0].slice(1)}, so patience is warranted.`
      : 'The setup needs a better entry or cleaner confirmation before acting.';
  } else if (profile.signal === 'Sell') {
    opening = cautions.length >= 2
      ? `${sentenceCase(cautions.slice(0, 2).join(' and '))}.`
      : 'Quality and reward-to-risk are weak enough that capital is better protected elsewhere.';
  }

  if (profile.confidence === 'High' || profile.missingInputs.length === 0) {
    return opening;
  }

  return `${opening} Confidence is ${profile.confidence.toLowerCase()} because ${formatMissingInputs(profile.missingInputs)} are incomplete.`;
}

function deriveRecommendationProfile(args: {
  scorecard: ReturnType<typeof computeScorecard>;
  targetUpside: number | null;
  technical: TechnicalSnapshot;
  price: number | null;
  hasBalanceSheet: boolean;
  hasCashFlow: boolean;
}): RecommendationProfile {
  const { scorecard, targetUpside, technical, price, hasBalanceSheet, hasCashFlow } = args;
  const qualityScore = weightedAverage([
    { value: scorecard.components.profitability, weight: 0.45 },
    { value: scorecard.components.growth, weight: 0.25 },
    { value: scorecard.components.moat, weight: 0.3 },
  ]);
  const valuationScore = weightedAverage([
    { value: scorecard.components.valuation, weight: 0.55 },
    { value: scoreTargetUpside(targetUpside), weight: 0.45 },
  ]);
  const trendScore = scoreTechnicalTrend(technical, scorecard.components.momentum);
  const confidence = deriveRecommendationConfidence({
    price,
    qualityScore,
    valuationScore,
    trendScore,
    targetUpside,
    hasBalanceSheet,
    hasCashFlow,
  });
  const overallScore = weightedAverage([
    { value: qualityScore, weight: 0.45 },
    { value: valuationScore, weight: 0.25 },
    { value: trendScore, weight: 0.2 },
    { value: confidence.score, weight: 0.1 },
  ]);

  const strongQuality = qualityScore !== null && qualityScore >= 50;
  const weakQuality = qualityScore !== null && qualityScore < 32;
  const attractiveValuation = valuationScore !== null && valuationScore >= 55;
  const weakValuation = valuationScore !== null && valuationScore < 38;
  const supportiveTrend = trendScore !== null && trendScore >= 50;
  const brokenTrend = trendScore !== null && trendScore < 32;

  let signal: ActionLabel;
  if ((overallScore !== null && overallScore >= 50 && (qualityScore === null || qualityScore >= 40) && (valuationScore === null || valuationScore >= 48) && (trendScore === null || trendScore >= 45))
    || (strongQuality && attractiveValuation && supportiveTrend && confidence.label !== 'Low')) {
    signal = 'Buy';
  } else if ((overallScore !== null && overallScore < 28 && weakQuality && (brokenTrend || weakValuation)) && confidence.label !== 'Low') {
    signal = 'Sell';
  } else if ((overallScore !== null && overallScore >= 46) || strongQuality || (qualityScore !== null && qualityScore >= 45 && !brokenTrend)) {
    signal = 'Hold';
  } else if ((overallScore !== null && overallScore >= 30) || weakValuation || brokenTrend) {
    signal = 'Watch';
  } else {
    signal = confidence.label === 'Low' ? 'Watch' : 'Sell';
  }

  if (confidence.label === 'Low' && signal === 'Buy') signal = 'Hold';
  if (confidence.label === 'Low' && signal === 'Sell') signal = 'Watch';

  let ownerAction: OwnerAction;
  let nonOwnerAction: NonOwnerAction;
  if (signal === 'Buy') {
    ownerAction = 'Add';
    nonOwnerAction = 'Buy';
  } else if (signal === 'Hold') {
    ownerAction = 'Hold';
    nonOwnerAction = 'Watch';
  } else if (signal === 'Watch') {
    ownerAction = brokenTrend || weakValuation || weakQuality ? 'Trim' : 'Hold';
    nonOwnerAction = brokenTrend || weakValuation || weakQuality ? 'Avoid' : 'Watch';
  } else {
    ownerAction = 'Sell';
    nonOwnerAction = 'Avoid';
  }

  const rationale = buildRecommendationRationale({
    signal,
    qualityScore,
    valuationScore,
    trendScore,
    confidence: confidence.label,
    missingInputs: confidence.missingInputs,
  });

  return {
    signal,
    rationale,
    ownerAction,
    nonOwnerAction,
    confidence: confidence.label,
    confidenceScore: confidence.score,
    missingInputs: confidence.missingInputs,
    qualityScore,
    valuationScore,
    trendScore,
    overallScore,
  };
}

function toPositionGuidance(action: ActionStance): PositionGuidance {
  return {
    stance: action.label,
    rationale: action.rationale,
    forOwners: action.ownerAction,
    forNonOwners: action.nonOwnerAction,
    confidence: action.confidence,
    missingInputs: action.missingInputs,
  };
}

function derivePositionGuidanceFromExplicitAction(action: ActionLabel, rationale: string): PositionGuidance {
  switch (action) {
    case 'Buy':
      return toPositionGuidance({
        label: 'Buy',
        rationale,
        ownerAction: 'Add',
        nonOwnerAction: 'Buy',
        confidence: 'Medium',
        missingInputs: [],
      });
    case 'Sell':
      return toPositionGuidance({
        label: 'Sell',
        rationale,
        ownerAction: 'Sell',
        nonOwnerAction: 'Avoid',
        confidence: 'Medium',
        missingInputs: [],
      });
    case 'Watch':
      return toPositionGuidance({
        label: 'Watch',
        rationale,
        ownerAction: 'Trim',
        nonOwnerAction: 'Watch',
        confidence: 'Medium',
        missingInputs: [],
      });
    case 'Hold':
    default:
      return toPositionGuidance({
        label: 'Hold',
        rationale,
        ownerAction: 'Hold',
        nonOwnerAction: 'Watch',
        confidence: 'Medium',
        missingInputs: [],
      });
  }
}

function asStockReportData(item: ComparisonReportItem, generatedAt: string): StockReportData {
  return {
    symbol: item.symbol,
    generatedAt,
    price: item.price || {},
    priceHistory: item.priceHistory,
    companyOverview: item.overview,
    basicFinancials: item.basicFinancials,
    incomeStatement: item.incomeStatement,
    balanceSheet: item.balanceSheet,
    cashFlow: item.cashFlow,
    analystRatings: item.analystRatings,
    insiderTrading: item.insiderTrading,
    priceTargets: item.priceTargets,
    peers: item.peers,
    newsSentiment: item.newsSentiment,
    companyNews: item.companyNews,
    moatAnalysis: item.moatAnalysis,
    dataTrust: item.dataTrust,
    decisionSnapshot: item.decisionSnapshot,
  };
}

function derivePositionGuidanceFromStock(data: StockReportData, score: number | null = computeScorecard(data).composite): PositionGuidance {
  if (data.decisionSnapshot) {
    const stance = actionFromDecisionSnapshot(data.decisionSnapshot.action);
    const forOwners: OwnerAction =
      data.decisionSnapshot.action === 'Add' ? 'Add'
      : data.decisionSnapshot.action === 'Trim' ? 'Trim'
      : data.decisionSnapshot.action === 'Exit' ? 'Sell'
      : 'Hold';
    const forNonOwners: NonOwnerAction =
      data.decisionSnapshot.action === 'Initiate' ? 'Buy'
      : data.decisionSnapshot.action === 'Exit' ? 'Avoid'
      : 'Watch';
    return {
      stance,
      rationale: data.decisionSnapshot.summary,
      forOwners,
      forNonOwners,
      confidence: data.decisionSnapshot.confidence,
      missingInputs: data.decisionSnapshot.missingInputs,
    };
  }
  const overview = data.companyOverview || {};
  const price = toNumber(data.price?.price);
  const targetUpside = getTargetUpsideStock(data);
  const technical = getTechnicalSnapshot(price, data.priceHistory?.prices || [], {
    ...overview,
    ['50DayMovingAverage']: overview['50DayMovingAverage'] ?? data.analystRatings?.movingAverage50Day,
  });
  const baseScorecard = computeScorecard(data);
  const scorecard = score === baseScorecard.composite ? baseScorecard : {
    ...baseScorecard,
    composite: score,
  };
  const balanceReport = getMostCompleteReport(data.balanceSheet, ['cashAndEquivalents', 'longTermDebt', 'totalAssets', 'totalLiabilities', 'totalShareholderEquity']);
  const cashFlowReport = getMostCompleteReport(data.cashFlow, ['operatingCashflow', 'capitalExpenditures', 'freeCashFlow', 'dividendPayout']);
  const profile = deriveRecommendationProfile({
    scorecard,
    targetUpside,
    technical,
    price,
    hasBalanceSheet: balanceReport !== null,
    hasCashFlow: cashFlowReport !== null,
  });

  return toPositionGuidance({
    label: profile.signal,
    rationale: profile.rationale,
    ownerAction: profile.ownerAction,
    nonOwnerAction: profile.nonOwnerAction,
    confidence: profile.confidence,
    missingInputs: profile.missingInputs,
  });
}

function summarizeInsiderActivity(insiderTrading: any): { summary: string | null; table: string | null } {
  const metrics = summarizeInsiderMetrics(insiderTrading);
  if (!metrics.transactions.length) {
    return { summary: null, table: null };
  }
  const latest = metrics.transactions.slice(0, 5).map((item: any) => [
    formatDateLabel(String(item.transactionDate)),
    item.insider || "N/A",
    item.transactionType || "N/A",
    formatCompactNumber(item.shares),
    formatCurrency(item.totalValue),
  ]);
  return {
    summary: `${metrics.buyCount} purchase(s) vs ${metrics.sellCount} sale(s) in the recent provider feed; disclosed value ${formatCurrency(metrics.buyValue)} bought vs ${formatCurrency(metrics.sellValue)} sold.`,
    table: buildTable(["Date", "Insider", "Type", "Shares", "Value"], latest, ["left", "left", "left", "right", "right"]),
  };
}

function getRecentInsiderTransactions(insiderTrading: any): any[] {
  const transactions = Array.isArray(insiderTrading?.recentTransactions)
    ? insiderTrading.recentTransactions.filter((item: any) => item && item.transactionDate)
    : [];
  return transactions
    .slice()
    .sort((a: any, b: any) => String(b.transactionDate).localeCompare(String(a.transactionDate)));
}

function summarizeInsiderMetrics(insiderTrading: any): {
  transactions: any[];
  buyCount: number;
  sellCount: number;
  buyValue: number;
  sellValue: number;
  latestDate: string | null;
} {
  const transactions = getRecentInsiderTransactions(insiderTrading);
  const buys = transactions.filter((item: any) => String(item.transactionType).toLowerCase().includes("purchase"));
  const sells = transactions.filter((item: any) => String(item.transactionType).toLowerCase().includes("sale"));
  return {
    transactions,
    buyCount: buys.length,
    sellCount: sells.length,
    buyValue: buys.reduce((sum: number, item: any) => sum + (toNumber(item.totalValue) ?? 0), 0),
    sellValue: sells.reduce((sum: number, item: any) => sum + (toNumber(item.totalValue) ?? 0), 0),
    latestDate: transactions[0]?.transactionDate ? String(transactions[0].transactionDate) : null,
  };
}

function pickPresentValue(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '' && value !== 'N/A') {
      return value;
    }
  }
  return null;
}

function getOwnershipDisplayValue(
  item: ComparisonReportItem,
  field: 'insider' | 'institutional' | 'shortFloat'
): string {
  const overview = item.overview || {};
  const raw = field === 'insider'
    ? pickPresentValue(item.insiderTrading?.insiderOwnership, overview.percentInsiders)
    : field === 'institutional'
      ? pickPresentValue(item.insiderTrading?.institutionalOwnership, overview.percentInstitutions)
      : pickPresentValue(item.insiderTrading?.shortPercentFloat, overview.shortPercentFloat);
  return raw === null ? 'N/A' : formatPercent(raw);
}

function buildComparisonInsiderSummaryTable(items: ComparisonReportItem[]): string {
  const rows = items.map((item) => {
    const metrics = summarizeInsiderMetrics(item.insiderTrading);
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      getOwnershipDisplayValue(item, 'insider'),
      getOwnershipDisplayValue(item, 'institutional'),
      metrics.transactions.length ? String(metrics.buyCount) : '—',
      metrics.transactions.length ? String(metrics.sellCount) : '—',
      metrics.transactions.length ? formatCurrency(metrics.buyValue) : '—',
      metrics.transactions.length ? formatCurrency(metrics.sellValue) : '—',
      metrics.latestDate ? formatDateLabel(metrics.latestDate) : '—',
    ];
  });

  return buildTable(
    ['Company', 'Insider Own', 'Institutional Own', 'Recent Buys', 'Recent Sells', 'Buy Value', 'Sell Value', 'Latest Filing'],
    rows,
    ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
  );
}

function buildDeepInsiderSections(items: ComparisonReportItem[]): string {
  const sections = items.map((item) => {
    const metrics = summarizeInsiderMetrics(item.insiderTrading);
    const overview = item.overview || {};
    const ownershipLines = [
      `- Insider ownership: ${getOwnershipDisplayValue(item, 'insider')}`,
      `- Institutional ownership: ${getOwnershipDisplayValue(item, 'institutional')}`,
      `- Short float: ${getOwnershipDisplayValue(item, 'shortFloat')}`,
      metrics.transactions.length
        ? `- Recent transaction summary: ${metrics.buyCount} purchase(s), ${metrics.sellCount} sale(s), ${formatCurrency(metrics.buyValue)} bought, ${formatCurrency(metrics.sellValue)} sold.`
        : '- Recent transaction summary: provider transaction feed unavailable.',
    ];

    const transactionTable = metrics.transactions.length
      ? buildTable(
          ['Date', 'Insider', 'Title', 'Type', 'Shares', 'Share Price', 'Value'],
          metrics.transactions.slice(0, 10).map((txn: any) => [
            formatDateLabel(String(txn.transactionDate)),
            txn.insider || 'N/A',
            txn.title || 'N/A',
            txn.transactionType || 'N/A',
            formatCompactNumber(txn.shares),
            formatPrice(txn.sharePrice),
            formatCurrency(txn.totalValue),
          ]),
          ['left', 'left', 'left', 'left', 'right', 'right', 'right']
        )
      : '_No recent insider transactions were returned by the active data providers._';

    return [
      `### ${overview.name || item.symbol} (${item.symbol})`,
      ownershipLines.join('\n'),
      transactionTable,
    ].join('\n\n');
  });

  if (!sections.length) return '';

  return [
    '## 🧾 Insider Transaction Detail',
    '_Recent transaction counts and values only reflect what the active providers exposed for the current feed window._',
    ...sections,
  ].join('\n\n');
}

function buildValuationGrowthScatter(items: ComparisonReportItem[]): string {
  const points = items
    .map((item) => {
      const overview = item.overview || {};
      const growth = getStockRevenueGrowth({
        symbol: item.symbol,
        generatedAt: '',
        price: {},
        companyOverview: overview,
        basicFinancials: item.basicFinancials,
      } as StockReportData);
      const pe = toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM);
      const marketCap = toNumber(overview.marketCapitalization);
      if (growth === null || pe === null || !Number.isFinite(pe)) return null;
      return {
        name: item.symbol,
        value: [Number(growth.toFixed(1)), Number(pe.toFixed(1))],
        marketCap: marketCap ?? 0,
      };
    })
    .filter((point): point is { name: string; value: [number, number]; marketCap: number } => point !== null);

  if (points.length === 0) return '';

  const maxCap = Math.max(...points.map((point) => point.marketCap || 0), 1);
  return buildChartBlock({
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Revenue Growth (TTM %)' },
    yAxis: { type: 'value', name: 'P/E (TTM)' },
    series: [
      {
        type: 'scatter',
        data: points.map((point) => ({
          name: point.name,
          value: point.value,
          symbolSize: 12 + Math.sqrt(point.marketCap / maxCap) * 18,
          label: { show: true, formatter: '{b}', position: 'right' },
        })),
      },
    ],
  });
}

function buildMarginComparisonChart(items: ComparisonReportItem[]): string {
  const rows = items.map((item) => {
    const gross = normalizePercent(item.basicFinancials?.metric?.grossMarginTTM ?? item.overview?.profitMargin);
    const operating = normalizePercent(item.basicFinancials?.metric?.operatingMarginTTM ?? item.overview?.operatingMargin);
    return {
      symbol: item.symbol,
      gross: gross === null ? 0 : Number(gross.toFixed(1)),
      operating: operating === null ? 0 : Number(operating.toFixed(1)),
    };
  });
  if (rows.length === 0) return '';

  return buildChartBlock({
    tooltip: { trigger: 'axis' },
    legend: { bottom: 0 },
    xAxis: { type: 'category', data: rows.map((row) => row.symbol) },
    yAxis: { type: 'value', name: 'Margin %' },
    series: [
      { name: 'Gross Margin', type: 'bar', data: rows.map((row) => row.gross) },
      { name: 'Operating Margin', type: 'bar', data: rows.map((row) => row.operating) },
    ],
  });
}

function formatRatingSummary(item: any): string {
  const ratings = item.analystRatings || item.overview || {};
  const strongBuy = toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy);
  const buy = toNumber(ratings.buy ?? ratings.analystRatingBuy);
  const hold = toNumber(ratings.hold ?? ratings.analystRatingHold);
  const sell = toNumber(ratings.sell ?? ratings.analystRatingSell);
  const strongSell = toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell);

  if ([strongBuy, buy, hold, sell, strongSell].every((value) => value === null)) {
    return 'N/A';
  }

  return `SB ${strongBuy ?? 0} / B ${buy ?? 0} / H ${hold ?? 0} / S ${sell ?? 0} / SS ${strongSell ?? 0}`;
}

function clampScore(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function average(values: Array<number | null>): number | null {
  const filtered = values.filter((v): v is number => v !== null && !Number.isNaN(v));
  if (filtered.length === 0) return null;
  const sum = filtered.reduce((acc, val) => acc + val, 0);
  return sum / filtered.length;
}

function computeMomentum(prices?: PricePoint[]): number | null {
  if (!prices || prices.length < 2) return null;
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const first = toNumber(sorted[0].close);
  const last = toNumber(sorted[sorted.length - 1].close);
  if (!first || !last) return null;
  const pct = ((last - first) / first) * 100;
  return clampScore(50 + pct);
}

function computeMarginStability(incomeStatement?: any): number | null {
  const reports = incomeStatement?.quarterlyReports || incomeStatement?.annualReports || [];
  if (!Array.isArray(reports) || reports.length < 3) return null;

  const margins = reports
    .slice(0, 8)
    .map((r: any) => {
      const revenue = Number(r.totalRevenue);
      const gross = Number(r.grossProfit);
      const operating = Number(r.operatingIncome);
      if (!revenue || Number.isNaN(revenue)) return null;
      return {
        gross: (gross / revenue) * 100,
        operating: (operating / revenue) * 100,
      };
    })
    .filter((m: any) => m && !Number.isNaN(m.gross) && !Number.isNaN(m.operating));

  if (margins.length < 3) return null;

  const mean = (values: number[]) => values.reduce((acc, v) => acc + v, 0) / values.length;
  const stddev = (values: number[]) => {
    const avg = mean(values);
    const variance = values.reduce((acc, v) => acc + Math.pow(v - avg, 2), 0) / values.length;
    return Math.sqrt(variance);
  };

  const grossStd = stddev(margins.map((m: any) => m.gross));
  const operatingStd = stddev(margins.map((m: any) => m.operating));
  const stabilityPenalty = (grossStd + operatingStd) / 2;
  return clampScore(100 - stabilityPenalty * 10);
}

function computePricingPower(data: StockReportData): number | null {
  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM);
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM);
  const avg = average([grossMargin, roe]);
  return avg === null ? null : clampScore(avg);
}

function computeAnalystConviction(data: StockReportData): number | null {
  const strongBuy = toNumber(data.analystRatings?.strongBuy);
  const buy = toNumber(data.analystRatings?.buy);
  const hold = toNumber(data.analystRatings?.hold);
  const sell = toNumber(data.analystRatings?.sell);
  const strongSell = toNumber(data.analystRatings?.strongSell);
  const total = [strongBuy, buy, hold, sell, strongSell]
    .filter((v) => v !== null)
    .reduce((acc, v) => acc + (v as number), 0);
  const strongBuyPct = total ? ((strongBuy || 0) / total) * 100 : null;

  const price = toNumber(data.price?.price);
  const targetMean = toNumber(
    data.priceTargets?.targetMean
    ?? (data.analystRatings?.analystTargetPrice !== 'N/A' ? data.analystRatings?.analystTargetPrice : null)
    ?? data.companyOverview?.analystTargetPrice
  );
  const upsidePct = price && targetMean ? ((targetMean - price) / price) * 100 : null;
  const upsideScore = upsidePct === null ? null : clampScore(50 + upsidePct);

  return average([strongBuyPct, upsideScore]);
}

function computeScorecard(data: StockReportData) {
  const moatDetails = {
    marginStability: computeMarginStability(data.incomeStatement),
    pricingPower: computePricingPower(data),
    analystConviction: computeAnalystConviction(data),
  };
  const moat = average([
    moatDetails.marginStability,
    moatDetails.pricingPower,
    moatDetails.analystConviction,
  ]);

  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM);
  const operatingMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM);
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM);
  const profitability = average([grossMargin, operatingMargin, roe]);

  const revenueGrowth = normalizePercent(
    data.basicFinancials?.metric?.revenueGrowth5Y || data.basicFinancials?.metric?.revenueGrowthTTM
  );
  const epsGrowth = normalizePercent(data.basicFinancials?.metric?.epsGrowth5Y);
  const growth = average([revenueGrowth, epsGrowth]);

  const pe = toNumber(data.companyOverview?.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  const valuation = pe && pe > 0 ? clampScore(100 - (pe / 50) * 100) : null;

  const momentum = computeMomentum(data.priceHistory?.prices);

  const components = {
    growth,
    profitability,
    valuation,
    momentum,
    moat,
  } satisfies Record<'growth' | 'profitability' | 'valuation' | 'momentum' | 'moat', number | null>;

  const weights: Record<keyof typeof components, number> = {
    growth: 0.25,
    profitability: 0.2,
    valuation: 0.2,
    momentum: 0.15,
    moat: 0.2,
  };

  const available = (Object.keys(components) as Array<keyof typeof components>).filter(
    (key) => components[key] !== null
  );

  const totalWeight = available.reduce((sum, key) => sum + weights[key], 0);
  const composite = available.reduce((sum, key) => sum + (components[key] as number) * (weights[key] / totalWeight), 0);

  return {
    components,
    composite: available.length ? clampScore(composite) : null,
    moatDetails,
  };
}

/**
 * Maps moat strength to a traffic-light emoji for visual reports.
 * "Wide" → 🟢  "Narrow" → 🟡  anything else → 🔴
 */
function moatStrengthEmoji(strength: string): string {
  if (strength === 'Wide') return '🟢';
  if (strength === 'Narrow') return '🟡';
  return '🔴';
}

/**
 * Renders an ECharts horizontal bar chart showing the three moat sub-component
 * scores alongside the overall LLM moat score.
 */
function buildMoatScoreChart(moatAnalysis: MoatAnalysis, scorecardMoatDetails: ReturnType<typeof computeScorecard>['moatDetails']): string {
  const score = Math.min(100, Math.max(0, Math.round(moatAnalysis.moatScore)));
  const { marginStability, pricingPower, analystConviction } = scorecardMoatDetails;

  const rows: Array<{ name: string; value: number }> = [
    { name: 'Overall Moat Score (LLM)', value: score },
  ];
  if (marginStability !== null) rows.push({ name: 'Margin Stability', value: Math.round(marginStability) });
  if (pricingPower !== null) rows.push({ name: 'Pricing Power', value: Math.round(pricingPower) });
  if (analystConviction !== null) rows.push({ name: 'Analyst Conviction', value: Math.round(analystConviction) });

  const colors: Record<string, string> = {
    'Overall Moat Score (LLM)': score >= 61 ? '#22c55e' : score >= 31 ? '#f59e0b' : '#ef4444',
    'Margin Stability': '#6366f1',
    'Pricing Power': '#14b8a6',
    'Analyst Conviction': '#0ea5e9',
  };

  return buildChartBlock({
    title: { text: 'Competitive Moat Score', left: 'center' },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      formatter: '{b}: {c}/100',
    },
    grid: { left: 160, right: 60, top: 40, bottom: 20 },
    xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}' } },
    yAxis: {
      type: 'category',
      data: rows.map((r) => r.name),
      inverse: true,
    },
    series: [{
      name: 'Score',
      type: 'bar',
      data: rows.map((r) => ({
        value: r.value,
        itemStyle: { color: colors[r.name] || '#6366f1' },
      })),
      barMaxWidth: 28,
      label: { show: true, position: 'right', formatter: '{c}/100' },
    }],
  });
}

/**
 * Renders a grouped bar chart comparing moat scores across companies in a
 * comparison/sector/deep-sector report.
 */
function buildMoatComparisonChart(items: ComparisonReportItem[]): string {
  const validItems = items.filter((item) => item.moatAnalysis);
  if (validItems.length === 0) return '';

  const symbols = validItems.map((item) => `${item.symbol} ${moatStrengthEmoji(item.moatAnalysis!.moatStrength)}`);
  const scores = validItems.map((item) => Math.round(item.moatAnalysis!.moatScore));

  return buildChartBlock({
    title: { text: 'Moat Score Comparison', left: 'center' },
    tooltip: { trigger: 'axis', formatter: '{b}: {c}/100' },
    grid: { left: 40, right: 20, top: 50, bottom: 60 },
    xAxis: {
      type: 'category',
      data: symbols,
      axisLabel: { rotate: symbols.length > 5 ? 30 : 0 },
    },
    yAxis: { type: 'value', min: 0, max: 100, name: 'Moat Score' },
    series: [{
      name: 'Moat Score',
      type: 'bar',
      data: scores.map((s) => ({
        value: s,
        itemStyle: { color: s >= 61 ? '#22c55e' : s >= 31 ? '#f59e0b' : '#ef4444' },
      })),
      barMaxWidth: 40,
      label: { show: true, position: 'top', formatter: '{c}' },
    }],
  });
}

/**
 * Renders the dedicated "🏰 Competitive Moat" section for a single-stock report.
 */
function buildStockMoatSection(moatAnalysis: MoatAnalysis, scorecardMoatDetails: ReturnType<typeof computeScorecard>['moatDetails']): string {
  const strengthEmoji = moatStrengthEmoji(moatAnalysis.moatStrength);
  const chart = buildMoatScoreChart(moatAnalysis, scorecardMoatDetails);

  const metaTable = buildTable(
    ['Attribute', 'Assessment'],
    [
      ['**Moat Type**', moatAnalysis.moatType],
      ['**Moat Strength**', `${strengthEmoji} ${moatAnalysis.moatStrength}`],
      ['**Moat Score**', `${Math.round(moatAnalysis.moatScore)}/100`],
    ],
    ['left', 'left']
  );

  const barrierLines = moatAnalysis.barriers.length
    ? moatAnalysis.barriers.map((b) => `- ${b}`).join('\n')
    : '_No specific barriers identified._';

  const parts: string[] = [
    '## 🏰 Competitive Moat',
    metaTable,
    ...(chart ? [chart] : []),
    '### 🔐 Moat Barriers',
    barrierLines,
    '### 📝 Moat Analysis',
    moatAnalysis.narrative,
    '### 🎯 Best For',
    moatAnalysis.bestFor,
  ];

  return parts.join('\n\n');
}

/**
 * Builds the moat comparison table and chart section for multi-company reports.
 */
function buildComparisonMoatSection(items: ComparisonReportItem[]): string {
  const itemsWithMoat = items.filter((item) => item.moatAnalysis);
  if (itemsWithMoat.length === 0) return '';

  const moatRows = itemsWithMoat.map((item) => {
    const moat = item.moatAnalysis!;
    const topBarriers = moat.barriers.slice(0, 3).join('; ') || 'N/A';
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      moat.moatType,
      `${moatStrengthEmoji(moat.moatStrength)} ${moat.moatStrength}`,
      `${Math.round(moat.moatScore)}/100`,
      topBarriers,
    ];
  });

  const moatTable = buildTable(
    ['Company', 'Moat Type', 'Strength', 'Score', 'Key Barriers'],
    moatRows,
    ['left', 'left', 'left', 'right', 'left']
  );

  const chart = buildMoatComparisonChart(itemsWithMoat);

  // Moat leaders
  const sorted = [...itemsWithMoat].sort((a, b) => (b.moatAnalysis!.moatScore ?? 0) - (a.moatAnalysis!.moatScore ?? 0));
  const leader = sorted[0];
  const wideMoat = itemsWithMoat.filter((item) => item.moatAnalysis!.moatStrength === 'Wide');

  const leaderLines: string[] = [];
  if (leader) {
    leaderLines.push(`- **Strongest moat:** ${leader.overview?.name || leader.symbol} (${leader.symbol}) — ${leader.moatAnalysis!.moatType}, score ${Math.round(leader.moatAnalysis!.moatScore)}/100`);
  }
  if (wideMoat.length > 0) {
    leaderLines.push(`- **Wide-moat companies:** ${wideMoat.map((item) => `${item.symbol}`).join(', ')}`);
  }

  // "Best For" table
  const bestForRows = itemsWithMoat.map((item) => [
    `**${item.symbol}**`,
    item.moatAnalysis!.bestFor,
  ]);
  const bestForTable = buildTable(
    ['Company', 'Best For'],
    bestForRows,
    ['left', 'left']
  );

  return [
    '## 🏰 Moat Analysis',
    moatTable,
    ...(chart ? [chart] : []),
    '### 🏆 Moat Leaders',
    ...(leaderLines.length ? leaderLines : ['_Insufficient data for moat comparison._']),
    '### 🎯 What Each Company Does Best',
    bestForTable,
  ].join('\n\n');
}

export function buildStockReport(data: StockReportData): string {
  const priceChart = buildPriceChart(data.priceHistory?.prices || []);
  const epsChart = buildEpsChart(data.earningsHistory?.quarterlyEarnings || []);
  const peChart = buildPeChart(data.priceHistory?.prices || [], data.earningsHistory?.quarterlyEarnings || []);
  const revenueChart = buildRevenueChart(data.incomeStatement);
  const marginChart = buildMarginChart(data.incomeStatement);
  const targetChart = buildTargetDistribution(data.priceTargets);
  const headline = `# ${data.symbol} Comprehensive Equity Research Report`;
  const scorecard = computeScorecard(data);
  const overview = data.companyOverview || {};
  const price = toNumber(data.price?.price);
  const changePercent = data.price?.changePercent;
  const changePercentValue = typeof changePercent === 'string'
    ? Number(changePercent.replace('%', ''))
    : changePercent;
  const changePercentIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
  const priceLine = price === null
    ? 'N/A'
    : `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`;

  const snapshotLines = [
    `- Price: ${priceLine} (day change)`,
    `- Market Cap: ${formatCurrency(overview.marketCapitalization)}`,
    `- Sector: ${overview.sector || 'Unavailable'}`,
    `- Industry: ${overview.industry || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable') && !line.includes('(Unavailable)'));

  const description = overview.description ? summarizeDescription(overview.description) : null;
  const businessLines = [
    overview.name ? `- Company: ${overview.name} (${data.symbol})` : `- Company: ${data.symbol}`,
    description ? `- Description: ${description}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    overview.industry ? `- Industry: ${overview.industry}` : null,
    overview.marketCapitalization ? `- Market Cap: ${formatCurrency(overview.marketCapitalization)}` : null,
    overview.revenueTTM ? `- Revenue (TTM): ${formatCurrency(overview.revenueTTM)}` : null,
    overview.grossProfitTTM ? `- Gross Profit (TTM): ${formatCurrency(overview.grossProfitTTM)}` : null,
    overview.sharesOutstanding ? `- Shares Outstanding: ${formatCompactNumber(overview.sharesOutstanding)}` : null,
    overview.dividendYield ? `- Dividend Yield: ${formatPercent(overview.dividendYield)}` : null,
  ].filter(Boolean) as string[];

  const peers = (data.peers?.peers || [])
    .filter((peer: string) => peer && peer.toUpperCase() !== data.symbol.toUpperCase())
    .slice(0, 10);
  const competitiveLines = [
    overview.industry ? `- Industry Focus: ${overview.industry}` : null,
    overview.sector ? `- Sector: ${overview.sector}` : null,
    peers.length ? `- Peer Set: ${peers.join(', ')}` : '- Peer Set: Unavailable (data gap or rate limit)',
  ].filter(Boolean) as string[];

  const revenueGrowth = getStockRevenueGrowth(data);
  const epsGrowth = getStockEpsGrowth(data);
  const grossMargin = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM ?? overview.profitMargin);
  const operatingMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin);
  const targetUpside = getTargetUpsideStock(data);
  const technical = getTechnicalSnapshot(price, data.priceHistory?.prices || [], {
    ...overview,
    ['50DayMovingAverage']: overview['50DayMovingAverage'] ?? data.analystRatings?.movingAverage50Day,
  });
  const trend50 = technical.vs50;
  const trend200 = technical.vs200;
  const positionGuidance = derivePositionGuidanceFromStock(data, scorecard.composite);
  const positionGuidanceTable = buildPositionGuidanceTable([
    { company: `${overview.name || data.symbol} (${data.symbol})`, guidance: positionGuidance },
  ]);
  const insiderSummary = summarizeInsiderActivity(data.insiderTrading);
  const themes = extractThemes([overview.description, overview.industry, overview.sector].filter(Boolean).join(' '));
  const growthLines = [
    revenueGrowth !== null ? `- Revenue growth (TTM): ${formatPercent(revenueGrowth)}` : null,
    epsGrowth !== null ? `- EPS growth (TTM): ${formatPercent(epsGrowth)}` : null,
    grossMargin !== null ? `- Gross margin: ${formatPercent(grossMargin)}` : null,
    operatingMargin !== null ? `- Operating margin: ${formatPercent(operatingMargin)}` : null,
    trend50 !== null ? `- Price vs 50D MA: ${trend50.toFixed(1)}%` : null,
    trend200 !== null ? `- Price vs 200D MA: ${trend200.toFixed(1)}%` : null,
    targetUpside !== null ? `- Analyst target upside: ${targetUpside.toFixed(1)}%` : null,
    themes.length ? `- Theme exposure: ${themes.join(', ')}` : null,
  ].filter(Boolean) as string[];

  const timingLines = [
    technical.rsi14 !== null ? `- RSI (14): ${technical.rsi14.toFixed(1)} (${technical.rsiState})` : null,
    trend50 !== null ? `- Price vs 50D average: ${trend50.toFixed(1)}%` : null,
    trend200 !== null ? `- Price vs 200D average: ${trend200.toFixed(1)}%` : null,
    technical.rangePosition !== null ? `- 52W range position: ${technical.rangePosition.toFixed(1)}%` : null,
    `- Technical trend: ${technical.trend}`,
    technical.macd.macd !== null ? `- MACD: ${technical.macd.macd.toFixed(2)} | Signal: ${technical.macd.signal?.toFixed(2) ?? 'N/A'} | Histogram: ${technical.macd.histogram?.toFixed(2) ?? 'N/A'} (${technical.macd.trend})` : null,
    technical.bollinger.upper !== null ? `- Bollinger Bands: Upper ${technical.bollinger.upper.toFixed(2)} | Middle ${technical.bollinger.middle?.toFixed(2)} | Lower ${technical.bollinger.lower?.toFixed(2)}` : null,
    technical.bollinger.percentB !== null ? `- Bollinger %B: ${technical.bollinger.percentB.toFixed(1)}% | Bandwidth: ${technical.bollinger.bandwidth?.toFixed(1)}%` : null,
    technical.stochastic.k !== null ? `- Stochastic: %K ${technical.stochastic.k.toFixed(1)} | %D ${technical.stochastic.d?.toFixed(1) ?? 'N/A'} (${technical.stochastic.state})` : null,
    technical.atr !== null ? `- ATR (14): ${technical.atr.toFixed(2)}` : null,
    technical.ema12 !== null ? `- EMA (12): ${technical.ema12.toFixed(2)}` : null,
    technical.ema26 !== null ? `- EMA (26): ${technical.ema26.toFixed(2)}` : null,
  ].filter(Boolean) as string[];

  const recommendationRows = Array.isArray(data.analystRecommendations?.recommendations)
    ? data.analystRecommendations.recommendations.slice(0, 4).map((row: any) => [
        row.period || "N/A",
        String(row.strongBuy ?? "N/A"),
        String(row.buy ?? "N/A"),
        String(row.hold ?? "N/A"),
        String(row.sell ?? "N/A"),
        String(row.strongSell ?? "N/A"),
      ])
    : [];
  const recommendationTable = recommendationRows.length
    ? buildTable(['Period', 'Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell'], recommendationRows, ['left', 'right', 'right', 'right', 'right', 'right'])
    : "";

  const alternativeLines = peers.length
    ? [
        `- Provider-identified peers to review: ${peers.slice(0, 5).join(', ')}`,
        "- These alternatives come from provider peer data; use a comparison report for ranked side-by-side analysis.",
      ]
    : [];

  const riskLines: string[] = [];
  const peRatio = toNumber(overview.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  if (peRatio !== null && peRatio > 40) {
    riskLines.push(`- Elevated valuation (P/E ${peRatio.toFixed(1)})`);
  }
  if (revenueGrowth !== null && revenueGrowth < 0) {
    riskLines.push(`- Negative revenue growth (TTM ${formatPercent(revenueGrowth)})`);
  }
  if (epsGrowth !== null && epsGrowth < 0) {
    riskLines.push(`- Negative EPS growth (TTM ${formatPercent(epsGrowth)})`);
  }
  if (operatingMargin !== null && operatingMargin < 10) {
    riskLines.push(`- Thin operating margin (${formatPercent(operatingMargin)})`);
  }
  const beta = toNumber(overview.beta);
  if (beta !== null && beta > 1.5) {
    riskLines.push(`- Higher volatility (beta ${beta.toFixed(2)})`);
  }
  const shortFloat = normalizePercent(overview.shortPercentFloat);
  if (shortFloat !== null && shortFloat > 5) {
    riskLines.push(`- Elevated short interest (${formatPercent(shortFloat)})`);
  }
  const balanceReport = getMostCompleteReport(data.balanceSheet, ['cashAndEquivalents', 'longTermDebt', 'totalAssets', 'totalLiabilities', 'totalShareholderEquity']);
  const incomeReports = getRecentReports(data.incomeStatement, ['totalRevenue', 'grossProfit', 'operatingIncome', 'netIncome'], 3);
  const balanceReports = getRecentReports(data.balanceSheet, ['cashAndEquivalents', 'longTermDebt', 'totalAssets', 'totalLiabilities', 'totalShareholderEquity'], 3);
  const cashReports = getRecentReports(data.cashFlow, ['operatingCashflow', 'capitalExpenditures', 'freeCashFlow', 'dividendPayout'], 3);
  const cash = toNumber(balanceReport?.cashAndEquivalents);
  const longDebt = toNumber(balanceReport?.longTermDebt);
  const netDebt = cash !== null && longDebt !== null ? longDebt - cash : null;
  if (netDebt !== null && netDebt > 0) {
    riskLines.push(`- Net debt of ${formatCurrency(netDebt)}`);
  }

  const incomeTable = incomeReports.length
    ? buildTable(
        ['Period', 'Revenue', 'Gross Profit', 'Operating Income', 'Net Income'],
        incomeReports.map((report) => [
          formatPeriodLabel(report),
          formatCurrency(report.totalRevenue),
          formatCurrency(report.grossProfit),
          formatCurrency(report.operatingIncome),
          formatCurrency(report.netIncome),
        ]),
        ['left', 'right', 'right', 'right', 'right']
      )
    : '_Income statement data unavailable (provider or rate limit; no estimated fallback shown)._';

  const balanceTable = balanceReports.length
    ? buildTable(
        ['Period', 'Cash', 'LT Debt', 'Total Liabilities', 'Total Assets', 'Equity'],
        balanceReports.map((report) => [
          formatPeriodLabel(report),
          formatCurrency(report.cashAndEquivalents),
          formatCurrency(report.longTermDebt),
          formatCurrency(report.totalLiabilities),
          formatCurrency(report.totalAssets),
          formatCurrency(report.totalShareholderEquity),
        ]),
        ['left', 'right', 'right', 'right', 'right', 'right']
      )
    : '_Balance sheet data unavailable (provider or rate limit; no estimated fallback shown)._';

  const cashTable = cashReports.length
    ? buildTable(
        ['Period', 'Operating Cash Flow', 'Capex', 'Free Cash Flow', 'Dividend Payout'],
        cashReports.map((report) => [
          formatPeriodLabel(report),
          formatCurrency(report.operatingCashflow),
          formatCurrency(report.capitalExpenditures),
          formatCurrency(deriveFreeCashFlow(report)),
          formatCurrency(report.dividendPayout),
        ]),
        ['left', 'right', 'right', 'right', 'right']
      )
    : '_Cash flow data unavailable (provider or rate limit)._';

  const forwardPE = toNumber(overview.forwardPE);
  const pegRatio = toNumber(overview.pegRatio);
  const bookValue = toNumber(overview.bookValue);
  const priceToBook = price !== null && bookValue ? price / bookValue : null;
  const revenuePerShare = toNumber(overview.revenuePerShare);
  const priceToSales = price !== null && revenuePerShare ? price / revenuePerShare : null;
  const marketCap = toNumber(overview.marketCapitalization);
  const revenueTTM = toNumber(overview.revenueTTM);
  const marketCapToRevenue = marketCap && revenueTTM ? marketCap / revenueTTM : null;
  const valuationTable = buildTable(
    ['Metric', 'Value'],
    [
      ['P/E (TTM)', peRatio === null ? 'N/A' : peRatio.toFixed(1)],
      ['Forward P/E', forwardPE === null ? 'N/A' : forwardPE.toFixed(1)],
      ['PEG', pegRatio === null ? 'N/A' : pegRatio.toFixed(2)],
      ['Price / Sales', priceToSales === null ? 'N/A' : priceToSales.toFixed(2)],
      ['Price / Book', priceToBook === null ? 'N/A' : priceToBook.toFixed(2)],
      ['Market Cap / Revenue', marketCapToRevenue === null ? 'N/A' : marketCapToRevenue.toFixed(2)],
    ],
    ['left', 'right']
  );
  const weekHigh = toNumber(overview['52WeekHigh']);
  const weekLow = toNumber(overview['52WeekLow']);
  const fromHigh = price && weekHigh ? ((price - weekHigh) / weekHigh) * 100 : null;
  const fromLow = price && weekLow ? ((price - weekLow) / weekLow) * 100 : null;
  const kpiTable = buildTable(
    ['KPI', 'Value'],
    [
      ['Price', `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`],
      ['Market Cap', formatCurrency(overview.marketCapitalization)],
      ['52W Range', `${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`],
      ['Revenue (TTM)', formatCurrency(overview.revenueTTM)],
      ['Gross Margin (TTM)', formatPercent(grossMargin)],
      ['Operating Margin (TTM)', formatPercent(operatingMargin)],
      ['ROE (TTM)', formatPercent(data.basicFinancials?.metric?.roeTTM)],
    ],
    ['left', 'right']
  );

  const ownershipLines = [
    data.insiderTrading?.institutionalOwnership && data.insiderTrading.institutionalOwnership !== "N/A"
      ? `- Institutional Ownership: ${formatPercent(data.insiderTrading.institutionalOwnership)}`
      : (overview.percentInstitutions ? `- Institutional Ownership: ${formatPercent(overview.percentInstitutions)}` : null),
    data.insiderTrading?.insiderOwnership && data.insiderTrading.insiderOwnership !== "N/A"
      ? `- Insider Ownership: ${formatPercent(data.insiderTrading.insiderOwnership)}`
      : (overview.percentInsiders ? `- Insider Ownership: ${formatPercent(overview.percentInsiders)}` : null),
    data.insiderTrading?.sharesFloat && data.insiderTrading.sharesFloat !== "N/A"
      ? `- Shares Float: ${formatCompactNumber(data.insiderTrading.sharesFloat)}`
      : (overview.sharesFloat ? `- Shares Float: ${formatCompactNumber(overview.sharesFloat)}` : null),
    data.insiderTrading?.shortRatio && data.insiderTrading.shortRatio !== "N/A"
      ? `- Short Ratio: ${formatNumber(data.insiderTrading.shortRatio, 2)}`
      : (overview.shortRatio ? `- Short Ratio: ${formatNumber(overview.shortRatio, 2)}` : null),
    data.insiderTrading?.shortPercentFloat && data.insiderTrading.shortPercentFloat !== "N/A"
      ? `- Short Interest (float): ${formatPercent(data.insiderTrading.shortPercentFloat)}`
      : (overview.shortPercentFloat ? `- Short Interest (float): ${formatPercent(overview.shortPercentFloat)}` : null),
    insiderSummary.summary ? `- Recent insider activity: ${insiderSummary.summary}` : null,
    `- Analyst Ratings: ${formatRatingSummary(data)}`,
  ].filter(Boolean) as string[];

  const analystTarget = toNumber(
    data.priceTargets?.targetMean
    ?? (data.analystRatings?.analystTargetPrice !== 'N/A' ? data.analystRatings?.analystTargetPrice : null)
    ?? data.companyOverview?.analystTargetPrice
  );
  const targetLow = toNumber(data.priceTargets?.targetLow);
  const targetHigh = toNumber(data.priceTargets?.targetHigh);
  const targetMedian = toNumber(data.priceTargets?.targetMedian);
  const latestEarnings = data.earningsHistory?.quarterlyEarnings?.[0];
  const catalystLines = [
    analystTarget !== null ? `- Target Mean: ${analystTarget.toFixed(2)}` : null,
    targetLow !== null ? `- Target Low: ${targetLow.toFixed(2)}` : null,
    targetMedian !== null ? `- Target Median: ${targetMedian.toFixed(2)}` : null,
    targetHigh !== null ? `- Target High: ${targetHigh.toFixed(2)}` : null,
    targetUpside !== null ? `- Implied Upside: ${targetUpside.toFixed(1)}%` : null,
    overview.exDividendDate ? `- Ex-Dividend Date: ${overview.exDividendDate}` : null,
    overview.dividendDate ? `- Dividend Pay Date: ${overview.dividendDate}` : null,
    latestEarnings
      ? `- Latest EPS (${formatDateLabel(latestEarnings.fiscalQuarter)}): ${latestEarnings.reportedEPS}`
      : null,
  ].filter(Boolean) as string[];
  const headlines = (data.companyNews?.articles || [])
    .map((a) => a.headline || a.title)
    .filter(Boolean);
  if (headlines.length) {
    catalystLines.push(`- Recent Headlines: ${headlines.slice(0, 5).join('; ')}`);
  }
  const sentiment = data.newsSentiment?.sentiment?.sentiment || data.newsSentiment?.sentiment?.buzz;
  if (sentiment) {
    ownershipLines.push(`- News Sentiment: ${sentiment}`);
  }

  const bullSignals: string[] = [];
  if (revenueGrowth !== null && revenueGrowth > 5) bullSignals.push('Sustained revenue expansion');
  if (epsGrowth !== null && epsGrowth > 5) bullSignals.push('EPS growth momentum');
  if (grossMargin !== null && grossMargin > 40) bullSignals.push('High gross margins');
  if (operatingMargin !== null && operatingMargin > 20) bullSignals.push('Strong operating leverage');
  if (targetUpside !== null && targetUpside > 10) bullSignals.push('Street targets imply upside');
  if ((scorecard.components.moat ?? 0) > 60) bullSignals.push('Moat score above 60');
  if (data.moatAnalysis && data.moatAnalysis.moatScore >= 61) bullSignals.push(`${data.moatAnalysis.moatStrength} competitive moat (${data.moatAnalysis.moatType})`);
  else if (data.moatAnalysis && data.moatAnalysis.moatScore >= 31) bullSignals.push(`Narrow moat detected (${data.moatAnalysis.moatType})`);

  const watchSignals: string[] = [];
  if (trend50 !== null && trend50 < 0) watchSignals.push('Price below 50D moving average');
  if (trend200 !== null && trend200 < 0) watchSignals.push('Price below 200D moving average');
  if (technical.rsiState === "Overbought") watchSignals.push('RSI indicates overbought conditions');
  if (technical.rsiState === "Oversold") watchSignals.push('RSI indicates oversold conditions');
  if (beta !== null && beta > 1.2) watchSignals.push('Volatility above market average');
  if (netDebt !== null && netDebt > 0) watchSignals.push('Net debt position');

  const bearSignals = riskLines.map((line) => line.replace(/^-\s*/, ''));
  const highlightsLines = [
    `- **Bull Case:** ${bullSignals.length ? bullSignals.join('; ') : 'Signals limited by available data.'}`,
    `- **Bear Case:** ${bearSignals.length ? bearSignals.join('; ') : 'No major red flags surfaced from available data.'}`,
    `- **What to watch:** ${watchSignals.length ? watchSignals.join('; ') : 'Monitor upcoming earnings and guidance.'}`,
  ];

  const sections: string[] = [
    headline,
    `Generated: ${data.generatedAt}`,
    buildDecisionSection(data.decisionSnapshot),
    buildWhatChangedSection(data.decisionSnapshot),
    buildFreshnessSection(data.dataTrust),
    '## 📊 Snapshot',
    ...(snapshotLines.length ? snapshotLines : ['- Snapshot data unavailable']),
  ];

  sections.push('## 🏢 Business Overview', ...(businessLines.length ? businessLines : ['- Business overview data unavailable']));
  sections.push('## 🧩 Competitive Landscape', ...(competitiveLines.length ? competitiveLines : ['- Competitive data unavailable']));

  sections.push('## ✨ KPI Dashboard', kpiTable);

  if (priceChart || epsChart) {
    sections.push('## 📈 Price & EPS Trends');
    sections.push('- Date axis: Month/Year');
    if (priceChart) sections.push(priceChart);
    if (epsChart) sections.push(epsChart);
    if (peChart) sections.push(peChart);
  }

  if (revenueChart || marginChart) {
    sections.push('## 📊 Revenue & Margin Trends');
    if (revenueChart) sections.push(revenueChart);
    if (marginChart) sections.push(marginChart);
  }

  const financialLines = [
    `- P/E: ${peRatio === null ? 'Unavailable' : peRatio.toFixed(1)}`,
    `- PEG: ${pegRatio === null ? 'Unavailable' : pegRatio.toFixed(2)}`,
    `- Gross Margin (TTM): ${formatPercent(grossMargin)}`,
    `- Operating Margin (TTM): ${formatPercent(operatingMargin)}`,
    `- ROE (TTM): ${formatPercent(data.basicFinancials?.metric?.roeTTM)}`,
  ].filter((line) => !line.endsWith('Unavailable'));
  if (financialLines.length) {
    sections.push('## 💰 Financials', ...financialLines);
  }

  sections.push(
    '## 🧾 Financial Deep Dive',
    '### Income Statement (recent reported periods)',
    incomeTable,
    '### Balance Sheet (recent reported periods)',
    balanceTable,
    '### Cash Flow (recent reported periods)',
    cashTable,
  );

  // Dividend Analysis section — only for dividend-paying stocks
  const dividendYield = toNumber(overview.dividendYield);
  const dividendPerShare = toNumber(overview.dividendPerShare);
  const isDividendPayer = (dividendYield != null && dividendYield > 0) || (dividendPerShare != null && dividendPerShare > 0);
  if (isDividendPayer) {
    const divEps = toNumber(overview.eps);
    const divPayoutRatio = dividendPerShare && divEps && divEps > 0 ? (dividendPerShare / divEps) * 100 : null;
    const latestCFReport = cashReports.length > 0 ? (data.cashFlow?.annualReports || data.cashFlow?.quarterlyReports || [])[0] : null;
    const divOCF = latestCFReport?.operatingCashflow != null ? Number(latestCFReport.operatingCashflow) : null;
    const divCapex = latestCFReport?.capitalExpenditures != null ? Math.abs(Number(latestCFReport.capitalExpenditures)) : null;
    const divPaid = latestCFReport?.dividendPayout != null ? Math.abs(Number(latestCFReport.dividendPayout)) : null;
    const divFCF = divOCF != null && divCapex != null ? divOCF - divCapex : null;
    const divCoverage = divFCF != null && divPaid != null && divPaid > 0 ? divFCF / divPaid : null;
    let divSafety = 'Unavailable';
    if (divCoverage !== null) {
      if (divCoverage >= 3) divSafety = '🟢 Very Safe (FCF covers 3x+)';
      else if (divCoverage >= 2) divSafety = '🟢 Safe (FCF covers 2x+)';
      else if (divCoverage >= 1.5) divSafety = '🟡 Adequate (FCF covers 1.5x+)';
      else if (divCoverage >= 1) divSafety = '🟠 At Risk (FCF barely covers)';
      else divSafety = '🔴 Unsafe (FCF does not cover)';
    }
    const dividendLines = [
      dividendYield != null ? `- Dividend Yield: ${formatPercent(dividendYield)}` : null,
      dividendPerShare != null ? `- Annual Dividend/Share: $${dividendPerShare.toFixed(2)}` : null,
      divPayoutRatio != null ? `- Payout Ratio (EPS): ${divPayoutRatio.toFixed(1)}%` : null,
      divCoverage != null ? `- FCF Coverage Ratio: ${divCoverage.toFixed(2)}x` : null,
      `- Dividend Safety: ${divSafety}`,
      overview.exDividendDate ? `- Ex-Dividend Date: ${overview.exDividendDate}` : null,
      overview.dividendDate ? `- Dividend Pay Date: ${overview.dividendDate}` : null,
    ].filter(Boolean) as string[];
    sections.push('## 💵 Dividend Analysis', ...dividendLines);
  }

  // DCF Valuation section — simplified intrinsic value estimate
  const dcfSharesOutstanding = toNumber(overview.sharesOutstanding);
  const dcfBeta = toNumber(overview.beta);
  const dcfAnnualReports = data.cashFlow?.annualReports || [];
  const dcfFCFs: number[] = [];
  for (const report of dcfAnnualReports.slice(0, 5)) {
    const ocf = report?.operatingCashflow != null ? Number(report.operatingCashflow) : null;
    const capex = report?.capitalExpenditures != null ? Math.abs(Number(report.capitalExpenditures)) : null;
    if (ocf != null && capex != null && Number.isFinite(ocf) && Number.isFinite(capex)) {
      dcfFCFs.push(ocf - capex);
    }
  }
  if (dcfFCFs.length > 0 && dcfSharesOutstanding && dcfSharesOutstanding > 0 && price !== null) {
    const latestFCF = dcfFCFs[0];
    let dcfGrowth = 0.05;
    const dcfRevGrowth = toNumber(overview.quarterlyRevenueGrowth);
    if (dcfFCFs.length >= 2 && dcfFCFs[dcfFCFs.length - 1] > 0) {
      const cagr = Math.pow(dcfFCFs[0] / dcfFCFs[dcfFCFs.length - 1], 1 / (dcfFCFs.length - 1)) - 1;
      if (Number.isFinite(cagr) && cagr > -0.5 && cagr < 1.0) dcfGrowth = Math.min(cagr, 0.25);
    } else if (dcfRevGrowth != null && Number.isFinite(dcfRevGrowth)) {
      dcfGrowth = Math.min(Math.max(dcfRevGrowth, -0.1), 0.25);
    }
    const riskFree = 0.04;
    const erp = 0.05;
    const eBeta = dcfBeta != null && Number.isFinite(dcfBeta) && dcfBeta > 0 ? dcfBeta : 1.0;
    const dcfWacc = riskFree + eBeta * erp;
    const termGrowth = 0.025;
    let dcfTotalPV = 0;
    let projFCF = latestFCF;
    for (let yr = 1; yr <= 10; yr++) {
      const effectiveGrowth = yr <= 5
        ? dcfGrowth
        : dcfGrowth * (1 - (yr - 5) / 5) + termGrowth * ((yr - 5) / 5);
      projFCF *= (1 + effectiveGrowth);
      dcfTotalPV += projFCF / Math.pow(1 + dcfWacc, yr);
    }
    const termFCF = projFCF * (1 + termGrowth);
    const termVal = termFCF / (dcfWacc - termGrowth);
    const termPV = termVal / Math.pow(1 + dcfWacc, 10);
    const ev = dcfTotalPV + termPV;
    const nDebt = (toNumber(overview.longTermDebt) || 0) - (toNumber(overview.cashAndEquivalents) || 0);
    const eqVal = ev - (Number.isFinite(nDebt) ? nDebt : 0);
    const intrinsic = eqVal / dcfSharesOutstanding;
    const mos = ((intrinsic - price) / intrinsic) * 100;
    let dcfVerdict = 'Unavailable';
    if (Number.isFinite(mos)) {
      if (mos > 30) dcfVerdict = '🟢 Significantly Undervalued';
      else if (mos > 15) dcfVerdict = '🟢 Moderately Undervalued';
      else if (mos > 0) dcfVerdict = '🟡 Slightly Undervalued';
      else if (mos > -15) dcfVerdict = '🟡 Fairly Valued';
      else if (mos > -30) dcfVerdict = '🟠 Moderately Overvalued';
      else dcfVerdict = '🔴 Significantly Overvalued';
    }
    if (Number.isFinite(intrinsic)) {
      sections.push(
        '## 📐 DCF Valuation Estimate',
        '_Simplified 10-year DCF model. Not investment advice — estimates depend on assumptions._',
        buildTable(
          ['Metric', 'Value'],
          [
            ['**Intrinsic Value / Share**', `$${intrinsic.toFixed(2)}`],
            ['**Current Price**', formatPrice(price)],
            ['**Margin of Safety**', `${mos.toFixed(1)}%`],
            ['**Verdict**', dcfVerdict],
            ['Growth Rate Used', `${(dcfGrowth * 100).toFixed(1)}%`],
            ['WACC (Discount Rate)', `${(dcfWacc * 100).toFixed(1)}%`],
            ['Terminal Growth', `${(termGrowth * 100).toFixed(1)}%`],
            ['Beta', `${eBeta.toFixed(2)}`],
            ['Latest FCF', formatCurrency(latestFCF)],
          ],
          ['left', 'right']
        ),
      );
    }
  }

  sections.push(
    '## 🧮 Valuation & Multiples',
    valuationTable,
    `- 52-Week Range: ${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`,
    ...(fromHigh !== null ? [`- Price vs 52-Week High: ${fromHigh.toFixed(1)}%`] : []),
    ...(fromLow !== null ? [`- Price vs 52-Week Low: ${fromLow.toFixed(1)}%`] : []),
  );

  // Moat section — placed after the financial charts and data so existing sections stay in their original positions
  if (data.moatAnalysis) {
    sections.push(buildStockMoatSection(data.moatAnalysis, scorecard.moatDetails));
  }

  sections.push('## 🚀 Growth Drivers', '- Period: trailing twelve months unless noted', ...(growthLines.length ? growthLines : ['- Growth drivers unavailable']));
  sections.push('## ⏱️ Timing & Trade Setup', ...(timingLines.length ? timingLines : ['- Timing data unavailable']));
  sections.push('## 🎯 Position Guidance', POSITION_GUIDANCE_NOTE, positionGuidanceTable);
  sections.push('## ⚠️ Risks & Headwinds', ...(riskLines.length ? riskLines : ['- No major risk flags surfaced from available data']));
  sections.push('## 🧭 Investment Highlights', ...highlightsLines);

  const hasRatings = [data.analystRatings?.strongBuy, data.analystRatings?.buy, data.analystRatings?.hold]
    .map((value) => toNumber(value))
    .some((value) => value !== null);
  if (analystTarget !== null || hasRatings || targetChart || recommendationTable) {
    sections.push('## 🧠 Analyst View');
    if (analystTarget !== null) sections.push(`- Target Mean: ${analystTarget.toFixed(2)}`);
    if (hasRatings) {
      sections.push(`- Ratings: Strong Buy ${data.analystRatings?.strongBuy || 'Unavailable'} / Buy ${data.analystRatings?.buy || 'Unavailable'} / Hold ${data.analystRatings?.hold || 'Unavailable'}`);
    }
    if (targetChart) sections.push(targetChart);
    if (recommendationTable) {
      sections.push('### Recommendation Trend');
      sections.push(recommendationTable);
    }
  }

  sections.push('## 🧑‍💼 Ownership, Insider Activity & Sentiment', ...(ownershipLines.length ? ownershipLines : ['- Ownership data unavailable']));
  if (insiderSummary.table) {
    sections.push('### Recent Insider Transactions');
    sections.push(insiderSummary.table);
  }
  sections.push('## 🗓️ Guidance & Catalysts', ...(catalystLines.length ? catalystLines : ['- Guidance data unavailable']));
  if (alternativeLines.length) {
    sections.push('## 🔄 Alternative Stocks To Research', ...alternativeLines);
  }

  if (scorecard.composite !== null) {
    const scorecardRadar = buildScorecardRadar(scorecard);
    sections.push(
      '## ✅ Scorecard',
      ...(scorecardRadar ? [scorecardRadar] : []),
      '- Radar chart shows normalized component scores (0-100).',
      `- Growth: ${scorecard.components.growth?.toFixed(1) ?? 'Unavailable'} (avg of revenue/EPS growth %)`,
      `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'Unavailable'} (avg of gross/operating margin, ROE)`,
      `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'Unavailable'} (100 - PE/50*100)`,
      `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'Unavailable'}`,
      `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'Unavailable'} (data-derived: avg of margin stability, pricing power, analyst conviction)${data.moatAnalysis ? ` | LLM Moat Score: ${Math.round(data.moatAnalysis.moatScore)}/100 (${data.moatAnalysis.moatStrength})` : ''}`,
      `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'Unavailable'}`,
    );
  }

  sections.push(buildStockConclusion(data, scorecard));

  return sections.filter(Boolean).join('\n\n');
}

export async function saveReport(
  content: string,
  title: string,
  directory = DEFAULT_REPORTS_DIR,
  metadata: { reportKind?: string; summary?: string } = {}
) {
  const safeTitle = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const createdAt = new Date();
  const reportDate = createdAt.toISOString().slice(0, 10);
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-');
  const filename = `${safeTitle || 'report'}-${timestamp}.md`;
  const storagePath = path.posix.join(reportDate, filename);
  const codeFence = String.fromCharCode(96).repeat(3);
  const fallbackTitle = title.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()).trim();
  const derivedTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackTitle;
  const derivedSummary = metadata.summary
    || content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line
        && !line.startsWith('#')
        && !line.startsWith('|')
        && !line.startsWith(codeFence)
        && !line.startsWith('- ')
        && !line.startsWith('_Legend:')
      );

  let supabaseId: string | undefined;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && supabaseKey) {
    try {
      const { getSupabaseClient } = await import('./supabaseClient');
      const client = getSupabaseClient();
      if (client) {
        let insertResult = await client
          .from('saved_reports')
          .insert({
            filename,
            title: derivedTitle,
            summary: derivedSummary || null,
            content,
            storage_path: storagePath,
            report_kind: metadata.reportKind || null,
            report_date: reportDate,
          })
          .select('id')
          .single();

        if (insertResult.error && /column .* does not exist|schema cache/i.test(insertResult.error.message)) {
          insertResult = await client
            .from('saved_reports')
            .insert({ filename, title: derivedTitle, content })
            .select('id')
            .single();
        }

        if (insertResult.error) {
          if (insertResult.error.message.includes('schema cache') || insertResult.error.message.includes('does not exist')) {
            console.error('[saveReport] Supabase table missing columns — run the saved_reports migration in the SQL editor to enable grouped library metadata.');
          } else {
            console.error('[saveReport] Supabase insert error:', insertResult.error.message);
          }
        } else if (insertResult.data?.id) {
          supabaseId = insertResult.data.id as string;
        }
      }
    } catch (err) {
      console.error('[saveReport] Supabase unexpected error:', err);
    }
  }

  let filePath = path.join(directory, reportDate, filename);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  } catch {
    filePath = path.join('/tmp', 'reports', reportDate, filename);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
    } catch {
      // Filesystem not available — Supabase is the source of truth
    }
  }

  return {
    filePath,
    filename,
    supabaseId,
    storagePath,
    reportDate,
    title: derivedTitle,
    summary: derivedSummary,
    reportKind: metadata.reportKind,
  };
}

export function buildComparisonReport(data: ComparisonReportData): string {
  const header = `# Company Comparison Report`;
  const notes = data.notes?.length ? data.notes.map((note) => `- ${note}`).join('\n') : '';
  const sources = data.sources || {};
  const provider = (process.env.STOCK_DATA_PROVIDER || 'alphavantage').toLowerCase();
  const sourceLegend = provider === 'hybrid'
    ? '_Legend: Alpha Vantage is primary; Finnhub fills gaps._'
    : provider === 'finnhub'
      ? '_Legend: Finnhub provider._'
      : provider === 'fmp'
        ? '_Legend: Financial Modeling Prep provider._'
        : provider === 'twelvedata'
          ? '_Legend: Twelve Data provider._'
          : provider === 'stooq'
            ? '_Legend: Stooq provider._'
            : provider === 'multi'
              ? '_Legend: Multi-source chain: Alpha Vantage → Finnhub → Financial Modeling Prep → Twelve Data → Stooq._'
              : '_Legend: Alpha Vantage provider._';
  const items = data.items;

  const sourceRows = Object.entries(sources).map(([symbol, map]) => {
    const lookup = items.find((item) => item.symbol === symbol);
    const name = lookup?.overview?.name || symbol;
    const pick = (key: string) => map[key] || 'N/A';
    return [
      `${name} (${symbol})`,
      pick('Price'),
      pick('Company overview'),
      pick('Basic financials'),
      pick('Price history'),
      pick('Income statement'),
      pick('Balance sheet'),
      pick('Cash flow'),
      pick('Insider trading'),
      pick('Analyst ratings'),
      pick('Price targets'),
      pick('Peers'),
      pick('News sentiment'),
      pick('Company news'),
    ];
  });
  const sourceTable = sourceRows.length
    ? buildTable(
        ['Company', 'Price', 'Overview', 'Basic', 'Price History', 'Income', 'Balance', 'Cash Flow', 'Insider', 'Analyst', 'Targets', 'Peers', 'News Sentiment', 'Company News'],
        sourceRows,
        ['left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center']
      )
    : '';

  const snapshotRows = items.map((item) => {
    const overview = item.overview || {};
    const price = toNumber(item.price?.price);
    const changePercent = item.price?.changePercent;
    const changeValue = typeof changePercent === 'string'
      ? Number(changePercent.replace('%', ''))
      : changePercent;
    const changeIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatPrice(price),
      formatSignedPercentValue(changeValue, 2, { alreadyPercent: changeIsPercent }),
      formatCurrency(overview.marketCapitalization),
      overview.sector || 'N/A',
      overview.industry || 'N/A',
      `${formatCurrency(overview['52WeekLow'])} - ${formatCurrency(overview['52WeekHigh'])}`,
    ];
  });

  const snapshotTable = buildTable(
    ['Company', 'Price', 'Day Change', 'Market Cap', 'Sector', 'Industry', '52W Range'],
    snapshotRows,
    ['left', 'right', 'right', 'right', 'left', 'left', 'right']
  );

  const scaleRows = items.map((item) => {
    const overview = item.overview || {};
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatCurrency(overview.revenueTTM),
      formatPercent(item.basicFinancials?.metric?.grossMarginTTM ?? overview.profitMargin),
      formatPercent(item.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin),
      formatPercent(item.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity),
    ];
  });
  const scaleTable = buildTable(
    ['Company', 'Revenue (TTM)', 'Gross Margin', 'Operating Margin', 'ROE'],
    scaleRows,
    ['left', 'right', 'right', 'right', 'right']
  );

  const growthRows = items.map((item) => {
    const revenueGrowth = getStockRevenueGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const epsGrowth = getStockEpsGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const priceChange = computePriceChange(item.priceHistory?.prices || []);
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      formatPercent(revenueGrowth),
      formatPercent(epsGrowth),
      priceChange === null ? 'N/A' : formatSignedPercentValue(priceChange, 1, { alreadyPercent: true }),
    ];
  });
  const growthTable = buildTable(
    ['Company', 'Revenue Growth (TTM)', 'EPS Growth (TTM)', `${data.range} Price Change`],
    growthRows,
    ['left', 'right', 'right', 'right']
  );

  const valuationRows = items.map((item) => {
    const overview = item.overview || {};
    const price = toNumber(item.price?.price);
    const bookValue = toNumber(overview.bookValue);
    const revenuePerShare = toNumber(overview.revenuePerShare);
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM)?.toFixed(1) ?? 'N/A',
      toNumber(overview.forwardPE)?.toFixed(1) ?? 'N/A',
      toNumber(overview.pegRatio)?.toFixed(2) ?? 'N/A',
      price && revenuePerShare ? (price / revenuePerShare).toFixed(2) : 'N/A',
      price && bookValue ? (price / bookValue).toFixed(2) : 'N/A',
    ];
  });
  const valuationTable = buildTable(
    ['Company', 'P/E', 'Forward P/E', 'PEG', 'Price/Sales', 'Price/Book'],
    valuationRows,
    ['left', 'right', 'right', 'right', 'right', 'right']
  );

  const balanceRows = items.map((item) => {
    const balance = getMostCompleteReport(item.balanceSheet, ['cashAndEquivalents', 'longTermDebt', 'totalAssets', 'totalLiabilities', 'totalShareholderEquity']);
    const cashFlow = getMostCompleteReport(item.cashFlow, ['operatingCashflow', 'capitalExpenditures', 'freeCashFlow', 'dividendPayout']);
    const cash = toNumber(balance?.cashAndEquivalents);
    const debt = toNumber(balance?.longTermDebt);
    const netDebt = cash !== null && debt !== null ? debt - cash : null;
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      formatCurrency(cash),
      formatCurrency(debt),
      netDebt === null ? "N/A" : formatCurrency(netDebt),
      formatCurrency(balance?.totalShareholderEquity),
      formatCurrency(deriveFreeCashFlow(cashFlow)),
    ];
  });
  const balanceTable = buildTable(
    ['Company', 'Cash', 'LT Debt', 'Net Debt', 'Equity', 'Free Cash Flow'],
    balanceRows,
    ['left', 'right', 'right', 'right', 'right', 'right']
  );
  const hasBalanceData = balanceRows.some((row) => row.slice(1).some(hasMeaningfulTableValue));

  const ownershipRows = items.map((item) => {
    const overview = item.overview || {};
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      getOwnershipDisplayValue(item, 'insider'),
      getOwnershipDisplayValue(item, 'institutional'),
      getOwnershipDisplayValue(item, 'shortFloat'),
      formatRatingSummary(item),
    ];
  });
  const ownershipTable = buildTable(
    ['Company', 'Insider Own', 'Institutional Own', 'Short Float', 'Ratings'],
    ownershipRows,
    ['left', 'right', 'right', 'right', 'left']
  );
  const insiderSummaryTable = buildComparisonInsiderSummaryTable(items);

  const coverageRows = items.map((item) => {
    const overview = item.overview || {};
    const revenueGrowth = getStockRevenueGrowth({
      symbol: item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
    } as StockReportData);
    const pe = toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM);
    const marketCap = toNumber(overview.marketCapitalization);
    const hasPriceHistory = (item.priceHistory?.prices || []).length > 1;
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      hasPriceHistory ? '✅' : '—',
      revenueGrowth === null ? '—' : '✅',
      pe === null ? '—' : '✅',
      marketCap === null ? '—' : '✅',
    ];
  });
  const coverageTable = buildTable(
    ['Company', 'Price History', 'Revenue Growth', 'P/E', 'Market Cap'],
    coverageRows,
    ['left', 'center', 'center', 'center', 'center']
  );

  const analystRows = items.map((item) => {
    const price = toNumber(item.price?.price);
    // Cascade through three sources for the analyst price target:
    // 1. priceTargets.targetMean  (Finnhub /stock/price-target or FMP)
    // 2. analystRatings.analystTargetPrice  (AV/Finnhub getAnalystRatings fallback)
    // 3. overview.analystTargetPrice  (AV company overview — most reliable for AV provider)
    const target = toNumber(
      item.priceTargets?.targetMean
      ?? (item.analystRatings?.analystTargetPrice !== 'N/A' ? item.analystRatings?.analystTargetPrice : null)
      ?? item.overview?.analystTargetPrice
    );
    const upside = price && target ? ((target - price) / price) * 100 : null;
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      target === null ? 'N/A' : target.toFixed(2),
      upside === null ? 'N/A' : `${upside.toFixed(1)}%`,
      formatRatingSummary(item),
    ];
  });
  const analystTable = buildTable(
    ['Company', 'Target Mean', 'Upside', 'Ratings'],
    analystRows,
    ['left', 'right', 'right', 'left']
  );

  const upsideLeaders = analystRows
    .map((row, index) => ({
      symbol: items[index].symbol,
      upside: Number(String(row[2]).replace('%', '')),
      name: row[0],
    }))
    .filter((row) => Number.isFinite(row.upside));
  const topUpside = upsideLeaders.sort((a, b) => b.upside - a.upside)[0];

  const ratingLeaders = items
    .map((item) => {
      const ratings = item.analystRatings || item.overview || {};
      const strongBuy = toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy);
      const buy = toNumber(ratings.buy ?? ratings.analystRatingBuy);
      const hold = toNumber(ratings.hold ?? ratings.analystRatingHold);
      const sell = toNumber(ratings.sell ?? ratings.analystRatingSell);
      const strongSell = toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell);
      const total = [strongBuy, buy, hold, sell, strongSell]
        .filter((value) => value !== null)
        .reduce((sum, value) => sum + (value as number), 0);
      const score = total ? ((strongBuy || 0) + (buy || 0)) / total : null;
      return { symbol: item.symbol, name: item.overview?.name || item.symbol, score };
    })
    .filter((row) => row.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topRating = ratingLeaders[0];

  const scored = scoreComparisonItems(items, data.generatedAt);

  const timingRows = scored.map((row) => {
    const stockData = asStockReportData(row.item, data.generatedAt);
    const overview = stockData.companyOverview || {};
    const price = toNumber(stockData.price?.price);
    const technical = getTechnicalSnapshot(price, stockData.priceHistory?.prices || [], {
      ...overview,
      ['50DayMovingAverage']: overview['50DayMovingAverage'] ?? stockData.analystRatings?.movingAverage50Day,
    });
    const upside = getTargetUpsideStock(stockData);
    return [
      `${overview.name || row.item.symbol} (${row.item.symbol})`,
      technical.rsi14 === null ? 'N/A' : `${technical.rsi14.toFixed(1)} (${technical.rsiState})`,
      technical.trend,
      upside === null ? 'N/A' : `${upside.toFixed(1)}%`,
    ];
  });
  const timingTable = buildTable(
    ['Company', 'RSI (14)', 'Trend', 'Target Upside'],
    timingRows,
    ['left', 'right', 'left', 'right']
  );

  const guidanceTable = buildPositionGuidanceTable(
    scored.map((row) => {
      const stockData = asStockReportData(row.item, data.generatedAt);
      const overview = stockData.companyOverview || {};
      return {
        company: `${overview.name || row.item.symbol} (${row.item.symbol})`,
        guidance: derivePositionGuidanceFromStock(stockData, row.score),
      };
    })
  );

  const validScores = scored.filter((row) => row.score !== null) as Array<{ item: ComparisonReportItem; score: number }>;
  const totalScore = validScores.reduce((sum, row) => sum + (row.score ?? 0), 0);
  const weights = scored.map((row) => {
    if (!validScores.length || totalScore === 0) {
      return 100 / scored.length;
    }
    if (row.score === null) return null;
    return (row.score / totalScore) * 100;
  });

  const revenueLeaders = [...scored].sort((a, b) => {
    const aGrowth = getStockRevenueGrowth({
      symbol: a.item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: a.item.overview,
      basicFinancials: a.item.basicFinancials,
    } as StockReportData) ?? -Infinity;
    const bGrowth = getStockRevenueGrowth({
      symbol: b.item.symbol,
      generatedAt: '',
      price: {},
      companyOverview: b.item.overview,
      basicFinancials: b.item.basicFinancials,
    } as StockReportData) ?? -Infinity;
    return bGrowth - aGrowth;
  });
  const topGrowth = revenueLeaders[0]?.item.symbol;

  const marginLeaders = [...scored].sort((a, b) => {
    const aMargin = normalizePercent(a.item.basicFinancials?.metric?.operatingMarginTTM ?? a.item.overview?.operatingMargin) ?? -Infinity;
    const bMargin = normalizePercent(b.item.basicFinancials?.metric?.operatingMarginTTM ?? b.item.overview?.operatingMargin) ?? -Infinity;
    return bMargin - aMargin;
  });
  const topMargin = marginLeaders[0]?.item.symbol;

  // Build allocation entries with weights and reasons, then sort highest → lowest
  const allocationEntries = scored.map((row, index) => {
    const moatScore = row.item.moatAnalysis?.moatScore ?? null;
    const reasons = [
      row.item.symbol === topGrowth ? 'Top revenue growth' : null,
      row.item.symbol === topMargin ? 'Best operating margin' : null,
      row.score !== null && row.score > 60 ? 'Strong composite score' : null,
      moatScore !== null && moatScore >= 61 ? `Wide moat (${row.item.moatAnalysis!.moatType})` : null,
    ].filter(Boolean);
    return {
      weight: weights[index],
      row: [
        `${row.item.overview?.name || row.item.symbol} (${row.item.symbol})`,
        row.score === null ? 'N/A' : row.score.toFixed(1),
        weights[index] === null ? 'N/A' : `${weights[index]!.toFixed(1)}%`,
        weights[index] === null ? 'Insufficient data' : (reasons.length ? reasons.join('; ') : 'Balanced exposure'),
      ],
    };
  });
  // Sort descending by weight (null weights go last)
  allocationEntries.sort((a, b) => {
    if (a.weight === null && b.weight === null) return 0;
    if (a.weight === null) return 1;
    if (b.weight === null) return -1;
    return b.weight - a.weight;
  });
  const allocationRows = allocationEntries.map((e) => e.row);
  const allocationTable = buildTable(
    ['Company', 'Composite Score', 'Indicative Weight', 'Rationale'],
    allocationRows,
    ['left', 'right', 'right', 'left']
  );

  const moatSection = buildComparisonMoatSection(items);
  const performanceChart = buildComparisonPerformanceChart(
    items.map((item) => ({ symbol: item.symbol, priceHistory: item.priceHistory } as ComparisonReportItem)),
    `Price Performance (${data.range}, Indexed)`
  );
  const scatterChart = buildValuationGrowthScatter(items);
  const marginChart = buildMarginComparisonChart(items);

  const debugMode = process.env.DEBUG === 'true';
  const sections = [
    header,
    `Generated: ${data.generatedAt}`,
    `Universe: ${data.universe.join(', ')}`,
    notes ? `## ⚠️ Data Gaps\n${notes}` : null,
    debugMode && sourceTable ? '## 🧾 Data Sources' : null,
    debugMode && sourceTable ? `${sourceLegend}\n\n${sourceTable}` : null,
    '## 📊 Snapshot',
    snapshotTable,
    '## 🧾 Scale & Profitability',
    scaleTable,
    '## 🚀 Growth & Momentum',
    growthTable,
    '## 🧮 Valuation',
    valuationTable,
    hasBalanceData ? '## 🏦 Balance Sheet & Cash' : null,
    hasBalanceData ? balanceTable : null,
    '## ⏱️ Timing & Action Setup',
    timingTable,
    '## 🎯 Position Guidance',
    POSITION_GUIDANCE_NOTE,
    guidanceTable,
    '## 🧑‍💼 Ownership & Positioning',
    ownershipTable,
    '## 🧾 Insider Activity Summary',
    insiderSummaryTable,
    '_Counts and disclosed values reflect only the recent insider transaction feed returned by the active providers._',
    '## 🧠 Analyst View',
    analystTable,
    '## ⭐ Analyst Picks',
    `- Highest target upside: ${topUpside ? `${topUpside.name} (${topUpside.upside.toFixed(1)}%)` : 'N/A'}`,
    `- Strongest consensus: ${topRating ? `${topRating.name} (${(topRating.score! * 100).toFixed(0)}% buy/strong buy)` : 'N/A'}`,
    moatSection || null,
    debugMode ? '## 🧩 Data Coverage (Chart Inputs)' : null,
    debugMode ? coverageTable : null,
    '## 📈 Price Performance (Indexed)',
    performanceChart || '_Price performance data unavailable._',
    '## 📊 Valuation vs Growth',
    scatterChart || '_Valuation/growth data unavailable._',
    '## 📊 Margin Comparison',
    marginChart || '_Margin comparison data unavailable._',
    '## 🧭 Indicative Allocation (Not Investment Advice)',
    allocationTable,
    validScores.length < scored.length
      ? '_Some companies lack composite scores; weights are normalized across available scores._'
      : '_Indicative allocation is derived from normalized composite scores. It is not investment advice._',
    buildComparisonConclusion(items, scored, 'comparison', undefined, data.llmConclusion),
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}

/**
 * Computes composite scores for a set of ComparisonReportItems.
 * Extracted as a shared helper so sector/deep-sector reports can produce
 * a theme-aware conclusion without re-running the full comparison pipeline.
 */
function scoreComparisonItems(
  items: ComparisonReportItem[],
  generatedAt: string
): Array<{ item: ComparisonReportItem; score: number | null }> {
  return items.map((item) => {
    if (item.decisionSnapshot?.overallScore !== null && item.decisionSnapshot?.overallScore !== undefined) {
      return { item, score: item.decisionSnapshot.overallScore };
    }
    const scorecard = computeScorecard({
      symbol: item.symbol,
      generatedAt,
      price: item.price || {},
      companyOverview: item.overview,
      basicFinancials: item.basicFinancials,
      incomeStatement: item.incomeStatement,
      balanceSheet: item.balanceSheet,
      cashFlow: item.cashFlow,
      analystRatings: item.analystRatings,
      priceTargets: item.priceTargets,
    });
    return { item, score: scorecard.composite };
  });
}

/**
 * Strips the generic "## 🎯 Investment Conclusion" block from a comparison-report
 * body so that sector / deep-sector reports can substitute their own version.
 */
function splitComparisonConclusion(body: string): { body: string; conclusion: string } {
  const match = body.match(/\n\n## 🎯 Investment Conclusion[\s\S]*$/);
  if (!match || match.index === undefined) {
    return { body, conclusion: '' };
  }
  return {
    body: body.slice(0, match.index),
    conclusion: match[0].trim(),
  };
}

function stripComparisonConclusion(body: string): string {
  return splitComparisonConclusion(body).body;
}

/**
 * Builds a sector / thematic analysis report.
 *
 * The universe of companies was identified by the LLM based on the sector query.
 * All comparison data (financials, price history, analyst ratings, etc.) is pulled
 * from market-data APIs exactly as in `buildComparisonReport` — the only
 * difference is the sector-specific header that explains how the universe was
 * chosen.
 */
export function buildSectorReport(data: SectorReportData): string {
  const selectionNote =
    data.selectedBy === 'llm'
      ? `The following ${data.universe.length} companies were identified by AI as top players in the **"${data.sectorQuery}"** space.`
      : `The following ${data.universe.length} companies were selected for the **"${data.sectorQuery}"** sector analysis.`;

  const sectorHeader = [
    `# Sector / Thematic Analysis: ${data.sectorQuery}`,
    `Generated: ${data.generatedAt}`,
    '## 🔍 Universe Selection',
    selectionNote,
    `**Companies:** ${data.universe.join(', ')}`,
  ].join('\n\n');

  // Re-use the full comparison report body (strip its own header/generated line
  // and generic conclusion so they are not duplicated).
  const comparisonBody = stripComparisonConclusion(
    buildComparisonReport(data)
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\n/, '')
      .trimStart()
  );
  const scored = scoreComparisonItems(data.items, data.generatedAt);
  const conclusion = buildComparisonConclusion(data.items, scored, 'sector', data.sectorQuery, data.llmConclusion);

  return `${sectorHeader}\n\n${comparisonBody}\n\n${conclusion}`;
}

/**
 * Builds a deep sector research report.
 *
 * Extends the sector report with three additional sections produced during the
 * AI-driven ecosystem analysis phase:
 *   1. Research methodology overview (initial candidates → refinement → comparison)
 *   2. Sector ecosystem & dependency analysis (supply chain, customers, macro factors)
 *   3. Company selection rationale (why specific companies were kept or excluded)
 *   4. Mermaid dependency map diagram
 *
 * The financial comparison tables and charts are identical to the regular sector
 * report — the extra depth comes from the pre-report analysis phase.
 */
export function buildDeepSectorReport(data: DeepSectorReportData): string {
  const initialCount = data.initialCandidates?.length ?? 0;
  const refinedCount = data.universe.length;

  const candidateLine = initialCount > 0
    ? `**Initial candidates screened:** ${data.initialCandidates!.join(', ')}`
    : '';
  const refinedLine = initialCount > refinedCount
    ? `**Refined to ${refinedCount} companies:** ${data.universe.join(', ')}`
    : `**Final universe (${refinedCount} companies):** ${data.universe.join(', ')}`;

  const methodologySteps = [
    `1. **Candidate Identification** — AI identified ${initialCount > 0 ? `${initialCount} initial` : 'a set of'} companies in the **"${data.sectorQuery}"** space`,
    `2. **Ecosystem Analysis** — Supply chain, customer, market, and news dependencies were mapped across all candidates`,
    `3. **Refinement** — The list was refined to ${refinedCount} companies best suited for deep financial comparison`,
    `4. **Comparison** — Full financial comparison built for the refined universe`,
  ].join('\n');

  const header = [
    `# Deep Sector Research: ${data.sectorQuery}`,
    `Generated: ${data.generatedAt}`,
    `## 🔬 Research Methodology`,
    methodologySteps,
    candidateLine,
    refinedLine,
  ].filter(Boolean).join('\n\n');

  // ── Sector Ecosystem & Dependencies ─────────────────────────────────────
  // The dependencyAnalysis string is expected to use structured ### subsection
  // headers generated by the LLM prompt (Supply Chain, Customer Exposure, etc.).
  // We add a brief context line before the structured content.
  const dependencySection = data.dependencyAnalysis
    ? (
        `## 🕸️ Sector Ecosystem & Dependencies\n\n` +
        `> _AI-generated analysis of inter-company relationships, market drivers, and competitive dynamics._\n\n` +
        data.dependencyAnalysis
      )
    : '';

  const diagramSection = data.ecosystemDiagram
    ? `## 🗺️ Sector Dependency Map\n\n\`\`\`mermaid\n${data.ecosystemDiagram}\n\`\`\``
    : '';

  // ── Company Selection Rationale ──────────────────────────────────────────
  // Parse the ✅ / ❌ per-company lines produced by the LLM and render them as
  // a markdown table for a cleaner, scannable layout.
  const refinementSection = data.refinementNotes
    ? `## 🎯 Company Selection Rationale\n\n${formatRationaleAsTable(data.refinementNotes)}`
    : '';

  // ── Selected Companies at a Glance ───────────────────────────────────────
  // Render per-company investment snapshots as a table so readers can quickly
  // grasp why each company made the final list.
  const snapshotsSection = buildCompanySnapshotsSection(data.universe, data.companySnapshots);

  // Re-use comparison report body — strip the comparison header and generic
  // conclusion so they are not duplicated (deep-sector adds its own conclusion).
  const comparisonBody = stripComparisonConclusion(
    buildComparisonReport(data)
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\n/, '')
      .trimStart()
  );
  const insiderSections = buildDeepInsiderSections(data.items);

  const scored = scoreComparisonItems(data.items, data.generatedAt);
  const conclusion = buildComparisonConclusion(data.items, scored, 'deep-sector', data.sectorQuery, data.llmConclusion);

  return [header, dependencySection, diagramSection, refinementSection, snapshotsSection, comparisonBody, insiderSections, conclusion]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Parses per-company ✅/❌ rationale lines and renders them as a markdown table.
 * Falls back to the raw text if the format does not match the expected pattern.
 *
 * Expected input line format (one per company):
 *   ✅ TICKER (Company Name) — reason
 *   ❌ TICKER (Company Name) — reason
 */
function stripStockReportHeader(body: string): string {
  return body
    .replace(/^# .+ Comprehensive Equity Research Report\n\nGenerated:[^\n]*\n\n/, '')
    .trimStart();
}

function shiftMarkdownHeadings(body: string, levels = 1): string {
  return body.replace(/^(#{1,6})\s+/gm, (_line, hashes) => '#'.repeat(Math.min(6, hashes.length + levels)) + ' ');
}

function buildWatchlistDecision(item: WatchlistDailyReportItem): { action: ActionLabel; reason: string; score: number | null } {
  const scorecard = computeScorecard(item.stock);
  if (item.action && item.reason) {
    return {
      action: normalizeActionLabel(item.action),
      reason: item.reason,
      score: item.stock.decisionSnapshot?.overallScore ?? scorecard.composite,
    };
  }
  if (item.stock.decisionSnapshot) {
    return {
      action: actionFromDecisionSnapshot(item.stock.decisionSnapshot.action),
      reason: item.stock.decisionSnapshot.summary,
      score: item.stock.decisionSnapshot.overallScore,
    };
  }

  const guidance = derivePositionGuidanceFromStock(item.stock, scorecard.composite);
  return { action: guidance.stance, reason: guidance.rationale, score: scorecard.composite };
}

function buildWatchlistSummaryTable(items: WatchlistDailyReportItem[]): string {
  const rows = items.map((item) => {
    const decision = buildWatchlistDecision(item);
    const guidance = item.action && item.reason
      ? derivePositionGuidanceFromExplicitAction(decision.action, decision.reason)
      : derivePositionGuidanceFromStock(item.stock, decision.score);
    const name = item.companyName || item.stock.companyOverview?.name || item.symbol;
    return { company: `${name} (${item.symbol})`, guidance };
  });

  return [
    '## Position Guidance',
    POSITION_GUIDANCE_NOTE,
    buildPositionGuidanceTable(rows),
  ].join('\n\n');
}

function buildWatchlistOverview(items: WatchlistDailyReportItem[]): string {
  const decisions = items.map((item) => ({ item, decision: buildWatchlistDecision(item) }));
  const counts = decisions.reduce<Record<ActionLabel, number>>((acc, entry) => {
    acc[entry.decision.action] += 1;
    return acc;
  }, { Buy: 0, Hold: 0, Watch: 0, Sell: 0 });

  const scored = decisions
    .filter((entry) => entry.decision.score !== null)
    .sort((a, b) => (b.decision.score as number) - (a.decision.score as number));
  const strongest = scored[0];
  const weakest = scored[scored.length - 1];

  const lines = [
    `- **Signal Mix:** Buy ${counts.Buy} | Hold ${counts.Hold} | Watch ${counts.Watch} | Sell ${counts.Sell}`
  ];

  if (strongest) {
    lines.push(`- **Strongest setup:** ${(strongest.item.companyName || strongest.item.stock.companyOverview?.name || strongest.item.symbol)} (${strongest.item.symbol}) - ${strongest.decision.reason}`);
  }
  if (weakest && weakest !== strongest) {
    lines.push(`- **Name needing the most caution:** ${(weakest.item.companyName || weakest.item.stock.companyOverview?.name || weakest.item.symbol)} (${weakest.item.symbol}) - ${weakest.decision.reason}`);
  }

  return ['## Watchlist Overview', ...lines].join('\n');
}

function stripComparisonReportHeader(body: string): string {
  return body
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
    .replace(/^# Company Comparison Report\n\n/, '')
    .trimStart();
}

export function buildDeepStockReport(data: {
  query: string;
  symbol: string;
  generatedAt: string;
  baseContent: string;
}): string {
  const header = [
    '# Deep Research: ' + data.query,
    'Generated: ' + data.generatedAt,
    '## 🔬 Research Scope',
    '- Request: ' + data.query,
    '- Resolved ticker: ' + data.symbol,
    '- Mode: single-company deep research',
    '- Method: entity resolution -> full stock report generation',
    '- The request was kept as a single-company analysis; no thematic company expansion was applied.',
  ].join('\n\n');

  return [header, stripStockReportHeader(data.baseContent)]
    .filter(Boolean)
    .join('\n\n');
}

export function buildDeepComparisonReport(data: {
  query: string;
  symbols: string[];
  generatedAt: string;
  baseContent: string;
  items?: ComparisonReportItem[];
}): string {
  const header = [
    '# Deep Research: ' + data.query,
    'Generated: ' + data.generatedAt,
    '## 🔬 Research Scope',
    '- Request: ' + data.query,
    '- Companies: ' + data.symbols.join(', '),
    '- Mode: explicit-company deep comparison',
    '- Method: company resolution -> full comparison report generation',
    '- The request was kept as an explicit company set; no thematic company expansion was applied.',
  ].join('\n\n');

  const strippedBase = stripComparisonReportHeader(data.baseContent);
  const splitBase = splitComparisonConclusion(strippedBase);
  const insiderSections = data.items?.length ? buildDeepInsiderSections(data.items) : '';

  return [header, splitBase.body, insiderSections, splitBase.conclusion]
    .filter(Boolean)
    .join('\n\n');
}
export function buildWatchlistDailyReport(data: WatchlistDailyReportData): string {
  const header = [
    `# Watchlist Daily Report: ${data.watchlistName}`,
    `Generated: ${data.generatedAt}`,
    `**Companies covered:** ${data.items.length}`,
  ].join('\n\n');

  const summaryTable = buildWatchlistSummaryTable(data.items);
  const overview = buildWatchlistOverview(data.items);
  const companySections = data.items.map((item, index) => {
    const title = item.companyName || item.stock.companyOverview?.name || item.symbol;
    const body = shiftMarkdownHeadings(
      stripStockReportHeader(buildStockReport(item.stock)),
      1
    );
    return [
      `## ${index + 1}. ${title} (${item.symbol})`,
      body,
    ].join('\n\n');
  });

  return [header, summaryTable, overview, '## Full Company Research', ...companySections]
    .filter(Boolean)
    .join('\n\n');
}
function formatRationaleAsTable(notes: string): string {
  const lines = notes.split('\n').map(l => l.trim()).filter(Boolean);
  // Match: ✅ or ❌, then ticker (optionally followed by name in parens), then — or - separator, then reason
  const rowPattern = /^([✅❌])\s+([A-Z0-9.]+)(?:\s+\([^)]*\))?\s*[—-]\s*(.+)$/u;
  const rows: Array<{ status: string; ticker: string; reason: string }> = [];

  for (const line of lines) {
    const m = line.match(rowPattern);
    if (m) {
      rows.push({ status: m[1], ticker: m[2], reason: m[3].trim() });
    }
  }

  if (rows.length === 0) {
    // No parseable rows — return raw text unchanged
    return notes;
  }

  const tableHeader = '| Status | Company | Rationale |\n|:------:|---------|-----------|';
  const tableRows = rows.map(r => `| ${r.status} | **${r.ticker}** | ${r.reason} |`).join('\n');
  return `${tableHeader}\n${tableRows}`;
}

/**
 * Builds a "Selected Companies at a Glance" section from per-company snapshots.
 * Returns an empty string if no snapshot data is available.
 */
function buildCompanySnapshotsSection(
  universe: string[],
  snapshots?: Record<string, string>
): string {
  if (!snapshots || Object.keys(snapshots).length === 0) return '';

  // Only include companies that are in the final universe and have a snapshot
  const rows = universe
    .filter(ticker => ticker in snapshots && snapshots[ticker])
    .map(ticker => `| **${ticker}** | ${snapshots[ticker]} |`);

  if (rows.length === 0) return '';

  const tableHeader = '| Company | Investment Thesis |\n|---------|-------------------|';
  return `## 📋 Selected Companies at a Glance\n\n${tableHeader}\n${rows.join('\n')}`;
}

/**
 * Derives a plain-English investment rating from a 0-100 composite score,
 * optionally adjusted by analyst consensus.
 *
 * @param compositeScore  Normalized composite score (0-100) or null if unavailable
 * @param analystBuyPct   Fraction of analyst ratings that are Buy/Strong-Buy (0-1), or null
 */
function deriveRating(
  compositeScore: number | null,
  analystBuyPct: number | null
): { label: string; emoji: string } {
  if (compositeScore === null && analystBuyPct === null) {
    return { label: 'WATCH', emoji: '👀' };
  }

  // Start from composite score; fall back to analyst consensus if score unavailable
  let base = compositeScore ?? (analystBuyPct !== null ? analystBuyPct * 100 : 50);

  // Blend analyst consensus: shift base ±10 points toward analyst view
  if (analystBuyPct !== null && compositeScore !== null) {
    const analystSignal = (analystBuyPct - 0.5) * 20; // [-10, +10]
    base = base + analystSignal * 0.3;
  }

  if (base >= 65) return { label: 'BUY', emoji: '✅' };
  if (base >= 45) return { label: 'HOLD', emoji: '⚖️' };
  if (base >= 30) return { label: 'WATCH', emoji: '👀' };
  return { label: 'SELL / AVOID', emoji: '🔴' };
}

function deriveRatingFromGuidance(guidance: PositionGuidance): { label: string; emoji: string } {
  if (guidance.stance === 'Buy') return { label: guidance.confidence === 'High' ? 'BUY' : 'BUY CANDIDATE', emoji: '✅' };
  if (guidance.stance === 'Hold') return { label: 'HOLD', emoji: '⚖️' };
  if (guidance.stance === 'Watch') return { label: 'WATCH', emoji: '👀' };
  return { label: 'SELL / AVOID', emoji: '🔴' };
}

/**
 * Builds the Investment Conclusion section for a single-stock report.
 *
 * When `data.llmConclusion` is provided (generated by the LLM from all collected
 * API data before building the report), it is used as the primary narrative and
 * the structured data is appended as a quick-reference scorecard.
 * When the LLM narrative is absent, a rich data-driven fallback is used.
 */
function buildStockConclusion(data: StockReportData, scorecard: ReturnType<typeof computeScorecard>): string {
  const overview = data.companyOverview || {};
  const symbol = data.symbol;
  const name = overview.name || symbol;

  // Analyst buy fraction from real data
  const strongBuy = toNumber(data.analystRatings?.strongBuy);
  const buy = toNumber(data.analystRatings?.buy);
  const hold = toNumber(data.analystRatings?.hold);
  const sell = toNumber(data.analystRatings?.sell);
  const strongSell = toNumber(data.analystRatings?.strongSell);
  const totalAnalyst = [strongBuy, buy, hold, sell, strongSell].reduce<number>((s, v) => s + (v ?? 0), 0);
  const analystBuyPct = totalAnalyst > 0 && strongBuy !== null && buy !== null
    ? ((strongBuy + buy) / totalAnalyst)
    : null;

  const positionGuidance = derivePositionGuidanceFromStock(data, scorecard.composite);
  const rating = deriveRatingFromGuidance(positionGuidance);

  // Target upside — cascade: priceTargets → analystRatings → overview
  const price = toNumber(data.price?.price);
  const targetMean = toNumber(
    data.priceTargets?.targetMean
    ?? (data.analystRatings?.analystTargetPrice !== 'N/A' ? data.analystRatings?.analystTargetPrice : null)
    ?? overview.analystTargetPrice
  );
  const targetLow = toNumber(data.priceTargets?.targetLow);
  const targetHigh = toNumber(data.priceTargets?.targetHigh);
  const upside = price && targetMean ? ((targetMean - price) / price) * 100 : null;

  // ── Suggested portfolio role ──────────────────────────────────────────────
  const moat = data.moatAnalysis;
  const composite = data.decisionSnapshot?.overallScore ?? scorecard.composite;
  const portfolioRole = derivePortfolioRoleLabel(data, scorecard, positionGuidance);

  // ── Data-derived quick-reference metrics ─────────────────────────────────
  const revenueGrowth = getStockRevenueGrowth(data);
  const opMargin = normalizePercent(
    data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin
  );
  const grossMargin = normalizePercent(
    data.basicFinancials?.metric?.grossMarginTTM ?? overview.profitMargin
  );
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity);
  const pe = toNumber(overview.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  const technical = getTechnicalSnapshot(price, data.priceHistory?.prices || [], {
    ...overview,
    ['50DayMovingAverage']: overview['50DayMovingAverage'] ?? data.analystRatings?.movingAverage50Day,
  });
  const beta = toNumber(overview.beta);

  const dataLines: string[] = [
    `- **Rating:** ${rating.emoji} ${rating.label}`,
    `- **Suggested Portfolio Role:** ${portfolioRole}`,
    `- **Confidence:** ${positionGuidance.confidence}`,
    `- **For Owners:** ${positionGuidance.forOwners}`,
    `- **For Non-Owners:** ${describeNonOwnerAction(positionGuidance.forNonOwners)}`,
    `- **Why:** ${positionGuidance.rationale}`,
    positionGuidance.missingInputs.length ? `- **Decision Inputs Missing:** ${formatMissingInputs(positionGuidance.missingInputs, 3)}` : null,
    composite !== null ? `- **Composite Score:** ${composite.toFixed(1)}/100` : null,
    upside !== null ? `- **Analyst Target Upside:** ${upside.toFixed(1)}% (mean ${targetMean?.toFixed(2)}${targetLow !== null && targetHigh !== null ? `, range ${targetLow.toFixed(2)}–${targetHigh.toFixed(2)}` : ''})` : null,
    revenueGrowth !== null ? `- **Revenue Growth (TTM):** ${revenueGrowth.toFixed(1)}%` : null,
    opMargin !== null ? `- **Operating Margin:** ${opMargin.toFixed(1)}%` : null,
    grossMargin !== null ? `- **Gross Margin:** ${grossMargin.toFixed(1)}%` : null,
    roe !== null ? `- **Return on Equity:** ${roe.toFixed(1)}%` : null,
    pe !== null ? `- **P/E Ratio:** ${pe.toFixed(1)}x` : null,
    beta !== null ? `- **Beta:** ${beta.toFixed(2)}` : null,
    technical.rsi14 !== null ? `- **RSI (14):** ${technical.rsi14.toFixed(1)} (${technical.rsiState})` : null,
    `- **Trend:** ${technical.trend}`,
    moat ? `- **Moat:** ${moat.moatType} · ${moat.moatStrength} (${moat.moatScore}/100)` : null,
    totalAnalyst > 0 ? `- **Analyst Consensus:** ${strongBuy ?? 0} Strong Buy · ${buy ?? 0} Buy · ${hold ?? 0} Hold · ${sell ?? 0} Sell · ${strongSell ?? 0} Strong Sell` : null,
  ].filter(Boolean) as string[];

  // ── LLM-generated narrative (if available) ───────────────────────────────
  if (data.llmConclusion) {
    return [
      '## 🎯 Investment Conclusion',
      `> _Analysis grounded in real market-data API responses. Not financial advice._`,
      data.llmConclusion,
      '### 📋 Quick Reference',
      ...dataLines,
    ].join('\n\n');
  }

  // ── Structured fallback (no LLM available) ───────────────────────────────
  const bullish: string[] = [];
  const bearish: string[] = [];

  if (composite !== null) {
    if (composite >= 60) bullish.push(`Strong composite score (${composite.toFixed(1)}/100)`);
    else if (composite < 40) bearish.push(`Below-average composite score (${composite.toFixed(1)}/100)`);
  }
  if (upside !== null) {
    if (upside > 10) bullish.push(`Analyst consensus implies ${upside.toFixed(1)}% upside to mean target ($${targetMean?.toFixed(2)})`);
    else if (upside < -10) bearish.push(`Price exceeds analyst mean target by ${Math.abs(upside).toFixed(1)}%`);
  }
  if (moat) {
    if (moat.moatScore >= 61) bullish.push(`Wide competitive moat: ${moat.moatType} (${moat.moatScore}/100) — ${moat.narrative}`);
    else if (moat.moatScore < 31) bearish.push(`No significant competitive moat identified (score ${moat.moatScore}/100)`);
  }
  if (revenueGrowth !== null) {
    if (revenueGrowth > 10) bullish.push(`Revenue growing at ${revenueGrowth.toFixed(1)}% TTM`);
    else if (revenueGrowth < 0) bearish.push(`Revenue declining ${Math.abs(revenueGrowth).toFixed(1)}% TTM`);
  }
  if (opMargin !== null) {
    if (opMargin > 20) bullish.push(`High operating margin (${opMargin.toFixed(1)}%) indicates pricing power`);
    else if (opMargin < 0) bearish.push(`Negative operating margin (${opMargin.toFixed(1)}%) — profitability under pressure`);
  }
  if (roe !== null) {
    if (roe > 20) bullish.push(`Exceptional return on equity (${roe.toFixed(1)}%)`);
    else if (roe < 0) bearish.push(`Negative ROE (${roe.toFixed(1)}%)`);
  }
  if (beta !== null) {
    if (beta > 1.5) bearish.push(`High market sensitivity (beta ${beta.toFixed(2)}) — expect above-average volatility`);
    else if (beta < 0.7) bullish.push(`Low volatility (beta ${beta.toFixed(2)}) — defensive characteristics`);
  }
  if (totalAnalyst > 0 && analystBuyPct !== null) {
    const pct = (analystBuyPct * 100).toFixed(0);
    if (analystBuyPct >= 0.7) bullish.push(`${pct}% of analysts rate the stock Buy or Strong Buy`);
    else if (analystBuyPct < 0.3) bearish.push(`Only ${pct}% of analysts rate the stock Buy or Strong Buy`);
  }

  const bullLines = bullish.length
    ? `**Bullish Signals:**\n${bullish.map((b) => `- ${b}`).join('\n')}`
    : '';
  const bearLines = bearish.length
    ? `**Bearish Signals / Risks:**\n${bearish.map((b) => `- ${b}`).join('\n')}`
    : '';

  return [
    '## 🎯 Investment Conclusion',
    `> _All values are sourced from live market-data APIs. This section summarises what the data shows — it is not financial advice._`,
    `### ${rating.emoji} ${name} (${symbol}) — ${rating.label}`,
    ...dataLines,
    bullLines || null,
    bearLines || null,
    '_This conclusion is derived entirely from real API data. Always conduct your own due diligence before investing._',
  ].filter(Boolean).join('\n\n');
}

/**
 * Builds the Investment Conclusion section for a multi-stock comparison report
 * (used by both buildComparisonReport and buildSectorReport).
 *
 * When `llmConclusion` is provided it forms the main narrative; data-derived
 * rankings and metrics are appended as a quick-reference section.
 *
 * @param items        The comparison items with financial data
 * @param scored       Each item paired with its composite score
 * @param reportType   'comparison' | 'sector' | 'deep-sector'
 * @param sectorQuery  Optional sector/theme label for sector-type reports
 * @param llmConclusion Optional LLM-generated narrative
 */
function buildComparisonConclusion(
  items: ComparisonReportItem[],
  scored: Array<{ item: ComparisonReportItem; score: number | null }>,
  reportType: 'comparison' | 'sector' | 'deep-sector',
  sectorQuery?: string,
  llmConclusion?: string
): string {
  if (items.length === 0) return '';

  // Rank by composite score (real data only)
  const ranked = scored
    .filter((r) => r.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const top = ranked[0];
  const runnerUp = ranked[1];
  const topName = top?.item.overview?.name || top?.item.symbol || 'N/A';
  const topSymbol = top?.item.symbol || 'N/A';
  const topScore = top?.score;
  const recommendationRows = ranked.map((row) => {
    const stockData = asStockReportData(row.item, '');
    return {
      item: row.item,
      guidance: derivePositionGuidanceFromStock(stockData, row.score),
    };
  });
  const freshEntryBuys = recommendationRows
    .filter((row) => row.guidance.forNonOwners === 'Buy')
    .map((row) => `${row.item.overview?.name || row.item.symbol} (${row.item.symbol})`);
  const cautionNames = recommendationRows
    .filter((row) => row.guidance.forNonOwners === 'Avoid' || row.guidance.forOwners === 'Sell')
    .map((row) => `${row.item.overview?.name || row.item.symbol} (${row.item.symbol})`);

  // Average composite score → group outlook
  const validScores = ranked.map((r) => r.score as number);
  const avgScore = validScores.length
    ? validScores.reduce((s, v) => s + v, 0) / validScores.length
    : null;

  const outlook =
    avgScore === null ? 'Mixed'
    : avgScore >= 65 ? 'Constructive — most companies show strong fundamentals'
    : avgScore >= 45 ? 'Neutral — quality varies; selective exposure recommended'
    : 'Cautious — fundamentals broadly under pressure';

  // Moat leader (wide moat only)
  const moatLeader = items
    .filter((it) => it.moatAnalysis && it.moatAnalysis.moatScore >= 61)
    .sort((a, b) => (b.moatAnalysis?.moatScore ?? 0) - (a.moatAnalysis?.moatScore ?? 0))[0];

  const outlookLabel =
    reportType === 'sector' ? `**${sectorQuery || 'Sector'} Outlook:** ${outlook}`
    : reportType === 'deep-sector' ? `**Deep Sector Outlook (${sectorQuery || 'sector'}):** ${outlook}`
    : `**Peer Group Outlook:** ${outlook}`;

  const strategyAdvice =
    topScore !== null && topScore >= 65
      ? `Focused allocation to the top-ranked name(s) is supported by the data.`
      : `A diversified basket approach reduces single-name risk given mixed fundamentals.`;

  // Build data-derived quick reference lines for every company
  const companyRefLines = ranked.map((r) => {
    const n = r.item.overview?.name || r.item.symbol;
    const sym = r.item.symbol;
    const price = toNumber(r.item.price?.price);
    const target = toNumber(
      r.item.priceTargets?.targetMean
      ?? (r.item.analystRatings?.analystTargetPrice !== 'N/A' ? r.item.analystRatings?.analystTargetPrice : null)
      ?? r.item.overview?.analystTargetPrice
    );
    const upside = price && target ? ((target - price) / price) * 100 : null;
    const moat = r.item.moatAnalysis;
    const parts = [
      r.score !== null ? `Score ${r.score.toFixed(1)}` : null,
      upside !== null ? `${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% upside` : null,
      moat ? `${moat.moatStrength} moat` : null,
    ].filter(Boolean).join(' · ');
    return `- **${n} (${sym}):** ${parts || 'Insufficient data'}`;
  });

  // Summary block always shown
  const summaryLines = [
    top ? `**Top Pick: ${topName} (${topSymbol})** — Composite ${topScore?.toFixed(1)}/100` : '_Insufficient data for ranking._',
    runnerUp ? `- Runner-up: ${runnerUp.item.overview?.name || runnerUp.item.symbol} (${runnerUp.item.symbol}) — ${runnerUp.score?.toFixed(1)}/100` : null,
    freshEntryBuys.length ? `- Fresh-entry buys: ${freshEntryBuys.slice(0, 3).join(', ')}` : '- Fresh-entry buys: none at current thresholds',
    cautionNames.length ? `- Highest-caution names: ${cautionNames.slice(0, 3).join(', ')}` : null,
    moatLeader ? `- Strongest moat: **${moatLeader.overview?.name || moatLeader.symbol} (${moatLeader.symbol})** — ${moatLeader.moatAnalysis?.moatType ?? 'N/A'} (${moatLeader.moatAnalysis?.moatScore ?? 'N/A'}/100)` : null,
    outlookLabel,
    `- Strategy: ${strategyAdvice}`,
  ].filter(Boolean).join('\n\n');

  if (llmConclusion) {
    return [
      '## 🎯 Investment Conclusion',
      `> _Analysis grounded in real market-data API responses. Not financial advice._`,
      llmConclusion,
      '### 📊 Company Quick Reference',
      ...companyRefLines,
      summaryLines,
    ].join('\n\n');
  }

  return [
    '## 🎯 Investment Conclusion',
    `> _All values are derived from live market-data APIs. This conclusion is not financial advice._`,
    summaryLines,
    '### 📊 Company Quick Reference',
    ...companyRefLines,
    '_Always conduct your own due diligence before making investment decisions._',
  ].filter(Boolean).join('\n\n');
}

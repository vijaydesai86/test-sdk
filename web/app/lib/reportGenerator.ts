/* eslint-disable @typescript-eslint/no-explicit-any */
import { promises as fs } from 'fs';
import path from 'path';
import type { DataTrustSummary, DecisionSnapshot, PortfolioProfile, WatchlistPositionMeta } from './investmentTypes';
import { getConfiguredEnv } from './env';
import { DEFAULT_REPORTS_DIR } from './reportFileStore';
import { computeDcfValuation, deriveFreeCashFlow } from './dcfValuation';
import { writeReportMetadataSidecar, type ReportRunMetadata } from './reportUpdate';
import type { ResearchCandidateScore, ResearchUniverseSelection } from './researchUniverseSelector';

type PricePoint = { date: string; close: string | number; high?: string | number; low?: string | number };
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
  /** Data-backed universe selection scores and role coverage metadata */
  universeSelection?: ResearchUniverseSelection;
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

export type WatchlistSkippedItem = string | { symbol: string; reason?: string };

export interface WatchlistDailyReportData {
  generatedAt: string;
  watchlistName: string;
  items: WatchlistDailyReportItem[];
  totalItems?: number;
  skippedItems?: WatchlistSkippedItem[];
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
  /** Specific, concrete barriers to competition, e.g. ecosystem lock-in, scale economics */
  barriers: string[];
  /** 2-4 sentence descriptive narrative explaining moat sources and their sustainability */
  narrative: string;
  /** 1-2 sentences: what this company excels at and who/what it is best for */
  bestFor: string;
}

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
  if (Math.abs(num) <= 2) return num * 100;
  return num;
}

function normalizeYieldPercent(value: unknown): number | null {
  const percent = normalizePercent(value);
  if (percent === null) return null;
  return percent >= 0 && percent <= 25 ? percent : null;
}

function formatNumber(value: unknown, decimals = 2): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  return num.toFixed(decimals);
}

function parseBoundedEnvNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = getConfiguredEnv(name);
  const parsed = raw ? Number(raw) : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function trimTrailingZeros(value: string): string {
  return value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function formatMarketCap(value: unknown): string {
  const num = toNumber(value);
  if (num === null) return 'N/A';
  const sign = num < 0 ? '-' : '';
  const abs = Math.abs(num);
  if (abs >= 1e9) {
    return `${sign}${trimTrailingZeros((abs / 1e9).toFixed(2))}B`;
  }
  if (abs >= 1e6) {
    return `${sign}${trimTrailingZeros((abs / 1e6).toFixed(2))}M`;
  }
  return `${sign}${trimTrailingZeros(abs.toFixed(0))}`;
}

function formatPercent(value: unknown, decimals = 1): string {
  const num = normalizePercent(value);
  if (num === null) return 'N/A';
  return `${num.toFixed(decimals)}%`;
}

function formatYieldPercent(value: unknown, decimals = 1): string {
  const num = normalizeYieldPercent(value);
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
  if (formatted.startsWith('-')) return `-$${formatted.slice(1)}`;
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

function getAnnualReportCollection(reportSet?: any): any[] {
  return Array.isArray(reportSet?.annualReports) ? reportSet.annualReports : [];
}

function getPrimaryIncomeReport(data: Pick<StockReportData, 'incomeStatement'>): any | null {
  return getMostCompleteReport(data.incomeStatement, ['totalRevenue', 'grossProfit', 'operatingIncome', 'netIncome']);
}

function getPrimaryAnnualIncomeReport(data: Pick<StockReportData, 'incomeStatement'>): any | null {
  return getMostCompleteReport({ annualReports: getAnnualReportCollection(data.incomeStatement) }, ['totalRevenue', 'grossProfit', 'operatingIncome', 'netIncome']);
}

function getSummaryRevenue(data: Pick<StockReportData, 'companyOverview' | 'incomeStatement'>): { value: number | null; label: string; source: 'overview' | 'annual-statement' | 'statement' | null } {
  const overviewRevenue = toNumber(data.companyOverview?.revenueTTM);
  if (overviewRevenue !== null) {
    return { value: overviewRevenue, label: 'Revenue (TTM)', source: 'overview' };
  }
  const annualRevenue = toNumber(getPrimaryAnnualIncomeReport(data)?.totalRevenue);
  if (annualRevenue !== null) {
    return { value: annualRevenue, label: 'Revenue (latest annual)', source: 'annual-statement' };
  }
  const reportedRevenue = toNumber(getPrimaryIncomeReport(data)?.totalRevenue);
  return {
    value: reportedRevenue,
    label: 'Revenue (latest reported)',
    source: reportedRevenue === null ? null : 'statement',
  };
}

function getSummaryGrossMargin(data: Pick<StockReportData, 'companyOverview' | 'basicFinancials' | 'incomeStatement'>): number | null {
  const direct = normalizePercent(data.basicFinancials?.metric?.grossMarginTTM);
  if (direct !== null) return direct;
  const income = getPrimaryAnnualIncomeReport(data) || getPrimaryIncomeReport(data);
  const revenue = toNumber(income?.totalRevenue);
  const gross = toNumber(income?.grossProfit);
  return revenue !== null && revenue !== 0 && gross !== null ? (gross / revenue) * 100 : null;
}

function getSummaryGrossMarginLabel(data: Pick<StockReportData, 'basicFinancials' | 'incomeStatement'>): string {
  if (normalizePercent(data.basicFinancials?.metric?.grossMarginTTM) !== null) return 'Gross Margin (TTM)';
  if (toNumber(getPrimaryAnnualIncomeReport(data)?.grossProfit) !== null) return 'Gross Margin (latest annual)';
  if (toNumber(getPrimaryIncomeReport(data)?.grossProfit) !== null) return 'Gross Margin (latest reported)';
  return 'Gross Margin';
}

function getSummaryOperatingMargin(data: Pick<StockReportData, 'companyOverview' | 'basicFinancials' | 'incomeStatement'>): number | null {
  const direct = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? data.companyOverview?.operatingMargin);
  if (direct !== null) return direct;
  const income = getPrimaryAnnualIncomeReport(data) || getPrimaryIncomeReport(data);
  const revenue = toNumber(income?.totalRevenue);
  const operating = toNumber(income?.operatingIncome);
  return revenue !== null && revenue !== 0 && operating !== null ? (operating / revenue) * 100 : null;
}

function getSummaryOperatingMarginLabel(data: Pick<StockReportData, 'companyOverview' | 'basicFinancials' | 'incomeStatement'>): string {
  if (normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? data.companyOverview?.operatingMargin) !== null) return 'Operating Margin (TTM)';
  if (toNumber(getPrimaryAnnualIncomeReport(data)?.operatingIncome) !== null) return 'Operating Margin (latest annual)';
  if (toNumber(getPrimaryIncomeReport(data)?.operatingIncome) !== null) return 'Operating Margin (latest reported)';
  return 'Operating Margin';
}

function getSummaryPriceToSales(data: Pick<StockReportData, 'price' | 'companyOverview' | 'incomeStatement'>): number | null {
  const overview = data.companyOverview || {};
  const price = toNumber(data.price?.price);
  const revenuePerShare = toNumber(overview.revenuePerShare);
  if (price !== null && revenuePerShare !== null && revenuePerShare > 0) return price / revenuePerShare;
  const marketCap = toNumber(overview.marketCapitalization);
  const summaryRevenue = getSummaryRevenue(data);
  const canUseStatementRevenueForValuation = summaryRevenue.source === 'overview' || summaryRevenue.source === 'annual-statement';
  return marketCap !== null && canUseStatementRevenueForValuation && summaryRevenue.value !== null && summaryRevenue.value > 0
    ? marketCap / summaryRevenue.value
    : null;
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
  // Compact 4-column table: Company | Signal | Confidence | Action
  // "Why" is rendered as a sub-row beneath each company to avoid horizontal overflow.
  const signalEmoji = (stance: string) => {
    if (stance === 'Buy') return '🟢';
    if (stance === 'Hold') return '🟡';
    if (stance === 'Watch') return '🟠';
    if (stance === 'Sell') return '🔴';
    return '⚪';
  };
  const tableRows = rows.map(({ company, guidance }) => [
    company,
    `${signalEmoji(guidance.stance)} ${guidance.stance}`,
    guidance.confidence,
    `Owners: ${guidance.forOwners} · New: ${describeNonOwnerAction(guidance.forNonOwners)}`,
  ]);
  const table = buildTable(
    ['Company', 'Signal', 'Confidence', 'Action'],
    tableRows,
    ['left', 'left', 'left', 'left']
  );
  // Append a brief Why line for each company below the table
  const whyLines = rows.map(({ company, guidance }) => {
    return `- **${company}:** ${guidance.rationale}`;
  }).join('\n');
  return `${table}\n\n**Why:**\n${whyLines}`;
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

function getAnalystSnapshot(item: any): {
  targetMean: number | null;
  targetLow: number | null;
  targetMedian: number | null;
  targetHigh: number | null;
  upside: number | null;
  strongBuy: number | null;
  buy: number | null;
  hold: number | null;
  sell: number | null;
  strongSell: number | null;
  total: number;
} {
  const overview = item.companyOverview || item.overview || {};
  const ratings = item.analystRatings || overview || {};
  const price = toNumber(item.price?.price);
  const targetMean = toNumber(
    item.priceTargets?.targetMean
    ?? (item.analystRatings?.analystTargetPrice !== 'N/A' ? item.analystRatings?.analystTargetPrice : null)
    ?? overview.analystTargetPrice
  );

  const strongBuy = toNumber(ratings.strongBuy ?? ratings.analystRatingStrongBuy);
  const buy = toNumber(ratings.buy ?? ratings.analystRatingBuy);
  const hold = toNumber(ratings.hold ?? ratings.analystRatingHold);
  const sell = toNumber(ratings.sell ?? ratings.analystRatingSell);
  const strongSell = toNumber(ratings.strongSell ?? ratings.analystRatingStrongSell);

  return {
    targetMean,
    targetLow: toNumber(item.priceTargets?.targetLow),
    targetMedian: toNumber(item.priceTargets?.targetMedian),
    targetHigh: toNumber(item.priceTargets?.targetHigh),
    upside: price && targetMean ? ((targetMean - price) / price) * 100 : null,
    strongBuy,
    buy,
    hold,
    sell,
    strongSell,
    total: [strongBuy, buy, hold, sell, strongSell].reduce<number>((sum, value) => sum + (value ?? 0), 0),
  };
}

function formatRatingSummary(item: any, mode: 'short' | 'long' = 'long'): string {
  const snapshot = getAnalystSnapshot(item);

  if ([snapshot.strongBuy, snapshot.buy, snapshot.hold, snapshot.sell, snapshot.strongSell].every((value) => value === null)) {
    return 'N/A';
  }

  if (mode === 'short') {
    return `SB ${snapshot.strongBuy ?? 0} / B ${snapshot.buy ?? 0} / H ${snapshot.hold ?? 0} / S ${snapshot.sell ?? 0} / SS ${snapshot.strongSell ?? 0}`;
  }

  return `${snapshot.strongBuy ?? 0} Strong Buy · ${snapshot.buy ?? 0} Buy · ${snapshot.hold ?? 0} Hold · ${snapshot.sell ?? 0} Sell · ${snapshot.strongSell ?? 0} Strong Sell`;
}

function formatScoreSummary(label: string, score: number | null): string | null {
  if (score === null) return null;
  return `${label} ${score.toFixed(1)}/100`;
}

function formatMoatSummary(moat?: MoatAnalysis | null): string | null {
  if (!moat) return null;
  return `${moat.moatType} · ${moat.moatStrength} (${Math.round(moat.moatScore)}/100)`;
}

function formatAnalystTargetSummary(
  snapshot: ReturnType<typeof getAnalystSnapshot>,
  options: { includeRange?: boolean; includeMedian?: boolean } = {}
): string | null {
  const { includeRange = false, includeMedian = false } = options;
  if (snapshot.targetMean === null && snapshot.upside === null) return null;

  let summary = snapshot.targetMean !== null
    ? `${formatPrice(snapshot.targetMean)} mean`
    : 'Target unavailable';

  if (snapshot.upside !== null) {
    summary += ` (${formatSignedPercentValue(snapshot.upside, 1, { alreadyPercent: true })} upside)`;
  }

  const extras: string[] = [];
  if (includeRange && (snapshot.targetLow !== null || snapshot.targetHigh !== null)) {
    extras.push(`range ${formatPrice(snapshot.targetLow)} - ${formatPrice(snapshot.targetHigh)}`);
  }
  if (includeMedian && snapshot.targetMedian !== null) {
    extras.push(`median ${formatPrice(snapshot.targetMedian)}`);
  }

  if (extras.length) {
    summary += `; ${extras.join('; ')}`;
  }

  return summary;
}

function getStockOwnershipDisplayValue(
  data: StockReportData,
  field: 'insider' | 'institutional' | 'shortFloat'
): string {
  const item: ComparisonReportItem = {
    symbol: data.symbol,
    overview: data.companyOverview,
    insiderTrading: data.insiderTrading,
  };
  return getOwnershipDisplayValue(item, field);
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
  const trustedRange = getTrustedRange(price, prices, overview);
  const weekHigh = trustedRange.high;
  const weekLow = trustedRange.low;
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

function getPriceHistoryRange(prices: PricePoint[] = []): { low: number | null; high: number | null } {
  const datedPoints = prices
    .map((point) => ({ point, time: Date.parse(point.date) }))
    .filter((entry) => Number.isFinite(entry.time));
  const latestTime = datedPoints.reduce((latest, entry) => Math.max(latest, entry.time), 0);
  const cutoff = latestTime > 0 ? latestTime - 370 * 24 * 60 * 60 * 1000 : 0;
  const scopedPoints = latestTime > 0
    ? datedPoints.filter((entry) => entry.time >= cutoff).map((entry) => entry.point)
    : prices;
  const values = scopedPoints
    .flatMap((point) => [toNumber(point.low ?? point.close), toNumber(point.high ?? point.close)])
    .filter((value): value is number => value !== null && value > 0);
  if (!values.length) return { low: null, high: null };
  return {
    low: Math.min(...values),
    high: Math.max(...values),
  };
}

function getTrustedRange(price: number | null, prices: PricePoint[] = [], overview: any = {}): { low: number | null; high: number | null } {
  const historyRange = getPriceHistoryRange(prices);
  if (historyRange.low !== null && historyRange.high !== null && historyRange.high >= historyRange.low) {
    return historyRange;
  }

  const overviewHigh = toNumber(overview["52WeekHigh"]);
  const overviewLow = toNumber(overview["52WeekLow"]);
  if (
    price !== null &&
    overviewHigh !== null &&
    overviewLow !== null &&
    overviewLow > 0 &&
    overviewHigh >= overviewLow &&
    price >= overviewLow * 0.5 &&
    price <= overviewHigh * 1.5
  ) {
    return { low: overviewLow, high: overviewHigh };
  }

  return { low: null, high: null };
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

function ownerActionFromDecisionSnapshot(action?: DecisionSnapshot['action']): OwnerAction {
  if (action === 'Initiate' || action === 'Add') return 'Add';
  if (action === 'Trim') return 'Trim';
  if (action === 'Exit') return 'Sell';
  return 'Hold';
}

function nonOwnerActionFromDecisionSnapshot(action?: DecisionSnapshot['action']): NonOwnerAction {
  if (action === 'Initiate' || action === 'Add') return 'Buy';
  if (action === 'Trim' || action === 'Exit') return 'Avoid';
  return 'Watch';
}

function decisionActionFromSignal(action: ActionLabel): DecisionSnapshot['action'] {
  if (action === 'Buy') return 'Initiate';
  if (action === 'Hold') return 'Hold';
  if (action === 'Sell') return 'Exit';
  return 'Wait';
}

function primaryStockScoreLabel(data: StockReportData): 'Decision Score' | 'Composite Score' {
  return data.decisionSnapshot?.overallScore !== null && data.decisionSnapshot?.overallScore !== undefined
    ? 'Decision Score'
    : 'Composite Score';
}

function comparisonScoreSourceLabel(item: ComparisonReportItem): 'Decision Score' | 'Composite Score' {
  return item.decisionSnapshot?.overallScore !== null && item.decisionSnapshot?.overallScore !== undefined
    ? 'Decision Score'
    : 'Composite Score';
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
      ['Decision Score', snapshot.overallScore !== null ? `${snapshot.overallScore}/100` : 'Unavailable'],
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
  overallScore: number | null;
  confidence: 'High' | 'Medium' | 'Low';
  missingInputs: string[];
  // Real metrics from API data — used to cite concrete numbers
  metrics: {
    pe: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    roe: number | null;
    revenueGrowth: number | null;
    targetUpside: number | null;
    trend: string;
  };
}): string {
  const { metrics } = profile;
  const positives: string[] = [];
  const cautions: string[] = [];

  // ── Strengths: cite real metric values ──
  {
    const highlights: string[] = [];
    if (metrics.grossMargin !== null && metrics.grossMargin >= 40) highlights.push(`${metrics.grossMargin.toFixed(0)}% gross margin`);
    if (metrics.operatingMargin !== null && metrics.operatingMargin >= 15) highlights.push(`${metrics.operatingMargin.toFixed(0)}% op margin`);
    if (metrics.roe !== null && metrics.roe >= 15) highlights.push(`${metrics.roe.toFixed(0)}% ROE`);
    if (metrics.revenueGrowth !== null && metrics.revenueGrowth > 5) highlights.push(`${metrics.revenueGrowth > 0 ? '+' : ''}${metrics.revenueGrowth.toFixed(0)}% rev growth`);
    if (highlights.length >= 3) positives.push(`strong fundamentals (${highlights.join(', ')})`);
    else if (highlights.length >= 1) positives.push(`solid on ${highlights.join(', ')}`);
  }

  // Valuation — cite P/E and target upside
  {
    const parts: string[] = [];
    if (metrics.pe !== null && metrics.pe > 0) parts.push(`${metrics.pe.toFixed(1)}x P/E`);
    if (metrics.targetUpside !== null) parts.push(`${metrics.targetUpside.toFixed(1)}% target upside`);
    if (profile.valuationScore !== null && profile.valuationScore >= 60 && parts.length) {
      positives.push(`attractive valuation (${parts.join(', ')})`);
    } else if (profile.valuationScore !== null && profile.valuationScore < 40 && parts.length) {
      cautions.push(`stretched valuation (${parts.join(', ')})`);
    }
  }

  // Trend — cite direction
  if (profile.trendScore !== null) {
    const trendLabel = metrics.trend !== 'Trend unavailable' ? ` (${metrics.trend.toLowerCase()})` : '';
    if (profile.trendScore >= 58) positives.push(`supportive price trend${trendLabel}`);
    else if (profile.trendScore < 35) cautions.push(`weak price trend${trendLabel}`);
  }

  // ── Weaknesses: cite actual metric values ──
  {
    const weakParts: string[] = [];
    if (metrics.operatingMargin !== null && metrics.operatingMargin < 5) weakParts.push(`${metrics.operatingMargin.toFixed(0)}% op margin`);
    if (metrics.roe !== null && metrics.roe < 8) weakParts.push(`${metrics.roe.toFixed(0)}% ROE`);
    if (metrics.revenueGrowth !== null && metrics.revenueGrowth < -5) weakParts.push(`${metrics.revenueGrowth.toFixed(0)}% rev growth`);
    if (weakParts.length) cautions.push(`weak fundamentals (${weakParts.join(', ')})`);
  }

  let opening: string;
  if (profile.signal === 'Buy') {
    opening = positives.length >= 2
      ? `${sentenceCase(positives.slice(0, 2).join(' and '))}.`
      : positives.length === 1
        ? `${sentenceCase(positives[0])}, supporting fresh exposure.`
        : 'Quality, valuation, and trend support fresh exposure.';
  } else if (profile.signal === 'Hold') {
    opening = positives.length
      ? `${sentenceCase(positives[0])}, but not enough for an aggressive add.`
      : cautions.length
        ? `${sentenceCase(cautions[0])}, keeping this at hold.`
        : 'Still investable, but not a high-conviction entry point.';
  } else if (profile.signal === 'Watch') {
    opening = cautions.length
      ? `${sentenceCase(cautions[0])}, so patience is warranted.`
      : positives.length
        ? `${sentenceCase(positives[0])}, but cleaner confirmation needed.`
        : 'The setup needs a better entry or cleaner confirmation.';
  } else if (profile.signal === 'Sell') {
    opening = cautions.length >= 2
      ? `${sentenceCase(cautions.slice(0, 2).join(' and '))}.`
      : cautions.length === 1
        ? `${sentenceCase(cautions[0])}; capital is better protected elsewhere.`
        : 'Quality and reward-to-risk are weak; capital is better protected elsewhere.';
  } else {
    opening = positives.length
      ? `${sentenceCase(positives[0])}.`
      : cautions.length
        ? `${sentenceCase(cautions[0])}.`
        : 'Signals are mixed.';
  }

  if (profile.confidence === 'High' || profile.missingInputs.length === 0) {
    return opening;
  }

  return `${opening} Confidence limited: ${formatMissingInputs(profile.missingInputs)} unavailable.`;
}

function deriveRecommendationProfile(args: {
  scorecard: ReturnType<typeof computeScorecard>;
  targetUpside: number | null;
  technical: TechnicalSnapshot;
  price: number | null;
  hasBalanceSheet: boolean;
  hasCashFlow: boolean;
  // Real API metrics for stock-specific rationale text
  realMetrics?: {
    pe: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    roe: number | null;
    revenueGrowth: number | null;
  };
}): RecommendationProfile {
  const { scorecard, targetUpside, technical, price, hasBalanceSheet, hasCashFlow, realMetrics } = args;
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
  if ((overallScore !== null && overallScore >= 50 && (qualityScore === null || qualityScore >= 40) && (valuationScore === null || valuationScore >= 45) && (trendScore === null || trendScore >= 42))
    || (strongQuality && attractiveValuation && supportiveTrend && confidence.label !== 'Low')) {
    signal = 'Buy';
  } else if ((overallScore !== null && overallScore < 28 && weakQuality && (brokenTrend || weakValuation)) && confidence.label !== 'Low') {
    signal = 'Sell';
  } else if ((overallScore !== null && overallScore >= 42) || strongQuality || (qualityScore !== null && qualityScore >= 45 && !brokenTrend)) {
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
    overallScore,
    confidence: confidence.label,
    missingInputs: confidence.missingInputs,
    metrics: {
      pe: realMetrics?.pe ?? null,
      grossMargin: realMetrics?.grossMargin ?? null,
      operatingMargin: realMetrics?.operatingMargin ?? null,
      roe: realMetrics?.roe ?? null,
      revenueGrowth: realMetrics?.revenueGrowth ?? null,
      targetUpside,
      trend: technical.trend,
    },
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
        ownerAction: 'Hold',
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
    return {
      stance,
      rationale: data.decisionSnapshot.summary,
      forOwners: ownerActionFromDecisionSnapshot(data.decisionSnapshot.action),
      forNonOwners: nonOwnerActionFromDecisionSnapshot(data.decisionSnapshot.action),
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

  // Extract real API metric values for stock-specific rationale text
  const pe = toNumber(overview.peRatio ?? data.basicFinancials?.metric?.peBasicExclExtraTTM);
  const grossMargin = getSummaryGrossMargin(data);
  const operatingMargin = normalizePercent(data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin);
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity);
  const revenueGrowth = normalizePercent(data.basicFinancials?.metric?.revenueGrowthTTM ?? overview.quarterlyRevenueGrowth);

  const profile = deriveRecommendationProfile({
    scorecard,
    targetUpside,
    technical,
    price,
    hasBalanceSheet: balanceReport !== null,
    hasCashFlow: cashFlowReport !== null,
    realMetrics: { pe, grossMargin, operatingMargin, roe, revenueGrowth },
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
      metrics.transactions.length ? String(metrics.buyCount) : '—',
      metrics.transactions.length ? String(metrics.sellCount) : '—',
      metrics.transactions.length ? formatCurrency(metrics.buyValue) : '—',
      metrics.transactions.length ? formatCurrency(metrics.sellValue) : '—',
      metrics.latestDate ? formatDateLabel(metrics.latestDate) : '—',
    ];
  });

  return buildTable(
    ['Company', 'Buys', 'Sells', 'Buy $', 'Sell $', 'Latest'],
    rows,
    ['left', 'right', 'right', 'right', 'right', 'right']
  );
}

function buildDeepInsiderSections(items: ComparisonReportItem[]): string {
  const sections = items.map((item) => {
    const metrics = summarizeInsiderMetrics(item.insiderTrading);
    const overview = item.overview || {};
    const summaryLine = metrics.transactions.length
      ? `- Recent transaction summary: ${metrics.buyCount} purchase(s), ${metrics.sellCount} sale(s), ${formatCurrency(metrics.buyValue)} bought, ${formatCurrency(metrics.sellValue)} sold.`
      : '- Recent transaction summary: provider transaction feed unavailable.';

    const transactionTable = metrics.transactions.length
      ? buildTable(
          ['Date', 'Insider', 'Type', 'Shares', 'Value'],
          metrics.transactions.slice(0, 10).map((txn: any) => [
            formatDateLabel(String(txn.transactionDate)),
            txn.insider || 'N/A',
            txn.transactionType || 'N/A',
            formatCompactNumber(txn.shares),
            formatCurrency(txn.totalValue),
          ]),
          ['left', 'left', 'left', 'right', 'right']
        )
      : '_No recent insider transactions were returned by the active data providers._';

    return [
      `### ${overview.name || item.symbol} (${item.symbol})`,
      summaryLine,
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
    const stockData = asStockReportData(item, '');
    const gross = getSummaryGrossMargin(stockData);
    const operating = getSummaryOperatingMargin(stockData);
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

export function computeScorecard(data: StockReportData) {
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

  const revenueGrowth = getStockRevenueGrowth(data);
  const epsGrowth = getStockEpsGrowth(data);
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
 * comparison or research report.
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
    const topBarriers = moat.barriers.slice(0, 2).join(', ') || 'N/A';
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      moat.moatType,
      `${moatStrengthEmoji(moat.moatStrength)} ${moat.moatStrength}`,
      `${Math.round(moat.moatScore)}/100`,
      topBarriers,
    ];
  });

  const moatTable = buildTable(
    ['Company', 'Type', 'Strength', 'Score', 'Barriers'],
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
  // Build EPS chart: prefer real earnings history; fall back to a single-point
  // chart derived from the overview EPS when the earnings API returns empty.
  const earningsPoints = data.earningsHistory?.quarterlyEarnings || [];
  let epsChart = buildEpsChart(earningsPoints);
  if (!epsChart && earningsPoints.length === 0) {
    const overviewEps = toNumber(data.companyOverview?.eps);
    if (overviewEps !== null) {
      const now = new Date();
      const q = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
      epsChart = buildEpsChart([{ fiscalQuarter: q, reportedEPS: String(overviewEps) }]);
    }
  }
  const peChart = buildPeChart(data.priceHistory?.prices || [], data.earningsHistory?.quarterlyEarnings || []);
  const revenueChart = buildRevenueChart(data.incomeStatement);
  const marginChart = buildMarginChart(data.incomeStatement);
  const targetChart = buildTargetDistribution(data.priceTargets);
  const headline = `# ${data.symbol} Comprehensive Equity Research Report`;
  const scorecard = computeScorecard(data);
  const overview = data.companyOverview || {};
  const analystSnapshot = getAnalystSnapshot(data);
  const price = toNumber(data.price?.price);
  const changePercent = data.price?.changePercent;
  const changePercentValue = typeof changePercent === 'string'
    ? Number(changePercent.replace('%', ''))
    : changePercent;
  const changePercentIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
  const priceLine = price === null
    ? 'N/A'
    : `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`;
  const trustedRange = getTrustedRange(price, data.priceHistory?.prices || [], overview);

  const snapshotLines = [
    `- Price: ${priceLine} (day change)`,
    `- Market Cap: ${formatCurrency(overview.marketCapitalization)}`,
    `- Sector: ${overview.sector || 'Unavailable'}`,
    `- Industry: ${overview.industry || 'Unavailable'}`,
  ].filter((line) => !line.endsWith('Unavailable') && !line.includes('(Unavailable)'));

  const summaryRevenue = getSummaryRevenue(data);

  const description = overview.description ? summarizeDescription(overview.description) : null;
  const businessLines = [
    overview.name ? `- Company: ${overview.name} (${data.symbol})` : `- Company: ${data.symbol}`,
    description ? `- Description: ${description}` : null,
    summaryRevenue.value !== null ? `- ${summaryRevenue.label}: ${formatCurrency(summaryRevenue.value)}` : null,
    overview.grossProfitTTM ? `- Gross Profit (TTM): ${formatCurrency(overview.grossProfitTTM)}` : null,
    overview.sharesOutstanding ? `- Shares Outstanding: ${formatCompactNumber(overview.sharesOutstanding)}` : null,
    overview.dividendYield ? `- Dividend Yield: ${formatYieldPercent(overview.dividendYield)}` : null,
  ].filter(Boolean) as string[];

  const peers = (data.peers?.peers || [])
    .filter((peer: string) => peer && peer.toUpperCase() !== data.symbol.toUpperCase())
    .slice(0, 10);
  const competitiveLines = [
    peers.length ? `- Peer Set: ${peers.join(', ')}` : '- Peer Set: Unavailable (data gap or rate limit)',
  ].filter(Boolean) as string[];

  const revenueGrowth = getStockRevenueGrowth(data);
  const epsGrowth = getStockEpsGrowth(data);
  const grossMargin = getSummaryGrossMargin(data);
  const operatingMargin = getSummaryOperatingMargin(data);
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
    ? buildTable(['Period', 'Str Buy', 'Buy', 'Hold', 'Sell', 'Str Sell'], recommendationRows, ['left', 'right', 'right', 'right', 'right', 'right'])
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

  let incomeTable: string;
  if (incomeReports.length) {
    incomeTable = buildTable(
      ['Period', 'Revenue', 'Gross', 'Op Income', 'Net Income'],
      incomeReports.map((report) => [
        formatPeriodLabel(report),
        formatCurrency(report.totalRevenue),
        formatCurrency(report.grossProfit),
        formatCurrency(report.operatingIncome),
        formatCurrency(report.netIncome),
      ]),
      ['left', 'right', 'right', 'right', 'right']
    );
  } else {
    incomeTable = '_Income statement data unavailable (provider or rate limit; no synthetic fallback shown)._';
  }

  let balanceTable: string;
  if (balanceReports.length) {
    balanceTable = buildTable(
      ['Period', 'Cash', 'LT Debt', 'Liabilities', 'Assets', 'Equity'],
      balanceReports.map((report) => [
        formatPeriodLabel(report),
        formatCurrency(report.cashAndEquivalents),
        formatCurrency(report.longTermDebt),
        formatCurrency(report.totalLiabilities),
        formatCurrency(report.totalAssets),
        formatCurrency(report.totalShareholderEquity),
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right']
    );
  } else {
    balanceTable = '_Balance sheet data unavailable (provider or rate limit; no synthetic fallback shown)._';
  }

  const cashTable = cashReports.length
    ? buildTable(
        ['Period', 'Op Cash Flow', 'Capex', 'FCF', 'Dividends'],
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
  const priceToSales = getSummaryPriceToSales(data);
  const marketCap = toNumber(overview.marketCapitalization);
  const canUseRevenueForValuation = summaryRevenue.source === 'overview' || summaryRevenue.source === 'annual-statement';
  const marketCapToRevenue = marketCap && canUseRevenueForValuation && summaryRevenue.value ? marketCap / summaryRevenue.value : null;
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
  const weekHigh = trustedRange.high;
  const weekLow = trustedRange.low;
  const fromHigh = price && weekHigh ? ((price - weekHigh) / weekHigh) * 100 : null;
  const fromLow = price && weekLow ? ((price - weekLow) / weekLow) * 100 : null;
  const kpiTable = buildTable(
    ['KPI', 'Value'],
    [
      ['Price', `${formatPrice(price)} (${formatSignedPercentValue(changePercentValue, 2, { alreadyPercent: changePercentIsPercent })})`],
      ['Market Cap', formatCurrency(overview.marketCapitalization)],
      ['52W Range', `${formatCurrency(weekLow)} - ${formatCurrency(weekHigh)}`],
      [summaryRevenue.label, formatCurrency(summaryRevenue.value)],
      [getSummaryGrossMarginLabel(data), formatPercent(grossMargin)],
      [getSummaryOperatingMarginLabel(data), formatPercent(operatingMargin)],
      ['ROE (TTM)', formatPercent(data.basicFinancials?.metric?.roeTTM)],
    ],
    ['left', 'right']
  );

  const ownershipLines = [
    getStockOwnershipDisplayValue(data, 'institutional') !== 'N/A'
      ? `- Institutional Ownership: ${getStockOwnershipDisplayValue(data, 'institutional')}`
      : null,
    getStockOwnershipDisplayValue(data, 'insider') !== 'N/A'
      ? `- Insider Ownership: ${getStockOwnershipDisplayValue(data, 'insider')}`
      : null,
    data.insiderTrading?.sharesFloat && data.insiderTrading.sharesFloat !== "N/A"
      ? `- Shares Float: ${formatCompactNumber(data.insiderTrading.sharesFloat)}`
      : (overview.sharesFloat ? `- Shares Float: ${formatCompactNumber(overview.sharesFloat)}` : null),
    data.insiderTrading?.shortRatio && data.insiderTrading.shortRatio !== "N/A"
      ? `- Short Ratio: ${formatNumber(data.insiderTrading.shortRatio, 2)}`
      : (overview.shortRatio ? `- Short Ratio: ${formatNumber(overview.shortRatio, 2)}` : null),
    getStockOwnershipDisplayValue(data, 'shortFloat') !== 'N/A'
      ? `- Short Float: ${getStockOwnershipDisplayValue(data, 'shortFloat')}`
      : null,
    insiderSummary.summary ? `- Recent insider activity: ${insiderSummary.summary}` : null,
  ].filter(Boolean) as string[];
  const dividendYield = toNumber(overview.dividendYield);
  const dividendPerShare = toNumber(overview.dividendPerShare);
  const isDividendPayer = (dividendYield != null && dividendYield > 0) || (dividendPerShare != null && dividendPerShare > 0);
  const latestEarnings = data.earningsHistory?.quarterlyEarnings?.[0];
  const catalystLines = [
    !isDividendPayer && overview.exDividendDate ? `- Ex-Dividend Date: ${overview.exDividendDate}` : null,
    !isDividendPayer && overview.dividendDate ? `- Dividend Pay Date: ${overview.dividendDate}` : null,
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
      dividendYield != null ? `- Dividend Yield: ${formatYieldPercent(dividendYield)}` : null,
      dividendPerShare != null ? `- Annual Dividend/Share: $${dividendPerShare.toFixed(2)}` : null,
      divPayoutRatio != null ? `- Payout Ratio (EPS): ${divPayoutRatio.toFixed(1)}%` : null,
      divCoverage != null ? `- FCF Coverage Ratio: ${divCoverage.toFixed(2)}x` : null,
      `- Dividend Safety: ${divSafety}`,
      overview.exDividendDate ? `- Ex-Dividend Date: ${overview.exDividendDate}` : null,
      overview.dividendDate ? `- Dividend Pay Date: ${overview.dividendDate}` : null,
    ].filter(Boolean) as string[];
    sections.push('## 💵 Dividend Analysis', ...dividendLines);
  }

  // DCF Valuation section — only rendered when the valuation model has real required inputs.
  const dcf = computeDcfValuation({
    overview,
    balanceSheet: data.balanceSheet,
    cashFlow: data.cashFlow,
    currentPrice: price,
  });
  if (dcf.intrinsicValuePerShare !== null && price !== null) {
      sections.push(
        '## 📐 DCF Valuation Model',
        '_Simplified 10-year DCF model based only on available provider inputs. Not investment advice._',
        buildTable(
          ['Metric', 'Value'],
          [
            ['**Intrinsic Value / Share**', `$${dcf.intrinsicValuePerShare.toFixed(2)}`],
            ['**Current Price**', formatPrice(price)],
            ['**Margin of Safety**', dcf.marginOfSafetyPercent !== null ? `${dcf.marginOfSafetyPercent.toFixed(1)}%` : 'N/A'],
            ['**Verdict**', dcf.verdict],
            ['DCF Confidence', dcf.confidence],
            ['FCF Basis', dcf.assumptions.fcfBasisLabel],
            ['Base FCF', formatCurrency(dcf.assumptions.baseFCF)],
            ['Growth Rate Used', dcf.assumptions.growthRate !== null ? `${dcf.assumptions.growthRate.toFixed(1)}%` : 'N/A'],
            ['WACC (Discount Rate)', dcf.assumptions.wacc !== null ? `${dcf.assumptions.wacc.toFixed(1)}%` : 'N/A'],
            ['Terminal Growth', `${dcf.assumptions.terminalGrowthRate.toFixed(1)}%`],
            ['Beta', dcf.assumptions.beta !== null ? `${dcf.assumptions.beta.toFixed(2)}` : 'N/A'],
          ],
          ['left', 'right']
        ),
        ...(dcf.notes.length ? [`_DCF notes: ${dcf.notes.join(' ')}_`] : []),
      );
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

  const hasRatings = analystSnapshot.total > 0;
  if (analystSnapshot.targetMean !== null || hasRatings || targetChart || recommendationTable) {
    sections.push('## 🧠 Analyst View');
    if (analystSnapshot.targetMean !== null) sections.push(`- Target Mean: ${formatPrice(analystSnapshot.targetMean)}`);
    if (analystSnapshot.targetLow !== null || analystSnapshot.targetHigh !== null) {
      sections.push(`- Target Range: ${formatPrice(analystSnapshot.targetLow)} - ${formatPrice(analystSnapshot.targetHigh)}`);
    }
    if (analystSnapshot.targetMedian !== null) sections.push(`- Target Median: ${formatPrice(analystSnapshot.targetMedian)}`);
    if (analystSnapshot.upside !== null) sections.push(`- Target Upside: ${formatSignedPercentValue(analystSnapshot.upside, 1, { alreadyPercent: true })}`);
    if (hasRatings) {
      sections.push(`- Ratings: ${formatRatingSummary(data)}`);
    }
    if (targetChart) sections.push(targetChart);
    if (recommendationTable) {
      sections.push('### Recommendation Trend');
      sections.push(recommendationTable);
    }
  }

  sections.push('## Ownership, Insider Activity & Sentiment', ...(ownershipLines.length ? ownershipLines : ['- Ownership data unavailable']));
  if (insiderSummary.table) {
    sections.push('### Recent Insider Transactions');
    sections.push(insiderSummary.table);
  }
  sections.push('## Guidance & Catalysts', ...(catalystLines.length ? catalystLines : ['- Guidance data unavailable']));
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
      `- Profitability: ${scorecard.components.profitability?.toFixed(1) ?? 'Unavailable'} (avg of available gross margin, operating margin, and ROE inputs)`,
      `- Valuation: ${scorecard.components.valuation?.toFixed(1) ?? 'Unavailable'} (100 - PE/50*100)`,
      `- Momentum: ${scorecard.components.momentum?.toFixed(1) ?? 'Unavailable'}`,
      `- Moat: ${scorecard.components.moat?.toFixed(1) ?? 'Unavailable'} (data-derived: avg of margin stability, pricing power, analyst conviction)${data.moatAnalysis ? ` | LLM Moat Score: ${Math.round(data.moatAnalysis.moatScore)}/100 (${data.moatAnalysis.moatStrength})` : ''}`,
      `- Composite Score: ${scorecard.composite?.toFixed(1) ?? 'Unavailable'} (data-only scorecard; separate from the Decision Snapshot score)`,
    );
  }

  sections.push(buildStockConclusion(data, scorecard));

  return sections.filter(Boolean).join('\n\n');
}

export async function saveReport(
  content: string,
  title: string,
  directory = DEFAULT_REPORTS_DIR,
  metadata: { reportKind?: string; summary?: string; runMetadata?: ReportRunMetadata } = {}
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
  const supabaseUrl = getConfiguredEnv('SUPABASE_URL');
  const supabaseKey = getConfiguredEnv('SUPABASE_SERVICE_ROLE_KEY');
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
            run_metadata: metadata.runMetadata || null,
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
    await writeReportMetadataSidecar(storagePath, metadata.runMetadata, directory);
  } catch {
    filePath = path.join('/tmp', 'reports', reportDate, filename);
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, 'utf8');
      await writeReportMetadataSidecar(storagePath, metadata.runMetadata, path.join('/tmp', 'reports'));
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
    runMetadata: metadata.runMetadata,
  };
}

export function buildComparisonReport(data: ComparisonReportData): string {
  const header = `# Company Comparison Report`;
  const notes = data.notes?.length ? data.notes.map((note) => `- ${note}`).join('\n') : '';
  const sources = data.sources || {};
  const sourceLegend =
    '_Legend: Automatic provider chain uses all configured providers: Alpha Vantage, Finnhub, Financial Modeling Prep, Twelve Data, then Stooq where supported._';
  const items = data.items;

  // Render data sources as a compact per-company bullet list instead of a 14-column table
  const sourceList = Object.entries(sources).map(([symbol, map]) => {
    const lookup = items.find((item) => item.symbol === symbol);
    const name = lookup?.overview?.name || symbol;
    const pick = (key: string) => map[key] || '';
    const available: string[] = [];
    const missing: string[] = [];
    const dataPoints = [
      { label: 'Price', v: pick('Price') },
      { label: 'Overview', v: pick('Company overview') },
      { label: 'Financials', v: pick('Basic financials') },
      { label: 'History', v: pick('Price history') },
      { label: 'Income', v: pick('Income statement') },
      { label: 'Balance', v: pick('Balance sheet') },
      { label: 'Cash Flow', v: pick('Cash flow') },
      { label: 'Insider', v: pick('Insider trading') },
      { label: 'Analyst', v: pick('Analyst ratings') },
      { label: 'Targets', v: pick('Price targets') },
      { label: 'Peers', v: pick('Peers') },
      { label: 'Sentiment', v: pick('News sentiment') },
      { label: 'News', v: pick('Company news') },
    ];
    for (const dp of dataPoints) {
      if (dp.v && dp.v !== 'N/A' && dp.v !== '—') available.push(dp.label);
      else missing.push(dp.label);
    }
    const missingStr = missing.length ? ` · Missing: ${missing.join(', ')}` : '';
    return `- **${name} (${symbol}):** ${available.length}/${dataPoints.length} sources${missingStr}`;
  }).join('\n');
  const sourceSection = sourceList || '';

  const snapshotRows = items.map((item) => {
    const overview = item.overview || {};
    const price = toNumber(item.price?.price);
    const changePercent = item.price?.changePercent;
    const changeValue = typeof changePercent === 'string'
      ? Number(changePercent.replace('%', ''))
      : changePercent;
    const changeIsPercent = typeof changePercent === 'string' && changePercent.includes('%');
    const trustedRange = getTrustedRange(price, item.priceHistory?.prices || [], overview);
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatPrice(price),
      formatSignedPercentValue(changeValue, 2, { alreadyPercent: changeIsPercent }),
      formatCurrency(overview.marketCapitalization),
      `${formatCurrency(trustedRange.low)} - ${formatCurrency(trustedRange.high)}`,
    ];
  });

  const snapshotTable = buildTable(
    ['Company', 'Price', 'Chg %', 'Mkt Cap', '52W Range'],
    snapshotRows,
    ['left', 'right', 'right', 'right', 'right']
  );

  const scaleRows = items.map((item) => {
    const overview = item.overview || {};
    const stockData = asStockReportData(item, data.generatedAt);
    const summaryRevenue = getSummaryRevenue(stockData);
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      formatCurrency(summaryRevenue.value),
      formatPercent(getSummaryGrossMargin(stockData)),
      formatPercent(getSummaryOperatingMargin(stockData)),
      formatPercent(item.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity),
    ];
  });
  const scaleTable = buildTable(
    ['Company', 'Revenue', 'Gross Mgn', 'Op Mgn', 'ROE'],
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
    ['Company', 'Rev Growth', 'EPS Growth', `${data.range} Price Chg`],
    growthRows,
    ['left', 'right', 'right', 'right']
  );

  const valuationRows = items.map((item) => {
    const overview = item.overview || {};
    const stockData = asStockReportData(item, data.generatedAt);
    const price = toNumber(item.price?.price);
    const bookValue = toNumber(overview.bookValue);
    return [
      `${overview.name || item.symbol} (${item.symbol})`,
      toNumber(overview.peRatio ?? item.basicFinancials?.metric?.peBasicExclExtraTTM)?.toFixed(1) ?? 'N/A',
      toNumber(overview.forwardPE)?.toFixed(1) ?? 'N/A',
      toNumber(overview.pegRatio)?.toFixed(2) ?? 'N/A',
      getSummaryPriceToSales(stockData)?.toFixed(2) ?? 'N/A',
      price && bookValue ? (price / bookValue).toFixed(2) : 'N/A',
    ];
  });
  const valuationTable = buildTable(
    ['Company', 'P/E', 'Fwd P/E', 'PEG', 'P/S', 'P/B'],
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
    ['Company', 'Cash', 'LT Debt', 'Net Debt', 'Equity', 'FCF'],
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
    ];
  });
  const ownershipTable = buildTable(
    ['Company', 'Insider %', 'Institutional %', 'Short Float'],
    ownershipRows,
    ['left', 'right', 'right', 'right']
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
    const analyst = getAnalystSnapshot(item);
    return [
      `${item.overview?.name || item.symbol} (${item.symbol})`,
      formatPrice(analyst.targetMean),
      analyst.upside === null ? 'N/A' : formatSignedPercentValue(analyst.upside, 1, { alreadyPercent: true }),
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
    return [
      `${overview.name || row.item.symbol} (${row.item.symbol})`,
      technical.rsi14 === null ? 'N/A' : `${technical.rsi14.toFixed(1)} (${technical.rsiState})`,
      technical.trend,
    ];
  });
  const timingTable = buildTable(
    ['Company', 'RSI (14)', 'Trend'],
    timingRows,
    ['left', 'right', 'left']
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
      row.score !== null && row.score > 60 ? 'Strong score' : null,
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
    ['Company', 'Score', 'Weight', 'Why'],
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
    debugMode && sourceSection ? '## 🧾 Data Sources' : null,
    debugMode && sourceSection ? `${sourceLegend}\n\n${sourceSection}` : null,
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
      ? '_Some companies lack report scores; weights are normalized across available scores._'
      : '_Indicative allocation is derived from normalized report scores (Decision Snapshot overall score when available; otherwise the data-only composite score). It is not investment advice._',
    buildComparisonConclusion(items, scored, 'comparison', undefined, data.llmConclusion),
  ].filter(Boolean) as string[];

  return sections.join('\n\n');
}

/**
 * Computes ranking scores for a set of ComparisonReportItems.
 * Uses the Decision Snapshot overall score when available, otherwise falls back
 * to the data-only composite score.
 * Extracted as a shared helper so sector/research reports can produce
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
 * body so that sector/research reports can substitute their own version.
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

function tableCell(value: unknown): string {
  return String(value ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function formatScore(value: number | null | undefined): string {
  return Number.isFinite(value) ? `${(value as number).toFixed(1)}` : 'N/A';
}

function buildResearchUniverseSelectionSection(selection?: ResearchUniverseSelection, manualUniverse = false): string {
  if (!selection || selection.candidates.length === 0) return '';
  const debugMode = process.env.DEBUG === 'true';
  const order = new Map(selection.selectedSymbols.map((symbol, index) => [symbol, index]));
  const selectedCandidates = selection.candidates
    .filter((candidate) => candidate.selected)
    .sort((a, b) => (order.get(a.symbol) ?? 999) - (order.get(b.symbol) ?? 999));
  const selectedRows = selectedCandidates
    .map((candidate) => [
      tableCell(`${candidate.companyName} (${candidate.symbol})`),
      tableCell(candidate.subtheme),
      tableCell(candidate.themeFit),
      formatScore(candidate.themeScore),
      formatScore(candidate.investmentReadinessScore),
      formatScore(candidate.dataConfidenceScore),
      formatScore(candidate.totalScore),
      tableCell(candidate.reasons.slice(0, 3).join('; ') || 'Selected by combined score'),
    ]);

  const selectedTable = buildTable(
    ['Company', 'Role', 'Fit', 'Theme', 'Invest/Data', 'Data', 'Total', 'Why'],
    selectedRows,
    ['left', 'left', 'left', 'right', 'right', 'right', 'right', 'left']
  );
  const modeLine = manualUniverse
    ? 'The saved report universe was preserved. Diagnostics below describe the locked companies; update passes do not silently replace the selected universe.'
    : 'The final universe was selected from verified candidates before the deeper financial comparison ran.';
  const roleSummary = selection.subthemes.length
    ? selection.subthemes.map((role) => `${role.name}: ${role.symbols.join(', ')}`).join('; ')
    : 'No selected role groups available.';
  const lines = [
    manualUniverse ? '## 🧭 Locked Universe Diagnostics' : '## 🧭 Universe Selection Summary',
    modeLine,
    manualUniverse
      ? `Locked companies: ${selection.selectedSymbols.length}. Qualified allocation subset: ${selection.qualifiedSymbols.length ? selection.qualifiedSymbols.join(', ') : 'none'}.`
      : `Configured slots: ${selection.requestedCount}. Verified candidates scored: ${selection.candidateCount}. Selected ${selection.selectedSymbols.length}: ${selection.selectedSymbols.join(', ') || 'none'}.`,
    `Fit mix: core ${selection.fitCounts.core}, strong adjacent ${selection.fitCounts.strong_adjacent}, weak adjacent ${selection.fitCounts.weak_adjacent}, rejected ${selection.fitCounts.reject}. Theme gates: core >= ${selection.minThemeScore.toFixed(0)}, strong adjacent >= ${selection.strongAdjacentThemeScore.toFixed(0)}.`,
    `Role coverage: ${roleSummary}`,
    manualUniverse
      ? 'Diagnostics: the locked universe remains the report/table/graph universe. Allocation and research conclusion use only the qualified subset so weak or unsupported locked names are not recommended.'
      : 'Scoring: theme evidence and fit tier are gates first; source role support, provider data readiness, liquidity/scale, preliminary financial sanity, and role coverage then rank the qualified candidates. Weak or unsupported names are not forced in to fill slots.',
  ];

  if (debugMode) {
    lines.push(manualUniverse ? '### Locked Candidate Diagnostics' : '### Selected Candidate Diagnostics', selectedTable);
    const excludedRows = selection.candidates
      .filter((candidate) => !candidate.selected)
      .map((candidate) => [
        tableCell(`${candidate.companyName} (${candidate.symbol})`),
        tableCell(candidate.subtheme),
        tableCell(candidate.themeFit),
        formatScore(candidate.themeScore),
        formatScore(candidate.dataConfidenceScore),
        formatScore(candidate.totalScore),
        tableCell(candidate.exclusionReason || 'Not selected'),
      ]);
    if (excludedRows.length) {
      lines.push(
        '### Excluded Candidates',
        buildTable(
          ['Company', 'Role', 'Fit', 'Theme', 'Data', 'Total', 'Reason'],
          excludedRows,
          ['left', 'left', 'left', 'right', 'right', 'right', 'left']
        )
      );
    }
  }

  return lines.join('\n\n');
}

function buildResearchDataQualitySection(notes?: string[]): string {
  if (!notes?.length) return '';
  const debugMode = process.env.DEBUG === 'true';
  if (debugMode) {
    return [
      '## 🧪 Debug Data Quality Notes',
      ...notes.map((note) => `- ${note}`),
    ].join('\n');
  }
  const visibleNotes = notes.slice(0, 10);
  const hiddenCount = Math.max(0, notes.length - visibleNotes.length);
  return [
    '## ⚠️ Data Quality Summary',
    ...visibleNotes.map((note) => `- ${note}`),
    hiddenCount > 0 ? `- ${hiddenCount} additional data notes hidden. Set DEBUG=true to show the full diagnostic list.` : null,
  ].filter(Boolean).join('\n');
}

function buildResearchAllocationSection(
  scored: Array<{ item: ComparisonReportItem; score: number | null }>,
  selection?: ResearchUniverseSelection,
  generatedAt = ''
): string {
  const minReportScore = parseBoundedEnvNumber('RESEARCH_ALLOCATION_MIN_SCORE', 60, 0, 100);
  const minThemeScore = parseBoundedEnvNumber('RESEARCH_ALLOCATION_MIN_THEME_SCORE', 50, 0, 100);
  const minDataScore = parseBoundedEnvNumber('RESEARCH_ALLOCATION_MIN_DATA_CONFIDENCE', 50, 0, 100);
  const selectionBySymbol = new Map<string, ResearchCandidateScore>(
    (selection?.candidates || []).map((candidate) => [candidate.symbol, candidate])
  );

  const candidates = scored.map((row) => {
    const selector = selectionBySymbol.get(row.item.symbol);
    const stockData = asStockReportData(row.item, generatedAt);
    const guidance = derivePositionGuidanceFromStock(stockData, row.score);
    const reportScore = row.score;
    const universeScore = selector?.totalScore ?? null;
    const themeScore = selector?.themeScore ?? null;
    const dataScore = selector?.dataConfidenceScore ?? null;
    const themeFitEligible = !selector || selector.qualified;
    const allocationScore = reportScore === null
      ? null
      : (
          (reportScore * 0.55) +
          ((universeScore ?? reportScore) * 0.25) +
          ((themeScore ?? reportScore) * 0.10) +
          ((dataScore ?? reportScore) * 0.10)
        ) * (guidance.forNonOwners === 'Buy' ? 1 : 0.65);
    const reasons: string[] = [];
    if (reportScore === null) reasons.push('missing report score');
    if (!themeFitEligible) reasons.push(`theme evidence is ${selector?.themeEvidence.level ?? selector?.themeFit}`);
    if (reportScore !== null && reportScore < minReportScore) reasons.push(`report score below ${minReportScore}`);
    if (themeScore !== null && themeScore < minThemeScore) reasons.push(`theme score below ${minThemeScore}`);
    if (dataScore !== null && dataScore < minDataScore) reasons.push(`data confidence below ${minDataScore}`);
    if (guidance.forNonOwners === 'Avoid') reasons.push('fresh-entry guidance is avoid');
    const eligible = allocationScore !== null
      && reportScore !== null
      && themeFitEligible
      && reportScore >= minReportScore
      && (themeScore === null || themeScore >= minThemeScore)
      && (dataScore === null || dataScore >= minDataScore)
      && guidance.forNonOwners !== 'Avoid';
    return { row, selector, guidance, allocationScore, eligible, reasons };
  });

  const eligible = candidates
    .filter((candidate) => candidate.eligible && candidate.allocationScore !== null && candidate.allocationScore > 0)
    .sort((a, b) => (b.allocationScore || 0) - (a.allocationScore || 0));
  const total = eligible.reduce((sum, candidate) => sum + (candidate.allocationScore || 0), 0);
  const rows = eligible.map((candidate) => {
    const item = candidate.row.item;
    const weight = total > 0 ? ((candidate.allocationScore || 0) / total) * 100 : null;
    const reasons = [
      candidate.guidance.forNonOwners === 'Buy' ? 'fresh-entry buy' : 'watch-sized candidate',
      candidate.selector ? `theme ${formatScore(candidate.selector.themeScore)}` : null,
      candidate.selector ? `evidence ${candidate.selector.themeEvidence.level}` : null,
      candidate.selector ? `data ${formatScore(candidate.selector.dataConfidenceScore)}` : null,
    ].filter(Boolean).join('; ');
    return [
      tableCell(`${item.overview?.name || item.symbol} (${item.symbol})`),
      formatScore(candidate.row.score),
      formatScore(candidate.allocationScore),
      weight === null ? 'N/A' : `${weight.toFixed(1)}%`,
      tableCell(reasons),
    ];
  });

  const debugMode = process.env.DEBUG === 'true';
  const lines = [
    '## 🧭 Research Allocation Scenario (Not Investment Advice)',
    `Selective qualified-subset scenario only. Companies must clear report score (${minReportScore}), theme evidence/fit (${minThemeScore}), and data confidence (${minDataScore}) gates when those selector scores are available; no cash or equal-weight remainder is forced.`,
    rows.length
      ? buildTable(['Company', 'Report', 'Allocation Score', 'Scenario Weight', 'Why Included'], rows, ['left', 'right', 'right', 'right', 'left'])
      : '_No company cleared the configured allocation gates with the current verified data._',
  ];

  if (debugMode) {
    const excludedRows = candidates
      .filter((candidate) => !candidate.eligible)
      .map((candidate) => [
        tableCell(`${candidate.row.item.overview?.name || candidate.row.item.symbol} (${candidate.row.item.symbol})`),
        formatScore(candidate.row.score),
        candidate.selector ? formatScore(candidate.selector.themeScore) : 'N/A',
        candidate.selector ? formatScore(candidate.selector.dataConfidenceScore) : 'N/A',
        tableCell(candidate.reasons.join('; ') || 'did not clear allocation gates'),
      ]);
    if (excludedRows.length) {
      lines.push(
        '### Allocation Exclusions',
        buildTable(['Company', 'Report', 'Theme', 'Data', 'Reason'], excludedRows, ['left', 'right', 'right', 'right', 'left'])
      );
    }
  }

  return lines.join('\n\n');
}

function stripResearchNoiseFromComparisonBody(body: string): string {
  if (process.env.DEBUG === 'true') {
    return [
      '## ⚠️ Data Gaps',
      '## 🏦 Balance Sheet & Cash',
      '## 🧭 Indicative Allocation (Not Investment Advice)',
    ].reduce((current, heading) => stripMarkdownSection(current, heading), body);
  }
  return [
    '## ⚠️ Data Gaps',
    '## 🧑‍💼 Ownership & Positioning',
    '## 🧾 Insider Activity Summary',
    '## 🏦 Balance Sheet & Cash',
    '## 🧩 Data Coverage (Chart Inputs)',
    '## 🧭 Indicative Allocation (Not Investment Advice)',
  ].reduce((current, heading) => stripMarkdownSection(current, heading), body);
}

/**
 * Builds a comprehensive research report.
 *
 * Extends the comparison report with additional sections produced during the
 * AI-driven research analysis phase:
 *   1. Research methodology overview (initial candidates → refinement → comparison)
 *   2. Ecosystem & dependency analysis (supply chain, customers, macro factors)
 *   3. Company selection rationale (why specific companies were kept or excluded)
 *   4. Mermaid dependency map diagram
 *
 * The financial comparison tables and charts are identical to the regular
 * comparison report; the extra depth comes from the pre-report analysis phase.
 */
export function buildDeepSectorReport(data: DeepSectorReportData): string {
  const manualUniverse = data.selectedBy === 'manual';
  const initialCount = data.initialCandidates?.length ?? 0;
  const refinedCount = data.universe.length;

  const candidateLine = manualUniverse
    ? `**Preserved universe (${refinedCount} companies):** ${data.universe.join(', ')}`
    : initialCount > 0
    ? `**Initial candidates screened:** ${data.initialCandidates!.join(', ')}`
    : '';
  const refinedLine = manualUniverse
    ? ''
    : initialCount > refinedCount
    ? `**Refined to ${refinedCount} companies:** ${data.universe.join(', ')}`
    : `**Final universe (${refinedCount} companies):** ${data.universe.join(', ')}`;

  const methodologySteps = manualUniverse
    ? [
        `1. **Universe Preservation** — The saved report universe for **"${data.sectorQuery}"** was kept unchanged`,
        `2. **Data Refresh** — Fresh and cached provider data were requested for the preserved companies`,
        `3. **Checkpoint Fill** — Prior verified fields were carried forward only where this pass could not replace them`,
        `4. **Comparison** — Financial comparison was rebuilt for the preserved universe`,
      ].join('\n')
    : [
        `1. **Candidate Identification** — The resolver identified ${initialCount > 0 ? `${initialCount} verified initial` : 'a verified set of'} listed candidates for **"${data.sectorQuery}"**`,
        `2. **Universe Scoring** — Candidates were scored for theme relevance, investability/data quality, liquidity/scale, financial factors, and representative coverage`,
        `3. **Dependency Mapping** — Selected companies were grouped into role/exposure buckets before optional LLM ecosystem enrichment`,
        `4. **Comparison** — Full financial comparison built for the refined universe`,
      ].join('\n');

  const header = [
    `# Research Report: ${data.sectorQuery}`,
    `Generated: ${data.generatedAt}`,
    `## 🔬 Research Methodology`,
    methodologySteps,
    candidateLine,
    refinedLine,
  ].filter(Boolean).join('\n\n');

  const universeSelectionSection = buildResearchUniverseSelectionSection(data.universeSelection, manualUniverse);
  const dataQualitySection = buildResearchDataQualitySection(data.notes);

  // ── Research Ecosystem & Dependencies ───────────────────────────────────
  // The dependencyAnalysis string is expected to use structured ### subsection
  // headers generated by the LLM prompt (Supply Chain, Customer Exposure, etc.).
  // We add a brief context line before the structured content.
  const dependencySection = data.dependencyAnalysis
    ? (
        `## 🕸️ Research Ecosystem & Dependencies\n\n` +
        `> _Role map and dependency analysis based on verified profile/provider data first; optional AI enrichment is used only when budget allows._\n\n` +
        data.dependencyAnalysis
      )
    : '';

  const diagramSection = data.ecosystemDiagram
    ? `## 🗺️ Research Dependency Map\n\n\`\`\`mermaid\n${data.ecosystemDiagram}\n\`\`\``
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
  // conclusion so they are not duplicated (research adds its own conclusion).
  const comparisonBody = stripResearchNoiseFromComparisonBody(stripComparisonConclusion(
    buildComparisonReport(data)
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\nUniverse:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\nGenerated:[^\n]*\n\n/, '')
      .replace(/^# Company Comparison Report\n\n/, '')
      .trimStart()
  ));
  const insiderSections = process.env.DEBUG === 'true' ? buildDeepInsiderSections(data.items) : '';

  const scored = scoreComparisonItems(data.items, data.generatedAt);
  const allocationSection = buildResearchAllocationSection(scored, data.universeSelection, data.generatedAt);
  const conclusion = buildComparisonConclusion(data.items, scored, 'research', data.sectorQuery, data.llmConclusion, data.universeSelection);

  return [header, universeSelectionSection, dependencySection, diagramSection, refinementSection, snapshotsSection, dataQualitySection, comparisonBody, allocationSection, insiderSections, conclusion]
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

function stripMarkdownSection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return body
    .replace(new RegExp(`(?:^|\\n\\n)${escaped}\\n[\\s\\S]*?(?=\\n\\n## [^\\n]+|\\n\\n# [^\\n]+|$)`), '')
    .trim();
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

function buildWatchlistStockReportData(item: WatchlistDailyReportItem): StockReportData {
  if (!item.action || !item.reason) return item.stock;

  const action = normalizeActionLabel(item.action);
  const decisionAction = decisionActionFromSignal(action);
  const scorecard = computeScorecard(item.stock);

  return {
    ...item.stock,
    decisionSnapshot: {
      action: decisionAction,
      confidence: 'Medium',
      freshness: item.stock.decisionSnapshot?.freshness ?? 'fresh',
      overallScore: item.stock.decisionSnapshot?.overallScore ?? scorecard.composite,
      qualityScore: item.stock.decisionSnapshot?.qualityScore ?? null,
      valuationScore: item.stock.decisionSnapshot?.valuationScore ?? null,
      technicalScore: item.stock.decisionSnapshot?.technicalScore ?? null,
      portfolioFitScore: item.stock.decisionSnapshot?.portfolioFitScore ?? null,
      analystConsensusScore: item.stock.decisionSnapshot?.analystConsensusScore ?? null,
      insiderScore: item.stock.decisionSnapshot?.insiderScore ?? null,
      whyNow: action === 'Buy' || action === 'Hold' ? [item.reason] : [],
      whyNot: action === 'Watch' || action === 'Sell' ? [item.reason] : [],
      missingInputs: item.stock.decisionSnapshot?.missingInputs ?? [],
      changed: ['Watchlist action override applied to keep the report sections aligned.'],
      summary: item.reason,
      portfolioImpact: `Watchlist override applied. Recommended action: ${describeDecisionAction(decisionAction)}.`,
      invalidation: 'Reassess if fresher data or a catalyst changes the watchlist thesis.',
      nextTrigger: 'Revisit after the next material catalyst, fresh data refresh, or a meaningful move in the setup.',
    },
  };
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
    '## 🎯 Position Guidance',
    POSITION_GUIDANCE_NOTE,
    buildPositionGuidanceTable(rows),
  ].join('\n\n');
}

function buildWatchlistOverview(items: WatchlistDailyReportItem[], totalItems = items.length): string {
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
    `- **Signal Mix:** Buy ${counts.Buy} | Hold ${counts.Hold} | Watch ${counts.Watch} | Sell ${counts.Sell}${totalItems > items.length ? ' (full-coverage companies only)' : ''}`
  ];

  if (strongest) {
    lines.push(`- **Strongest setup:** ${(strongest.item.companyName || strongest.item.stock.companyOverview?.name || strongest.item.symbol)} (${strongest.item.symbol}) - ${strongest.decision.reason}`);
  }
  if (weakest && weakest !== strongest) {
    lines.push(`- **Name needing the most caution:** ${(weakest.item.companyName || weakest.item.stock.companyOverview?.name || weakest.item.symbol)} (${weakest.item.symbol}) - ${weakest.decision.reason}`);
  }

  return ['## Watchlist Overview', ...lines].join('\n');
}

function formatWatchlistSkippedItem(item: WatchlistSkippedItem): string {
  if (typeof item === 'string') return item;
  return item.reason ? `${item.symbol}: ${item.reason}` : item.symbol;
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
  const totalItems = data.totalItems && data.totalItems > data.items.length ? data.totalItems : data.items.length;
  const skippedItems = data.skippedItems || [];
  const header = [
    `# Watchlist Daily Report: ${data.watchlistName}`,
    `Generated: ${data.generatedAt}`,
    totalItems > data.items.length
      ? `**Full coverage:** ${data.items.length} / ${totalItems}\n\n**Limited/skipped:** ${Math.max(0, totalItems - data.items.length)} / ${totalItems}`
      : `**Companies covered:** ${data.items.length}`,
  ].join('\n\n');

  const summaryTable = buildWatchlistSummaryTable(data.items);
  const overview = buildWatchlistOverview(data.items, totalItems);
  const partialCoverage = skippedItems.length
    ? [
        '## Partial Coverage',
        '_These names were not included in the signal mix because full company sections could not be built before provider/runtime limits._',
        ...skippedItems.map((item) => `- ${formatWatchlistSkippedItem(item)}`),
      ].join('\n')
    : '';
  const companySections = data.items.map((item, index) => {
    const title = item.companyName || item.stock.companyOverview?.name || item.symbol;
    const reportData = buildWatchlistStockReportData(item);
    const embeddedBody = stripMarkdownSection(
      stripStockReportHeader(buildStockReport(reportData)),
      '## 🎯 Position Guidance'
    );
    const body = shiftMarkdownHeadings(
      embeddedBody,
      1
    );
    return [
      `## ${index + 1}. ${title} (${item.symbol})`,
      body,
    ].join('\n\n');
  });

  return [header, partialCoverage, summaryTable, overview, '## Full Company Research', ...companySections]
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
 * Derives a plain-English investment rating from the primary report score
 * (Decision Snapshot overall score when available, otherwise the data-only composite),
 * optionally adjusted by analyst consensus.
 *
 * @param compositeScore  Primary report score (0-100) or null if unavailable
 * @param analystBuyPct   Fraction of analyst ratings that are Buy/Strong-Buy (0-1), or null
 */
function deriveRating(
  compositeScore: number | null,
  analystBuyPct: number | null
): { label: string; emoji: string } {
  if (compositeScore === null && analystBuyPct === null) {
    return { label: 'WATCH', emoji: '•' };
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
  if (base >= 30) return { label: 'WATCH', emoji: '•' };
  return { label: 'SELL / AVOID', emoji: '🔴' };
}

function deriveRatingFromGuidance(guidance: PositionGuidance): { label: string; emoji: string } {
  if (guidance.stance === 'Buy') return { label: guidance.confidence === 'High' ? 'BUY' : 'BUY CANDIDATE', emoji: '✅' };
  if (guidance.stance === 'Hold') return { label: 'HOLD', emoji: '⚖️' };
  if (guidance.stance === 'Watch') return { label: 'WATCH', emoji: '•' };
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
  const analystSnapshot = getAnalystSnapshot(data);

  // Analyst buy fraction from real data
  const { strongBuy, buy, hold, sell, strongSell, total: totalAnalyst } = analystSnapshot;
  const analystBuyPct = totalAnalyst > 0 && strongBuy !== null && buy !== null
    ? ((strongBuy + buy) / totalAnalyst)
    : null;

  const positionGuidance = derivePositionGuidanceFromStock(data, scorecard.composite);
  const rating = deriveRatingFromGuidance(positionGuidance);

  const price = toNumber(data.price?.price);
  const { targetMean, upside } = analystSnapshot;

  // ── Suggested portfolio role ──────────────────────────────────────────────
  const moat = data.moatAnalysis;
  const composite = data.decisionSnapshot?.overallScore ?? scorecard.composite;
  const scoreLabel = primaryStockScoreLabel(data);
  const portfolioRole = derivePortfolioRoleLabel(data, scorecard, positionGuidance);

  // ── Data-derived quick-reference metrics ─────────────────────────────────
  const revenueGrowth = getStockRevenueGrowth(data);
  const opMargin = normalizePercent(
    data.basicFinancials?.metric?.operatingMarginTTM ?? overview.operatingMargin
  );
  const roe = normalizePercent(data.basicFinancials?.metric?.roeTTM ?? overview.returnOnEquity);
  const technical = getTechnicalSnapshot(price, data.priceHistory?.prices || [], {
    ...overview,
    ['50DayMovingAverage']: overview['50DayMovingAverage'] ?? data.analystRatings?.movingAverage50Day,
  });
  const beta = toNumber(overview.beta);
  const analystTargetSummary = formatAnalystTargetSummary(analystSnapshot, { includeRange: true });

  const dataLines: string[] = [
    `- **Rating:** ${rating.emoji} ${rating.label}`,
    `- **Suggested Portfolio Role:** ${portfolioRole}`,
    `- **Confidence:** ${positionGuidance.confidence}`,
    `- **For Owners:** ${positionGuidance.forOwners}`,
    `- **For Non-Owners:** ${describeNonOwnerAction(positionGuidance.forNonOwners)}`,
    `- **Why:** ${positionGuidance.rationale}`,
    positionGuidance.missingInputs.length ? `- **Decision Inputs Missing:** ${formatMissingInputs(positionGuidance.missingInputs, 3)}` : null,
    composite !== null ? `- **${scoreLabel}:** ${composite.toFixed(1)}/100` : null,
    analystTargetSummary ? `- **Analyst Target:** ${analystTargetSummary}` : null,
    `- **Trend:** ${technical.trend}`,
    formatMoatSummary(moat) ? `- **Moat:** ${formatMoatSummary(moat)}` : null,
    totalAnalyst > 0 ? `- **Analyst Consensus:** ${formatRatingSummary(data)}` : null,
  ].filter(Boolean) as string[];

  // ── Structured conclusion ────────────────────────────────────────────────
  // Do not render freeform LLM narratives here. Even when prompted with real
  // inputs, narrative text can introduce unsupported numbers or contradict
  // tables. Reports must prefer deterministic N/A-safe summaries.
  const bullish: string[] = [];
  const bearish: string[] = [];

  if (composite !== null) {
    if (composite >= 60) bullish.push(`Strong ${scoreLabel.toLowerCase()} (${composite.toFixed(1)}/100)`);
    else if (composite < 40) bearish.push(`Below-average ${scoreLabel.toLowerCase()} (${composite.toFixed(1)}/100)`);
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
    `> _Displayed values are sourced from provider/official data or direct arithmetic on those responses. Missing fields remain unavailable. Not financial advice._`,
    `### ${rating.emoji} ${name} (${symbol}) — ${rating.label}`,
    ...dataLines,
    bullLines || null,
    bearLines || null,
    '_This conclusion uses only available real provider/official data and does not fill missing metrics. Always conduct your own due diligence before investing._',
  ].filter(Boolean).join('\n\n');
}

/**
 * Builds the Investment Conclusion section for a multi-stock comparison report
 * (used by comparison and research-style reports).
 *
 * When `llmConclusion` is provided it forms the main narrative; data-derived
 * rankings and metrics are appended as a quick-reference section.
 *
 * @param items        The comparison items with financial data
 * @param scored       Each item paired with its primary report score
 * @param reportType   'comparison' | 'sector' | 'research'
 * @param sectorQuery  Optional sector/theme label for sector-type reports
 * @param llmConclusion Optional LLM-generated narrative
 */
function buildComparisonConclusion(
  items: ComparisonReportItem[],
  scored: Array<{ item: ComparisonReportItem; score: number | null }>,
  reportType: 'comparison' | 'sector' | 'research',
  sectorQuery?: string,
  llmConclusion?: string,
  universeSelection?: ResearchUniverseSelection
): string {
  if (items.length === 0) return '';
  const qualifiedResearchSymbols = reportType === 'research' && universeSelection
    ? new Set(universeSelection.qualifiedSymbols)
    : null;
  const scoredForRecommendation = qualifiedResearchSymbols
    ? scored.filter((row) => qualifiedResearchSymbols.has(row.item.symbol))
    : scored;

  // Rank by mixed score source: Decision Snapshot overall score when available,
  // otherwise the data-only composite score.
  const ranked = scoredForRecommendation
    .filter((r) => r.score !== null)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const sortedForReference = [...scored].sort((a, b) => {
    if (a.score === null && b.score === null) return 0;
    if (a.score === null) return 1;
    if (b.score === null) return -1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  const top = ranked[0];
  const runnerUp = ranked[1];
  const topName = top?.item.overview?.name || top?.item.symbol || 'N/A';
  const topSymbol = top?.item.symbol || 'N/A';
  const topScore = top?.score;
  const recommendationRows = scoredForRecommendation.map((row) => {
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

  // Average score → group outlook
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
    : reportType === 'research' ? `**Research Outlook (${sectorQuery || 'topic'}):** ${outlook}`
    : `**Peer Group Outlook:** ${outlook}`;

  const strategyAdvice =
    qualifiedResearchSymbols && scoredForRecommendation.length === 0
      ? `No qualified theme subset cleared the current evidence gates; wait for a fresh universe rebuild before using allocation guidance.`
      : topScore !== null && topScore >= 65
      ? `Focused allocation to the top-ranked name(s) is supported by the data.`
      : `A diversified basket approach reduces single-name risk given mixed fundamentals.`;

  // Build data-derived quick reference lines for every company
  const companyRefLines = sortedForReference.map((r) => {
    const n = r.item.overview?.name || r.item.symbol;
    const sym = r.item.symbol;
    const analystTargetSummary = formatAnalystTargetSummary(getAnalystSnapshot(r.item));
    const parts = [
      formatScoreSummary(comparisonScoreSourceLabel(r.item), r.score),
      analystTargetSummary ? `Target ${analystTargetSummary}` : null,
      formatMoatSummary(r.item.moatAnalysis),
    ].filter(Boolean).join(' · ');
    return `- **${n} (${sym}):** ${parts || 'Insufficient data'}`;
  });

  // Summary block always shown
  const summaryLines = [
    qualifiedResearchSymbols ? `**Qualified research subset:** ${scoredForRecommendation.length ? scoredForRecommendation.map((row) => row.item.symbol).join(', ') : 'none'}` : null,
    top ? `**Top Pick: ${topName} (${topSymbol})** — ${formatScoreSummary(comparisonScoreSourceLabel(top.item), topScore)}` : '_Insufficient data for ranking._',
    runnerUp ? `- Runner-up: ${runnerUp.item.overview?.name || runnerUp.item.symbol} (${runnerUp.item.symbol}) — ${formatScoreSummary(comparisonScoreSourceLabel(runnerUp.item), runnerUp.score)}` : null,
    freshEntryBuys.length ? `- Fresh-entry buys: ${freshEntryBuys.slice(0, 3).join(', ')}` : '- Fresh-entry buys: none at current thresholds',
    cautionNames.length ? `- Highest-caution names: ${cautionNames.slice(0, 3).join(', ')}` : null,
    moatLeader ? `- Strongest moat: **${moatLeader.overview?.name || moatLeader.symbol} (${moatLeader.symbol})** — ${formatMoatSummary(moatLeader.moatAnalysis)}` : null,
    outlookLabel,
    '- Score source: Decision Snapshot overall score when available; otherwise the data-only composite score.',
    `- Strategy: ${strategyAdvice}`,
  ].filter(Boolean).join('\n\n');

  return [
    '## 🎯 Investment Conclusion',
    `> _Displayed values are sourced from provider/official data or direct arithmetic on those responses. Missing fields remain unavailable. Not financial advice._`,
    summaryLines,
    '### 📊 Company Quick Reference',
    ...companyRefLines,
    '_Always conduct your own due diligence before making investment decisions._',
  ].filter(Boolean).join('\n\n');
}

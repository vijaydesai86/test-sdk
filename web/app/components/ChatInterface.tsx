'use client';

import { useState, useRef, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import * as echarts from 'echarts';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  stats?: {
    rounds: number;
    toolCalls: number;
    toolsProvided: number;
  };
}

interface ReportItem {
  filename: string;
  content?: string;
  downloadUrl?: string;
  title?: string;
  summary?: string;
  reportDate?: string;
  reportKind?: string;
  storagePath?: string;
}

interface SavedReportMeta {
  id: string;
  filename: string;
  title: string | null;
  summary?: string | null;
  created_at: string;
  report_date?: string | null;
  report_kind?: string | null;
  storage_path?: string | null;
}

interface WatchlistItemMeta {
  id: string;
  symbol: string;
  companyName: string;
  displayOrder: number;
  createdAt: string;
  ownershipStatus: 'watching' | 'owned' | 'exited';
  currentWeight: number | null;
  targetWeight: number | null;
  maxWeight: number | null;
  costBasis: number | null;
  conviction: 'low' | 'medium' | 'high';
  thesis: string;
  desiredEntryMin: number | null;
  desiredEntryMax: number | null;
  trimAbove: number | null;
  invalidation: string;
  reviewDate: string | null;
  lastReviewedAt: string | null;
  notes: string;
}

interface PortfolioProfileMeta {
  riskTolerance: 'low' | 'medium' | 'high';
  holdingHorizon: 'weeks' | 'months' | 'years';
  maxPositionWeight: number | null;
  targetCashPct: number | null;
  concentrationLimit: number | null;
  strategyNotes: string;
  updatedAt?: string;
}

interface WatchlistMeta {
  id: string;
  name: string;
  slug: string;
  items: WatchlistItemMeta[];
  profile: PortfolioProfileMeta;
}

type WorkspaceTab = 'watchlist' | 'artifacts' | 'saved';
type ThemeId = 'aurora' | 'solstice' | 'ember' | 'graphite';

const DEFAULT_THEME: ThemeId = 'aurora';
const THEME_STORAGE_KEY = 'stock-ui-theme';

const CHART_HEIGHT = 280;
const MAX_TEXTAREA_HEIGHT = 160;
const TOOL_CALL_WARNING =
  'Model returned tool calls as plain text. The system will retry with a different model automatically. If the issue persists, try rephrasing your request.';
const isToolCallText = (content: string) =>
  /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);

const THEME_OPTIONS: Array<{ id: ThemeId; label: string; blurb: string }> = [
  { id: 'aurora', label: 'Aurora', blurb: 'Cool glass and the strongest overall contrast.' },
  { id: 'solstice', label: 'Solstice', blurb: 'Ocean blue with a cleaner editorial feel.' },
  { id: 'ember', label: 'Ember', blurb: 'Warmer copper glow for a richer desk feel.' },
  { id: 'graphite', label: 'Graphite', blurb: 'Minimal monochrome with subtle blue lift.' },
];

const QUICK_PROMPTS = [
  {
    label: 'Report on Arm Holdings',
    prompt: 'Give me a stock report on Arm Holdings',
    eyebrow: 'Single company',
  },
  {
    label: 'Nvidia vs AMD vs Intel',
    prompt: 'Compare Nvidia, AMD, and Intel',
    eyebrow: 'Comparison',
  },
  {
    label: 'AI infrastructure sector',
    prompt: 'Deep research on AI infrastructure stocks',
    eyebrow: 'Sector study',
  },
  {
    label: 'Visa vs Mastercard',
    prompt: 'Deep research on Visa vs Mastercard',
    eyebrow: 'Competitive moat',
  },
  {
    label: 'Daily watchlist report',
    prompt: 'Generate daily report for my watchlist',
    eyebrow: 'Portfolio pulse',
  },
];

function Icon({ children, className = 'h-4 w-4' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartId = useId();

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        fontFamily: 'Avenir Next, Segoe UI, sans-serif',
        primaryColor: '#14b8a6',
        primaryTextColor: '#0f172a',
        lineColor: '#0f766e',
        tertiaryColor: '#ccfbf1',
      },
    });
    mermaid
      .render(`mermaid-${chartId}`, chart)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(() => {
        if (!cancelled && containerRef.current) {
          containerRef.current.textContent = 'Chart rendering failed.';
        }
      });
    return () => {
      cancelled = true;
    };
  }, [chart, chartId]);

  return <div ref={containerRef} className="my-4 overflow-x-auto" />;
}

function ChartBlock({ option }: { option: Record<string, unknown> }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    instance.setOption(option, { notMerge: true });
    const handleResize = () => instance.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      instance.dispose();
    };
  }, [option]);

  return <div ref={containerRef} className="my-4 w-full" style={{ height: `${CHART_HEIGHT}px` }} />;
}

function humanizeSlug(value: string) {
  return value
    .replace(/\.md$/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}t[\w-]+z?$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function formatShortDate(value?: string | null) {
  if (!value) return '';
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(parsed);
}

function formatLibraryDate(value: string) {
  if (value === 'Undated') return value;
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

function getDateBucket(primary?: string | null, secondary?: string | null) {
  if (primary) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(primary)) return primary;
    const directDate = new Date(primary);
    if (!Number.isNaN(directDate.getTime())) {
      return directDate.toISOString().slice(0, 10);
    }
  }
  if (secondary) {
    const matched = secondary.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (matched) return matched[0];
  }
  return 'Undated';
}

function buildReportTitle(item: Pick<ReportItem, 'title' | 'filename'>) {
  return item.title?.trim() || humanizeSlug(item.filename);
}

function buildSavedTitle(item: Pick<SavedReportMeta, 'title' | 'filename'>) {
  return item.title?.trim() || humanizeSlug(item.filename);
}

function buildReportSummary(item: Pick<ReportItem, 'summary' | 'reportKind' | 'filename'>) {
  if (item.summary?.trim()) return item.summary.trim();
  if (item.reportKind?.trim()) return `${humanizeSlug(item.reportKind)} report`; 
  return `Preview ${humanizeSlug(item.filename)}.`;
}

function buildSavedSummary(item: Pick<SavedReportMeta, 'summary' | 'report_kind' | 'filename'>) {
  if (item.summary?.trim()) return item.summary.trim();
  if (item.report_kind?.trim()) return `${humanizeSlug(item.report_kind)} report`;
  return `Saved markdown report for ${humanizeSlug(item.filename)}.`;
}

function groupByDate<T>(items: T[], getBucket: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const bucket = getBucket(item);
    const existing = groups.get(bucket) ?? [];
    existing.push(item);
    groups.set(bucket, existing);
  }
  return [...groups.entries()]
    .sort((a, b) => {
      if (a[0] === 'Undated') return 1;
      if (b[0] === 'Undated') return -1;
      return b[0].localeCompare(a[0]);
    })
    .map(([date, bucketItems]) => ({ date, label: formatLibraryDate(date), items: bucketItems }));
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-inherit">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table({ children, ...props }) {
            return (
              <div className="stock-markdown-table-wrap" role="region" aria-label="Scrollable data table" tabIndex={0}>
                <table {...props}>{children}</table>
              </div>
            );
          },
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className ?? '');
            if (match?.[1] === 'mermaid') {
              return <MermaidBlock chart={String(children).trim()} />;
            }
            if (match?.[1] === 'chart' || match?.[1] === 'echarts') {
              try {
                const option = JSON.parse(String(children)) as Record<string, unknown>;
                return <ChartBlock option={option} />;
              } catch {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [deletedReports, setDeletedReports] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('watchlist');
  const [theme, setTheme] = useState<ThemeId>(() => {
    if (typeof window === 'undefined') return DEFAULT_THEME;
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    return savedTheme && THEME_OPTIONS.some((option) => option.id === savedTheme)
      ? savedTheme as ThemeId
      : DEFAULT_THEME;
  });
  const [supabaseReports, setSupabaseReports] = useState<SavedReportMeta[]>([]);
  const [supabaseReportsLoading, setSupabaseReportsLoading] = useState(false);
  const [supabaseSetupRequired, setSupabaseSetupRequired] = useState(false);
  const [watchlist, setWatchlist] = useState<WatchlistMeta | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistInput, setWatchlistInput] = useState('');
  const [portfolioProfileDraft, setPortfolioProfileDraft] = useState<PortfolioProfileMeta | null>(null);
  const [watchlistItemDrafts, setWatchlistItemDrafts] = useState<Record<string, WatchlistItemMeta>>({});

  const fetchSupabaseReports = () => {
    setSupabaseReportsLoading(true);
    fetch('/api/saved-reports')
      .then((res) => res.json())
      .then((payload: { reports?: SavedReportMeta[]; setupRequired?: boolean }) => {
        setSupabaseReports(payload.reports ?? []);
        setSupabaseSetupRequired(payload.setupRequired === true);
      })
      .catch(() => {
        /* Supabase may not be configured */
      })
      .finally(() => setSupabaseReportsLoading(false));
  };

  const fetchWatchlist = () => {
    setWatchlistLoading(true);
    setWatchlistError(null);
    fetch('/api/watchlist')
      .then(async (res) => {
        const payload = (await res.json()) as { watchlist?: WatchlistMeta; error?: string };
        if (!res.ok) throw new Error(payload.error || 'Failed to load watchlist');
        const nextWatchlist = payload.watchlist ?? null;
        setWatchlist(nextWatchlist);
        setPortfolioProfileDraft(nextWatchlist?.profile ?? null);
        setWatchlistItemDrafts(
          nextWatchlist
            ? nextWatchlist.items.reduce<Record<string, WatchlistItemMeta>>((acc, item) => {
                acc[item.symbol] = item;
                return acc;
              }, {})
            : {}
        );
      })
      .catch((err: unknown) => {
        setWatchlistError(err instanceof Error ? err.message : 'Failed to load watchlist');
      })
      .finally(() => setWatchlistLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchSupabaseReports();
    fetchWatchlist();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  useEffect(() => {
    const shouldLock = sidebarOpen || reportPreview !== null;
    document.body.style.overflow = shouldLock ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sidebarOpen, reportPreview]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    document.documentElement.dataset.stockTheme = theme;
  }, [theme]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;

    const userMessage = prompt.trim();
    setSidebarOpen(false);
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: userMessage, sessionId }),
        });

      const rawText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        throw new Error(rawText || 'Failed to parse server response');
      }

      if (!res.ok) {
        const errMsg = typeof data.details === 'string'
          ? `${String(data.error ?? 'Error')} - ${data.details}`
          : String(data.error ?? 'Failed to get response');
        throw new Error(errMsg);
      }

      const responseText = typeof data.response === 'string' ? data.response : '';
      const assistantText = isToolCallText(responseText) ? TOOL_CALL_WARNING : responseText;
      if (isToolCallText(responseText)) setError(TOOL_CALL_WARNING);

      setSessionId(typeof data.sessionId === 'string' ? data.sessionId : null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: assistantText,
          stats: data.stats as Message['stats'],
        },
      ]);

      const report = data.report as {
        filename?: string;
        content?: string;
        downloadUrl?: string;
        title?: string;
        summary?: string;
        reportDate?: string;
        reportKind?: string;
        storagePath?: string;
      } | null;
      const reports = data.reports as Array<{
        filename?: string;
        content?: string;
        downloadUrl?: string;
        title?: string;
        summary?: string;
        reportDate?: string;
        reportKind?: string;
        storagePath?: string;
      }> | null;
      const allReports = reports?.length
        ? reports
        : report?.filename && report?.content ? [report] : [];
      if (allReports.length > 0) {
        setSavedReports((prev) => {
          let updated = prev;
          for (const r of allReports) {
            if (r.filename && r.content && !updated.find((s) => s.filename === r.filename)) {
              updated = [
                ...updated,
                {
                  filename: r.filename,
                  content: r.content,
                  downloadUrl: r.downloadUrl,
                  title: r.title,
                  summary: r.summary,
                  reportDate: r.reportDate,
                  reportKind: r.reportKind,
                  storagePath: r.storagePath,
                },
              ];
            }
          }
          return updated;
        });
        fetchSupabaseReports();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendPrompt(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendPrompt(input);
    }
  };

  const reportLinks = Array.from(
    new Set(
      messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content.match(/\/api\/reports\/[a-z0-9/_-]+\.md/gi) ?? [])
    )
  ).filter((link) => !deletedReports.has(link));

  const reportItems: ReportItem[] = [
    ...savedReports,
    ...reportLinks
      .map((link) => ({ filename: link.split('/').pop() ?? link, downloadUrl: link, storagePath: link }))
      .filter((r) => !savedReports.find((s) => s.filename === r.filename)),
  ];

  const artifactGroups = groupByDate(reportItems, (item) =>
    getDateBucket(item.reportDate, item.storagePath ?? item.downloadUrl ?? item.filename)
  );
  const savedReportGroups = groupByDate(supabaseReports, (item) =>
    getDateBucket(item.report_date ?? item.created_at, item.storage_path ?? item.filename)
  );

  const handleReportClick = async (item: ReportItem) => {
    setSidebarOpen(false);
    setReportLoading(true);
    setReportUrl(item.downloadUrl ?? null);
    try {
      if (item.content) {
        setReportPreview(item.content);
        setReportTitle(item.title ?? item.filename);
        return;
      }
      if (!item.downloadUrl) {
        setReportPreview('Unable to load report preview.');
        setReportTitle(item.title ?? item.filename ?? 'Report');
        return;
      }
      const res = await fetch(item.downloadUrl);
      const content = await res.text();
      setReportPreview(content);
      setReportTitle(item.title ?? item.filename ?? 'Report');
    } catch {
      setReportPreview('Unable to load report preview.');
      setReportTitle(item.title ?? item.filename ?? 'Report');
    } finally {
      setReportLoading(false);
    }
  };

  const handleReportDownload = (item: ReportItem) => {
    if (!item.content) {
      if (item.downloadUrl) window.open(item.downloadUrl, '_blank');
      return;
    }
    const blob = new Blob([item.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handleReportDelete = async (item: ReportItem) => {
    setError(null);
    try {
      if (item.downloadUrl) {
        const res = await fetch(item.downloadUrl, { method: 'DELETE' });
        const data = (await res.json()) as Record<string, unknown>;
        if (!res.ok) throw new Error(String(data.error ?? 'Failed to delete report'));
      }
      setDeletedReports((prev) => new Set(prev).add(item.downloadUrl ?? item.filename));
      setSavedReports((prev) => prev.filter((s) => s.filename !== item.filename));
      if (reportUrl === item.downloadUrl) {
        setReportUrl(null);
        setReportPreview(null);
        setReportTitle(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete report');
    }
  };

  const handleSupabaseReportClick = async (report: SavedReportMeta) => {
    setSidebarOpen(false);
    setReportLoading(true);
    const downloadUrl = `/api/saved-reports/${report.id}`;
    setReportUrl(downloadUrl);
    try {
      const res = await fetch(downloadUrl);
      const content = await res.text();
      setReportPreview(content);
      setReportTitle(report.title || report.filename);
    } catch {
      setReportPreview('Unable to load report preview.');
      setReportTitle(report.title || report.filename);
    } finally {
      setReportLoading(false);
    }
  };

  const handleSupabaseReportDownload = async (report: SavedReportMeta) => {
    try {
      const res = await fetch(`/api/saved-reports/${report.id}`);
      const content = await res.text();
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = report.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(`/api/saved-reports/${report.id}`, '_blank');
    }
  };

  const handleSupabaseReportDelete = async (report: SavedReportMeta) => {
    setError(null);
    try {
      const res = await fetch(`/api/saved-reports/${report.id}`, { method: 'DELETE' });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data.error ?? 'Failed to delete report'));
      setSupabaseReports((prev) => prev.filter((r) => r.id !== report.id));
      if (reportUrl === `/api/saved-reports/${report.id}`) {
        setReportUrl(null);
        setReportPreview(null);
        setReportTitle(null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete report');
    }
  };

  const handleWatchlistAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!watchlistInput.trim() || watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistError(null);
    try {
      const res = await fetch('/api/watchlist/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: watchlistInput.trim() }),
      });
      const payload = (await res.json()) as { watchlist?: WatchlistMeta; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Failed to add watchlist item');
      setWatchlist(payload.watchlist ?? null);
      setWatchlistInput('');
    } catch (err: unknown) {
      setWatchlistError(err instanceof Error ? err.message : 'Failed to add watchlist item');
    } finally {
      setWatchlistBusy(false);
    }
  };

  const handleWatchlistRemove = async (symbol: string) => {
    if (watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistError(null);
    try {
      const res = await fetch(`/api/watchlist/items/${encodeURIComponent(symbol)}`, { method: 'DELETE' });
      const payload = (await res.json()) as { watchlist?: WatchlistMeta; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Failed to remove watchlist item');
      setWatchlist(payload.watchlist ?? null);
    } catch (err: unknown) {
      setWatchlistError(err instanceof Error ? err.message : 'Failed to remove watchlist item');
    } finally {
      setWatchlistBusy(false);
    }
  };

  const handlePortfolioProfileSave = async () => {
    if (!portfolioProfileDraft || watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistError(null);
    try {
      const res = await fetch('/api/watchlist', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(portfolioProfileDraft),
      });
      const payload = (await res.json()) as { watchlist?: WatchlistMeta; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Failed to update portfolio profile');
      setWatchlist(payload.watchlist ?? null);
    } catch (err: unknown) {
      setWatchlistError(err instanceof Error ? err.message : 'Failed to update portfolio profile');
    } finally {
      setWatchlistBusy(false);
    }
  };

  const updateItemDraft = (symbol: string, patch: Partial<WatchlistItemMeta>) => {
    setWatchlistItemDrafts((prev) => ({
      ...prev,
      [symbol]: {
        ...(prev[symbol] || watchlist?.items.find((item) => item.symbol === symbol) || {} as WatchlistItemMeta),
        ...patch,
      },
    }));
  };

  const handleWatchlistItemSave = async (symbol: string) => {
    const draft = watchlistItemDrafts[symbol];
    if (!draft || watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistError(null);
    const requestBody = {
      ...draft,
      lastReviewedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(`/api/watchlist/items/${encodeURIComponent(symbol)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      const payload = (await res.json()) as { watchlist?: WatchlistMeta; error?: string };
      if (!res.ok) throw new Error(payload.error || 'Failed to update watchlist item');
      setWatchlist(payload.watchlist ?? null);
    } catch (err: unknown) {
      setWatchlistError(err instanceof Error ? err.message : 'Failed to update watchlist item');
    } finally {
      setWatchlistBusy(false);
    }
  };

  const handleGenerateDailyReport = () => {
    setSidebarOpen(false);
    void sendPrompt('Generate daily report for my watchlist');
  };

  const workspaceTabs: Array<{ id: WorkspaceTab; label: string; count: number }> = [
    { id: 'watchlist', label: 'Watchlist', count: watchlist?.items.length ?? 0 },
    { id: 'artifacts', label: 'Artifacts', count: reportItems.length },
    { id: 'saved', label: 'Saved', count: supabaseReports.length },
  ];

  const panelTabClass = (tab: WorkspaceTab) =>
    [
      'rounded-2xl border px-3 py-3 text-left transition-all',
      activeWorkspaceTab === tab
        ? 'border-white/20 bg-white text-slate-950 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.55)]'
        : 'border-white/10 bg-white/6 text-slate-100 hover:bg-white/10',
    ].join(' ');

  const railButtonClass = (tab: WorkspaceTab) =>
    [
      'group flex h-14 w-14 items-center justify-center rounded-2xl border transition-all',
      activeWorkspaceTab === tab
        ? 'border-teal-300/60 bg-gradient-to-br from-teal-300 to-cyan-300 text-slate-950 shadow-[0_18px_45px_-24px_rgba(45,212,191,0.9)]'
        : 'border-white/10 bg-white/8 text-slate-200 hover:border-white/20 hover:bg-white/14',
    ].join(' ');

  const renderWorkspacePane = (mobile = false) => {
    if (activeWorkspaceTab === 'watchlist') {
      return (
        <div className="space-y-4">
          <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.75)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-teal-200/70">Watchlist Workspace</p>
                <h2 className="mt-1 text-lg font-semibold text-white">
                  {watchlist?.name || 'Default watchlist'}
                </h2>
                <p className="mt-1 text-sm text-slate-300">
                  Keep the portfolio pulse one tap away, then generate the daily report from the same surface.
                </p>
              </div>
              <button
                type="button"
                onClick={handleGenerateDailyReport}
                disabled={isLoading || watchlistLoading || !watchlist?.items.length}
                className="rounded-full bg-gradient-to-r from-teal-300 via-cyan-300 to-sky-300 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Daily report
              </button>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Tracked</p>
                <p className="mt-2 text-2xl font-semibold text-white">{watchlist?.items.length ?? 0}</p>
                <p className="mt-1 text-xs text-slate-400">Companies in focus</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">State</p>
                <p className="mt-2 text-2xl font-semibold text-white">{watchlistBusy ? 'Busy' : 'Ready'}</p>
                <p className="mt-1 text-xs text-slate-400">Live add and remove actions</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Coverage</p>
                <p className="mt-2 text-2xl font-semibold text-white">1x</p>
                <p className="mt-1 text-xs text-slate-400">Unified daily summary</p>
              </div>
            </div>
          </div>

          <div className="rounded-[26px] border border-white/10 bg-white/7 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.9)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/70">Portfolio Context</p>
                <h3 className="mt-1 text-lg font-semibold text-white">Investor profile used in decisions</h3>
                <p className="mt-1 text-sm text-slate-300">
                  These settings feed the recommendation layer so actions are sized for your portfolio, not generic market commentary.
                </p>
                {portfolioProfileDraft?.updatedAt && (
                  <p className="mt-2 text-xs text-slate-400">
                    Last updated {formatShortDate(portfolioProfileDraft.updatedAt) || portfolioProfileDraft.updatedAt}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handlePortfolioProfileSave()}
                disabled={watchlistBusy || !portfolioProfileDraft}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Save profile
              </button>
            </div>
            {portfolioProfileDraft && (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Risk tolerance</span>
                  <select
                    value={portfolioProfileDraft.riskTolerance}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, riskTolerance: e.target.value as PortfolioProfileMeta['riskTolerance'] } : prev)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Holding horizon</span>
                  <select
                    value={portfolioProfileDraft.holdingHorizon}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, holdingHorizon: e.target.value as PortfolioProfileMeta['holdingHorizon'] } : prev)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  >
                    <option value="weeks">Weeks</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                  </select>
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Max position %</span>
                  <input
                    type="number"
                    value={portfolioProfileDraft.maxPositionWeight ?? ''}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, maxPositionWeight: e.target.value ? Number(e.target.value) : null } : prev)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Target cash %</span>
                  <input
                    type="number"
                    value={portfolioProfileDraft.targetCashPct ?? ''}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, targetCashPct: e.target.value ? Number(e.target.value) : null } : prev)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-200">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Concentration limit %</span>
                  <input
                    type="number"
                    value={portfolioProfileDraft.concentrationLimit ?? ''}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, concentrationLimit: e.target.value ? Number(e.target.value) : null } : prev)}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </label>
                <label className="space-y-2 text-sm text-slate-200 md:col-span-2">
                  <span className="block text-xs uppercase tracking-[0.18em] text-slate-400">Strategy notes</span>
                  <textarea
                    value={portfolioProfileDraft.strategyNotes}
                    onChange={(e) => setPortfolioProfileDraft((prev) => prev ? { ...prev, strategyNotes: e.target.value } : prev)}
                    rows={3}
                    className="w-full rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </label>
              </div>
            )}
          </div>

          <form
            onSubmit={handleWatchlistAdd}
            className="rounded-[26px] border border-white/10 bg-white/7 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.9)]"
          >
            <label htmlFor={mobile ? 'watchlist-mobile' : 'watchlist-desktop'} className="block text-sm font-medium text-white">
              Add ticker or company
            </label>
            <div className="mt-3 flex gap-2">
              <input
                id={mobile ? 'watchlist-mobile' : 'watchlist-desktop'}
                value={watchlistInput}
                onChange={(e) => setWatchlistInput(e.target.value)}
                placeholder="AAPL or Apple"
                disabled={watchlistBusy}
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/50 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-300 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={watchlistBusy || !watchlistInput.trim()}
                className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium text-white transition hover:bg-white/16 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add
              </button>
            </div>
            {watchlistError && (
              <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
                {watchlistError}
              </p>
            )}
          </form>

          <div className="space-y-3">
            {watchlistLoading ? (
              <div className="rounded-[24px] border border-white/10 bg-white/7 px-4 py-5 text-sm text-slate-300">
                Loading watchlist...
              </div>
            ) : !watchlist?.items.length ? (
              <div className="rounded-[24px] border border-dashed border-white/12 bg-white/5 px-4 py-8 text-center text-sm text-slate-300">
                No companies in the watchlist yet.
              </div>
            ) : (
              watchlist.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-[24px] border border-white/10 bg-white/7 p-4 shadow-[0_16px_35px_-30px_rgba(15,23,42,0.9)]"
                >
                  {(() => {
                    const draft = watchlistItemDrafts[item.symbol] || item;
                    return (
                      <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-teal-300/20 bg-teal-300/10 px-2.5 py-1 text-[11px] font-semibold tracking-[0.18em] text-teal-100">
                          {item.symbol}
                        </span>
                        {formatShortDate(item.createdAt) && (
                          <span className="text-xs text-slate-400">{formatShortDate(item.createdAt)}</span>
                        )}
                      </div>
                      <p className="mt-3 truncate text-sm text-slate-200">{item.companyName}</p>
                      <p className="mt-2 text-xs text-slate-400">
                        {draft.ownershipStatus === 'owned' ? 'Owned position' : draft.ownershipStatus === 'exited' ? 'Exited / archived thesis' : 'Watching for entry'}
                        {' · '}
                        Conviction {draft.conviction}
                      </p>
                      {draft.lastReviewedAt && (
                        <p className="mt-2 text-xs text-slate-500">
                          Last reviewed {formatShortDate(draft.lastReviewedAt) || draft.lastReviewedAt}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleWatchlistItemSave(item.symbol)}
                        disabled={watchlistBusy}
                        title="Save item context"
                        className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-teal-300/35 hover:text-teal-100 disabled:opacity-40"
                      >
                        <Icon className="h-4 w-4">
                          <path d="m5 12 4 4L19 6" />
                        </Icon>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleWatchlistRemove(item.symbol)}
                        disabled={watchlistBusy}
                        title="Remove"
                        className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-rose-300/35 hover:text-rose-200 disabled:opacity-40"
                      >
                        <Icon className="h-4 w-4">
                          <path d="M18 6 6 18" />
                          <path d="m6 6 12 12" />
                        </Icon>
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Status</span>
                      <select
                        value={draft.ownershipStatus}
                        onChange={(e) => updateItemDraft(item.symbol, { ownershipStatus: e.target.value as WatchlistItemMeta['ownershipStatus'] })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      >
                        <option value="watching">Watching</option>
                        <option value="owned">Owned</option>
                        <option value="exited">Exited</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Conviction</span>
                      <select
                        value={draft.conviction}
                        onChange={(e) => updateItemDraft(item.symbol, { conviction: e.target.value as WatchlistItemMeta['conviction'] })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Current weight %</span>
                      <input
                        type="number"
                        value={draft.currentWeight ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { currentWeight: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Target weight %</span>
                      <input
                        type="number"
                        value={draft.targetWeight ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { targetWeight: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Max weight %</span>
                      <input
                        type="number"
                        value={draft.maxWeight ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { maxWeight: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Cost basis</span>
                      <input
                        type="number"
                        value={draft.costBasis ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { costBasis: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Entry min</span>
                      <input
                        type="number"
                        value={draft.desiredEntryMin ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { desiredEntryMin: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Entry max</span>
                      <input
                        type="number"
                        value={draft.desiredEntryMax ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { desiredEntryMax: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Trim above</span>
                      <input
                        type="number"
                        value={draft.trimAbove ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { trimAbove: e.target.value ? Number(e.target.value) : null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Review date</span>
                      <input
                        type="date"
                        value={draft.reviewDate ?? ''}
                        onChange={(e) => updateItemDraft(item.symbol, { reviewDate: e.target.value || null })}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300 md:col-span-2">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Thesis</span>
                      <textarea
                        value={draft.thesis}
                        onChange={(e) => updateItemDraft(item.symbol, { thesis: e.target.value })}
                        rows={2}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300 md:col-span-2">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Invalidation</span>
                      <textarea
                        value={draft.invalidation}
                        onChange={(e) => updateItemDraft(item.symbol, { invalidation: e.target.value })}
                        rows={2}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                    <label className="space-y-2 text-xs text-slate-300 md:col-span-2">
                      <span className="uppercase tracking-[0.18em] text-slate-500">Notes</span>
                      <textarea
                        value={draft.notes}
                        onChange={(e) => updateItemDraft(item.symbol, { notes: e.target.value })}
                        rows={2}
                        className="w-full rounded-2xl border border-white/10 bg-slate-950/45 px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-teal-300"
                      />
                    </label>
                  </div>
                      </>
                    );
                  })()}
                </div>
              ))
            )}
          </div>
        </div>
      );
    }

    if (activeWorkspaceTab === 'artifacts') {
      return (
        <div className="space-y-4">
          <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.75)]">
            <p className="text-[11px] uppercase tracking-[0.28em] text-cyan-200/70">Session Artifacts</p>
            <h2 className="mt-1 text-lg font-semibold text-white">Generated in this workspace</h2>
            <p className="mt-1 text-sm text-slate-300">
              Reports are grouped by day and surfaced as cards with real labels, not a flat stream of repeated filenames.
            </p>
            <div className="mt-4">
              <div className="rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Artifacts</p>
                <p className="mt-2 text-2xl font-semibold text-white">{reportItems.length}</p>
                <p className="mt-1 text-xs text-slate-400">Built in the current session</p>
              </div>
            </div>
          </div>

          {reportItems.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-white/12 bg-white/5 px-4 py-8 text-center text-sm text-slate-300">
              No reports yet. Ask for a stock, comparison, deep research, or watchlist daily report.
            </div>
          ) : (
            artifactGroups.map((group) => (
              <section key={group.date} className="space-y-3">
                <div className="flex items-center justify-between gap-3 px-1">
                  <div>
                    <h3 className="text-sm font-semibold text-white">{group.label}</h3>
                    <p className="text-xs text-slate-400">{group.items.length} report{group.items.length === 1 ? '' : 's'}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {group.items.map((item) => (
                    <div
                      key={item.downloadUrl ?? item.filename}
                      className="rounded-[24px] border border-white/10 bg-white/7 p-4 shadow-[0_16px_35px_-30px_rgba(15,23,42,0.9)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => handleReportClick(item)}
                          className="min-w-0 flex-1 text-left"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium text-white">{buildReportTitle(item)}</p>
                            {item.reportKind && (
                              <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-cyan-100">
                                {humanizeSlug(item.reportKind)}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{buildReportSummary(item)}</p>
                        </button>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleReportDownload(item)}
                            title="Download"
                            className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-cyan-300/35 hover:text-cyan-100"
                          >
                            <Icon className="h-4 w-4">
                              <path d="M12 3v12" />
                              <path d="m7 10 5 5 5-5" />
                              <path d="M4 20h16" />
                            </Icon>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleReportDelete(item)}
                            title="Delete"
                            className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-rose-300/35 hover:text-rose-200"
                          >
                            <Icon className="h-4 w-4">
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </Icon>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="rounded-[26px] border border-white/10 bg-white/8 p-4 shadow-[0_20px_45px_-30px_rgba(15,23,42,0.75)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-sky-200/70">Saved Reports</p>
              <h2 className="mt-1 text-lg font-semibold text-white">Long-term report library</h2>
              <p className="mt-1 text-sm text-slate-300">
                Persistent reports are clustered by report date so the library reads like a timeline, not a dump of matching names.
              </p>
            </div>
            <button
              type="button"
              onClick={fetchSupabaseReports}
              title="Refresh"
              className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-sky-300/35 hover:text-sky-100"
            >
              <Icon className="h-4 w-4">
                <path d="M21 12a9 9 0 0 1-15.5 6.36" />
                <path d="M3 12a9 9 0 0 1 15.5-6.36" />
                <path d="M3 4v4h4" />
                <path d="M21 20v-4h-4" />
              </Icon>
            </button>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Saved Count</p>
            <p className="mt-2 text-2xl font-semibold text-white">{supabaseReports.length}</p>
            <p className="mt-1 text-xs text-slate-400">Reports available across sessions</p>
          </div>
        </div>

        {supabaseReportsLoading ? (
          <div className="rounded-[24px] border border-white/10 bg-white/7 px-4 py-5 text-sm text-slate-300">
            Loading...
          </div>
        ) : supabaseSetupRequired ? (
          <div className="rounded-[24px] border border-amber-300/30 bg-amber-500/10 p-4 text-sm text-amber-100">
            <p className="font-medium text-amber-50">One-time database setup required</p>
            <p className="mt-2 leading-6 text-amber-100/85">
              Run the existing SQL in the Supabase SQL editor, then refresh this pane.
            </p>
            <div className="mt-4 rounded-2xl border border-amber-200/15 bg-slate-950/55 p-3">
              <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[11px] leading-relaxed text-emerald-300">
{`create table if not exists public.saved_reports (
  id           uuid primary key default gen_random_uuid(),
  filename     text not null,
  title        text,
  summary      text,
  content      text not null,
  storage_path text,
  report_kind  text,
  report_date  date,
  created_at   timestamptz not null default now()
);
create index if not exists saved_reports_created_at_idx on public.saved_reports (created_at desc);
create index if not exists saved_reports_report_date_idx on public.saved_reports (report_date desc, created_at desc);`}
              </pre>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `create table if not exists public.saved_reports (\n  id           uuid primary key default gen_random_uuid(),\n  filename     text not null,\n  title        text,\n  summary      text,\n  content      text not null,\n  storage_path text,\n  report_kind  text,\n  report_date  date,\n  created_at   timestamptz not null default now()\n);\ncreate index if not exists saved_reports_created_at_idx on public.saved_reports (created_at desc);\ncreate index if not exists saved_reports_report_date_idx on public.saved_reports (report_date desc, created_at desc);`
                  );
                }}
                className="mt-3 rounded-full border border-amber-200/20 bg-amber-100/10 px-3 py-1.5 text-xs font-medium text-amber-50 transition hover:bg-amber-100/20"
              >
                Copy SQL
              </button>
            </div>
          </div>
        ) : supabaseReports.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-white/12 bg-white/5 px-4 py-8 text-center text-sm text-slate-300">
            No saved reports yet.
          </div>
        ) : (
          savedReportGroups.map((group) => (
            <section key={group.date} className="space-y-3">
              <div className="flex items-center justify-between gap-3 px-1">
                <div>
                  <h3 className="text-sm font-semibold text-white">{group.label}</h3>
                  <p className="text-xs text-slate-400">{group.items.length} saved report{group.items.length === 1 ? '' : 's'}</p>
                </div>
              </div>
              <div className="space-y-3">
                {group.items.map((report) => (
                  <div
                    key={report.id}
                    className="rounded-[24px] border border-white/10 bg-white/7 p-4 shadow-[0_16px_35px_-30px_rgba(15,23,42,0.9)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSupabaseReportClick(report)}
                        className="min-w-0 flex-1 text-left"
                        title={report.filename}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-medium text-white">{buildSavedTitle(report)}</p>
                          {report.report_kind && (
                            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-sky-100">
                              {humanizeSlug(report.report_kind)}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{buildSavedSummary(report)}</p>
                        <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-slate-500">
                          {formatShortDate(report.report_date ?? report.created_at) || 'Saved report'}
                        </p>
                      </button>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleSupabaseReportDownload(report)}
                          title="Download"
                          className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-sky-300/35 hover:text-sky-100"
                        >
                          <Icon className="h-4 w-4">
                            <path d="M12 3v12" />
                            <path d="m7 10 5 5 5-5" />
                            <path d="M4 20h16" />
                          </Icon>
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleSupabaseReportDelete(report)}
                          title="Delete"
                          className="rounded-full border border-white/10 bg-slate-950/45 p-2 text-slate-300 transition hover:border-rose-300/35 hover:text-rose-200"
                        >
                          <Icon className="h-4 w-4">
                            <path d="M18 6 6 18" />
                            <path d="m6 6 12 12" />
                          </Icon>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    );
  };

  return (
    <>
      {(sidebarOpen || reportPreview !== null) && (
        <div
          className="fixed inset-0 z-40 bg-slate-950/65 backdrop-blur-sm"
          onClick={() => {
            if (reportPreview !== null) {
              setReportPreview(null);
              setReportTitle(null);
              setReportUrl(null);
            } else {
              setSidebarOpen(false);
            }
          }}
        />
      )}

      <div data-stock-theme={theme} className="stock-app-shell relative min-h-dvh overflow-hidden text-white">
        <div className="stock-app-grid pointer-events-none absolute inset-0" />
        <div className="stock-app-glow pointer-events-none absolute inset-x-0 top-0 h-80" />

        <header className="stock-header relative z-10 border-b border-white/10 px-4 py-4 backdrop-blur-xl sm:px-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                aria-label="Open workspace"
                onClick={() => setSidebarOpen(true)}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-slate-100 transition hover:bg-white/12 lg:hidden"
              >
                <Icon className="h-5 w-5">
                  <path d="M4 7h16" />
                  <path d="M4 12h16" />
                  <path d="M4 17h16" />
                </Icon>
              </button>
              <div className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-gradient-to-br from-teal-300 via-cyan-300 to-sky-400 text-slate-950 shadow-[0_20px_45px_-22px_rgba(56,189,248,0.9)]">
                <Icon className="h-6 w-6">
                  <path d="M4 17 10 11l4 4 6-8" />
                  <path d="M4 7h4" />
                  <path d="M16 7h4" />
                </Icon>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.34em] text-teal-200/70">Adaptive Research Cockpit</p>
                <h1 className="truncate text-lg font-semibold text-white sm:text-xl">Stock Research</h1>
              </div>
            </div>

            <div className="hidden items-center gap-2 lg:flex">
              <div className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-200">
                {workspaceTabs[0].count} tracked
              </div>
              <div className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-200">
                {workspaceTabs[1].count} session
              </div>
              <div className="rounded-full border border-white/10 bg-white/8 px-3 py-2 text-xs text-slate-200">
                {workspaceTabs[2].count} saved
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="stock-theme-picker hidden sm:flex">
                <span className="sr-only">Theme</span>
                <select
                  value={theme}
                  onChange={(e) => setTheme(e.target.value as ThemeId)}
                  className="stock-theme-select"
                  aria-label="Choose theme"
                >
                  {THEME_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/12 lg:hidden"
              >
                Workspace
              </button>
            </div>
          </div>
        </header>

        <div className="relative z-10 grid min-h-[calc(100dvh-77px)] lg:grid-cols-[88px_minmax(0,1fr)_minmax(320px,24vw)]">
          <aside className="hidden border-r border-white/10 bg-slate-950/35 px-4 py-5 backdrop-blur-xl lg:flex lg:flex-col lg:items-center lg:justify-between">
            <div className="flex flex-col items-center gap-3">
              {workspaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  title={tab.label}
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={railButtonClass(tab.id)}
                >
                  {tab.id === 'watchlist' && (
                    <Icon className="h-5 w-5">
                      <path d="M4 6h16" />
                      <path d="M4 12h10" />
                      <path d="M4 18h16" />
                    </Icon>
                  )}
                  {tab.id === 'artifacts' && (
                    <Icon className="h-5 w-5">
                      <path d="M5 8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
                      <path d="M9 3h6" />
                    </Icon>
                  )}
                  {tab.id === 'saved' && (
                    <Icon className="h-5 w-5">
                      <path d="M7 3h10a2 2 0 0 1 2 2v16l-7-4-7 4V5a2 2 0 0 1 2-2Z" />
                    </Icon>
                  )}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center gap-3">
              <button
                type="button"
                title="Generate daily watchlist report"
                onClick={handleGenerateDailyReport}
                disabled={isLoading || watchlistLoading || !watchlist?.items.length}
                className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/10 bg-white/8 text-slate-100 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon className="h-5 w-5">
                  <path d="M8 2v4" />
                  <path d="M16 2v4" />
                  <rect x="3" y="5" width="18" height="16" rx="2" />
                  <path d="M3 10h18" />
                </Icon>
              </button>
              <div className="writing-vertical-rl rotate-180 text-[10px] uppercase tracking-[0.34em] text-slate-500">
                Workspace
              </div>
            </div>
          </aside>

          <main className="flex min-w-0 flex-col border-white/10 lg:border-r">
            <section className="border-b border-white/10 px-4 py-4 sm:px-6">
              <div className="stock-hero mx-auto max-w-6xl rounded-[30px] border border-white/10 p-5 backdrop-blur-xl sm:p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="max-w-3xl">
                    <p className="text-[11px] uppercase tracking-[0.32em] text-teal-200/70">Live market intelligence</p>
                    <h2 className="mt-2 text-2xl font-semibold text-white sm:text-3xl">
                      A sharper workspace for research, watchlists, and report archives.
                    </h2>
                    <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-[15px]">
                      The chat stays central, while watchlist and reports move into a dedicated adaptive workspace that is easier to scan on laptop and easier to reach on mobile.
                    </p>

                    <div className="mt-5 flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
                      {QUICK_PROMPTS.map(({ label, prompt, eyebrow }) => (
                        <button
                          key={label}
                          type="button"
                          onClick={() => void sendPrompt(prompt)}
                          className="min-w-[220px] rounded-[24px] border border-white/10 bg-white/7 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white/11 lg:min-w-0"
                        >
                          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">{eyebrow}</p>
                          <p className="mt-2 text-sm font-medium text-white">{label}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 xl:w-[430px]">
                    <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Visual theme</p>
                          <p className="mt-1 text-xs leading-5 text-slate-300">{THEME_OPTIONS.find((option) => option.id === theme)?.blurb}</p>
                        </div>
                        <label className="stock-theme-picker flex sm:hidden">
                          <span className="sr-only">Theme</span>
                          <select
                            value={theme}
                            onChange={(e) => setTheme(e.target.value as ThemeId)}
                            className="stock-theme-select"
                            aria-label="Choose theme"
                          >
                            {THEME_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                    <div className="rounded-[24px] border border-white/10 bg-slate-950/40 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Automatic routing</p>
                      <p className="mt-1 text-xs leading-5 text-slate-300">
                        Ask naturally. The app automatically fans out across the available AI model ladder and provider fallbacks without requiring any model choice from you.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              <div className="mx-auto flex max-w-5xl flex-col gap-4">
                {messages.length === 0 && (
                  <div className="rounded-[32px] border border-white/10 bg-white/6 p-6 shadow-[0_28px_80px_-38px_rgba(45,212,191,0.5)] backdrop-blur-xl sm:p-8">
                    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:items-end">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.34em] text-slate-400">Start here</p>
                        <h3 className="mt-3 text-3xl font-semibold text-white">Run a new research session</h3>
                        <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">
                          Ask for a company report, compare peers, run deep research on a sector, or produce a combined daily report for the saved watchlist.
                        </p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                        <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Deep dives</p>
                          <p className="mt-2 text-sm text-white">Single-stock and comparison reports with charts and scorecards.</p>
                        </div>
                        <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Watchlist pulse</p>
                          <p className="mt-2 text-sm text-white">One button to turn the whole watchlist into a daily brief.</p>
                        </div>
                        <div className="rounded-[24px] border border-white/10 bg-slate-950/35 p-4">
                          <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Library</p>
                          <p className="mt-2 text-sm text-white">Reports are grouped by date and surfaced as cards with summaries.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={[
                        'max-w-[92%] rounded-[28px] px-5 py-4 shadow-[0_24px_50px_-30px_rgba(15,23,42,0.85)] sm:max-w-[82%]',
                        msg.role === 'user'
                          ? 'rounded-br-md bg-[linear-gradient(135deg,#5eead4,#22d3ee_45%,#38bdf8)] text-slate-950'
                          : 'rounded-bl-md border border-white/10 bg-white/8 text-slate-100 backdrop-blur-xl',
                      ].join(' ')}
                    >
                      {msg.role === 'assistant' && (
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium text-slate-400">Assistant</span>
                          {msg.stats && (
                            <span className="text-[10px] text-slate-400">
                              {msg.stats.rounds} rounds • {msg.stats.toolCalls} calls
                            </span>
                          )}
                        </div>
                      )}
                      {msg.role === 'assistant' ? (
                        <MarkdownContent content={msg.content} />
                      ) : (
                        <p className="whitespace-pre-wrap text-sm font-medium">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}

                {isLoading && (
                  <div className="flex justify-start">
                    <div className="rounded-[28px] rounded-bl-md border border-white/10 bg-white/8 px-5 py-4 shadow-[0_24px_50px_-30px_rgba(15,23,42,0.85)] backdrop-blur-xl">
                      <div className="flex items-center gap-1.5 text-sm text-slate-300">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse [animation-delay:150ms]">●</span>
                        <span className="animate-pulse [animation-delay:300ms]">●</span>
                        <span className="ml-2 text-xs text-slate-400">Researching...</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="border-t border-white/10 px-4 py-4 sm:px-6">
              <div className="mx-auto max-w-5xl">
                {error && (
                  <p className="mb-3 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {error}
                  </p>
                )}
                <form
                  onSubmit={handleSubmit}
                  className="stock-input-shell rounded-[30px] border border-white/10 p-3 backdrop-blur-xl"
                >
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask naturally — 'Report on Apple', 'Compare Tesla vs Rivian', 'Best AI stocks', 'Watchlist daily report'…"
                    disabled={isLoading}
                    className="min-h-[54px] max-h-40 w-full resize-none bg-transparent px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
                  />
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 px-2 pt-3">
                    <p className="text-xs text-slate-400">Enter sends. Shift+Enter adds a newline.</p>
                    <button
                      type="submit"
                      disabled={isLoading || !input.trim()}
                      className="rounded-full bg-gradient-to-r from-teal-300 via-cyan-300 to-sky-300 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isLoading ? '...' : 'Send'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </main>

          <aside className="hidden min-h-0 flex-col border-l border-white/10 bg-slate-950/35 p-4 backdrop-blur-xl lg:flex">
            <div className="grid grid-cols-3 gap-2">
              {workspaceTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveWorkspaceTab(tab.id)}
                  className={panelTabClass(tab.id)}
                >
                  <span className={`block text-[11px] uppercase tracking-[0.18em] ${activeWorkspaceTab === tab.id ? 'text-slate-500' : 'text-slate-400'}`}>
                    {tab.count}
                  </span>
                  <span className="mt-1 block text-sm font-medium">{tab.label}</span>
                </button>
              ))}
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {renderWorkspacePane()}
            </div>
          </aside>
        </div>
      </div>

      <div
        className={[
          'stock-bottom-sheet fixed inset-x-0 bottom-0 z-50 rounded-t-[32px] border border-white/10 p-4 backdrop-blur-2xl transition-transform duration-300 lg:hidden',
          sidebarOpen ? 'translate-y-0' : 'translate-y-[105%]',
        ].join(' ')}
      >
        <div className="mx-auto max-h-[78vh] max-w-2xl overflow-hidden">
          <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-white/20" />
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-teal-200/70">Workspace</p>
              <h2 className="text-lg font-semibold text-white">Watchlist and report navigation</h2>
            </div>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="rounded-full border border-white/10 bg-white/8 p-2 text-slate-200"
              aria-label="Close workspace"
            >
              <Icon className="h-5 w-5">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </Icon>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {workspaceTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveWorkspaceTab(tab.id)}
                className={panelTabClass(tab.id)}
              >
                <span className={`block text-[11px] uppercase tracking-[0.18em] ${activeWorkspaceTab === tab.id ? 'text-slate-500' : 'text-slate-400'}`}>
                  {tab.count}
                </span>
                <span className="mt-1 block text-sm font-medium">{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 max-h-[calc(78vh-140px)] overflow-y-auto pr-1">
            {renderWorkspacePane(true)}
          </div>
        </div>
      </div>

      {reportPreview !== null && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="stock-modal-shell relative mt-4 flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-white/12 backdrop-blur-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.28em] text-teal-200/70">Report Preview</p>
                <h3 className="truncate text-base font-semibold text-white">{reportTitle ?? 'Report'}</h3>
              </div>
              <div className="ml-3 flex shrink-0 items-center gap-2">
                {reportUrl && (
                  <a
                    href={reportUrl}
                    download
                    className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/12"
                  >
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setReportPreview(null);
                    setReportTitle(null);
                    setReportUrl(null);
                  }}
                  className="rounded-full bg-gradient-to-r from-teal-300 via-cyan-300 to-sky-300 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-5">
              {reportLoading ? (
                <p className="text-sm text-slate-300">Loading report...</p>
              ) : (
                <div className="stock-report-paper rounded-[24px] p-4">
                  <MarkdownContent content={reportPreview} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

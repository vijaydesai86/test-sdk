'use client';

import { useState, useRef, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import * as echarts from 'echarts';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
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
}

interface SavedReportMeta {
  id: string;
  filename: string;
  title: string | null;
  created_at: string;
}

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier?: string;
}

interface ProviderOption {
  id: string;
  label: string;
  available: boolean;
  details?: string;
  models: ModelOption[];
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
        fontFamily: 'Inter, system-ui, -apple-system, Segoe UI, sans-serif',
        primaryColor: '#6366f1',
        primaryTextColor: '#0f172a',
        lineColor: '#4f46e5',
        tertiaryColor: '#eef2ff',
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
    return () => { cancelled = true; };
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

const DEFAULT_MODEL = 'openai/gpt-4.1';
const CHART_HEIGHT = 280;
const MAX_TEXTAREA_HEIGHT = 160;
const TOOL_CALL_WARNING =
  'Model returned tool calls as plain text. Switch to a tool-calling model from the dropdown.';
const isToolCallText = (content: string) =>
  /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
const SAMPLE_REPORT_LINK = '/reports/nvda-sample.md';

const QUICK_PROMPTS = [
  { label: '📊 NVDA stock report', prompt: 'Generate a full stock report for NVDA' },
  { label: '⚖️ Compare NVDA, AMD, INTC', prompt: 'Compare companies NVDA, AMD, INTC' },
  { label: '🏭 AI data center top 5', prompt: 'Give me a sector report for AI data center top 5 companies' },
  { label: '🔬 Deep semiconductor research', prompt: 'Give me a deep sector research report for semiconductors' },
];

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
                return <code className={className} {...props}>{children}</code>;
              }
            }
            return <code className={className} {...props}>{children}</code>;
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
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [provider, setProvider] = useState<ProviderOption['id']>('github');
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([
    { value: DEFAULT_MODEL, label: 'GPT-4.1', rateLimitTier: 'high' },
  ]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [deletedReports, setDeletedReports] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [supabaseReports, setSupabaseReports] = useState<SavedReportMeta[]>([]);
  const [supabaseReportsLoading, setSupabaseReportsLoading] = useState(false);
  const [supabaseSetupRequired, setSupabaseSetupRequired] = useState(false);

  useEffect(() => {
    fetch('/api/providers')
      .then((res) => res.json())
      .then((payload: { providers?: ProviderOption[] }) => {
        if (!payload.providers?.length) return;
        setAvailableProviders(payload.providers);
        const defaultProvider = payload.providers.find((p) => p.available) ?? payload.providers[0];
        setProvider(defaultProvider.id);
        const nextModels = defaultProvider.models ?? [];
        setAvailableModels(nextModels);
        if (nextModels.length > 0 && !nextModels.find((m) => m.value === model)) {
          setModel(nextModels[0].value);
        }
      })
      .catch(() => { /* keep fallback model */ })
      .finally(() => setModelsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchSupabaseReports = () => {
    setSupabaseReportsLoading(true);
    fetch('/api/saved-reports')
      .then((res) => res.json())
      .then((payload: { reports?: SavedReportMeta[]; setupRequired?: boolean }) => {
        setSupabaseReports(payload.reports ?? []);
        setSupabaseSetupRequired(payload.setupRequired === true);
      })
      .catch(() => { /* Supabase may not be configured */ })
      .finally(() => setSupabaseReportsLoading(false));
  };

  useEffect(() => {
    fetchSupabaseReports();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;

    const userMessage = prompt.trim();
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId, model, provider }),
      });

      const rawText = await res.text();
      let data: Record<string, unknown>;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        throw new Error(rawText || 'Failed to parse server response');
      }

      if (!res.ok) {
        const errMsg = typeof data['details'] === 'string'
          ? `${String(data['error'] ?? 'Error')} \u2014 ${data['details']}`
          : String(data['error'] ?? 'Failed to get response');
        throw new Error(errMsg);
      }

      const responseText = typeof data['response'] === 'string' ? data['response'] : '';
      const assistantText = isToolCallText(responseText) ? TOOL_CALL_WARNING : responseText;
      if (isToolCallText(responseText)) setError(TOOL_CALL_WARNING);

      setSessionId(typeof data['sessionId'] === 'string' ? data['sessionId'] : null);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: assistantText,
          model: typeof data['model'] === 'string' ? data['model'] : undefined,
          stats: data['stats'] as Message['stats'],
        },
      ]);

      const report = data['report'] as { filename?: string; content?: string; downloadUrl?: string } | null;
      const reports = data['reports'] as { filename?: string; content?: string; downloadUrl?: string }[] | null;
      const allReports = reports?.length
        ? reports
        : report?.filename && report?.content ? [report] : [];
      if (allReports.length > 0) {
        setSavedReports((prev) => {
          let updated = prev;
          for (const r of allReports) {
            if (r.filename && r.content && !updated.find((s) => s.filename === r.filename)) {
              updated = [...updated, { filename: r.filename, content: r.content, downloadUrl: r.downloadUrl }];
            }
          }
          return updated;
        });
        // Refresh Supabase saved reports list
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
        .flatMap((m) => m.content.match(/\/api\/reports\/[a-z0-9-]+\.md/gi) ?? [])
    )
  ).filter((link) => !deletedReports.has(link));

  const reportItems: ReportItem[] = [
    ...savedReports,
    ...reportLinks
      .map((link) => ({ filename: link.split('/').pop() ?? link, downloadUrl: link }))
      .filter((r) => !savedReports.find((s) => s.filename === r.filename)),
  ];

  const handleReportClick = async (item: ReportItem) => {
    setReportLoading(true);
    setReportUrl(item.downloadUrl ?? null);
    try {
      if (item.content) {
        setReportPreview(item.content);
        setReportTitle(item.filename);
        return;
      }
      if (!item.downloadUrl) {
        setReportPreview('Unable to load report preview.');
        setReportTitle(item.filename ?? 'Report');
        return;
      }
      const res = await fetch(item.downloadUrl);
      const content = await res.text();
      setReportPreview(content);
      setReportTitle(item.filename ?? 'Report');
    } catch {
      setReportPreview('Unable to load report preview.');
      setReportTitle(item.filename ?? 'Report');
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
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) throw new Error(String(data['error'] ?? 'Failed to delete report'));
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
    setReportLoading(true);
    const downloadUrl = `/api/saved-reports/${report.id}`;
    setReportUrl(downloadUrl);
    try {
      const res = await fetch(downloadUrl);
      const content = await res.text();
      setReportPreview(content);
      setReportTitle(report.filename);
    } catch {
      setReportPreview('Unable to load report preview.');
      setReportTitle(report.filename);
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
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) throw new Error(String(data['error'] ?? 'Failed to delete report'));
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

  return (
    <>
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex flex-col h-screen bg-slate-50 dark:bg-gray-950">
        <header className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-white dark:bg-gray-900 border-b border-slate-200 dark:border-gray-800 shadow-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              aria-label="Open sidebar"
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-700 dark:text-gray-400 dark:hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span className="text-base sm:text-lg font-semibold text-slate-900 dark:text-white truncate">
              📈 Stock Research
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {availableProviders.length > 1 && (
              <select
                value={provider}
                onChange={(e) => {
                  const next = e.target.value;
                  setProvider(next);
                  setSessionId(null);
                  const sel = availableProviders.find((p) => p.id === next);
                  const models = sel?.models ?? [];
                  setAvailableModels(models);
                  if (models.length > 0) setModel(models[0].value);
                }}
                disabled={modelsLoading}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 hidden sm:block"
              >
                {availableProviders.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.label}{p.available ? '' : ' (unavailable)'}
                  </option>
                ))}
              </select>
            )}
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); setSessionId(null); }}
              disabled={modelsLoading}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-slate-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-w-[130px] sm:max-w-none"
            >
              {modelsLoading
                ? <option>Loading&#8230;</option>
                : availableModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
            </select>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <aside
            className={[
              'shrink-0 w-72 bg-white dark:bg-gray-900 border-r border-slate-200 dark:border-gray-800 flex flex-col gap-5 p-4 overflow-y-auto',
              'fixed inset-y-0 left-0 z-40 transition-transform duration-200 lg:static lg:translate-x-0',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            ].join(' ')}
          >
            <div className="flex items-center justify-between lg:hidden">
              <span className="font-semibold text-slate-700 dark:text-white text-sm">Sidebar</span>
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                aria-label="Close sidebar"
              >
                &#x2715;
              </button>
            </div>

            <section>
              <h2 className="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                Quick Research
              </h2>
              <div className="flex flex-col gap-1.5">
                {QUICK_PROMPTS.map(({ label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => { setSidebarOpen(false); void sendPrompt(prompt); }}
                    className="text-left text-sm px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </section>

            <section className="flex-1">
              <h2 className="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                Artifacts
              </h2>
              {reportItems.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-400 dark:text-gray-500">
                    No reports yet. Ask for a stock or comparison report.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleReportClick({ filename: 'nvda-sample.md', downloadUrl: SAMPLE_REPORT_LINK })}
                    className="text-xs w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors truncate"
                  >
                    View sample NVDA report
                  </button>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {reportItems.map((item) => (
                    <li
                      key={item.filename}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-gray-700 px-2 py-1.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => handleReportClick(item)}
                        className="flex-1 text-left truncate text-indigo-600 dark:text-indigo-300 hover:underline"
                      >
                        {item.filename}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReportDownload(item)}
                        title="Download"
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 shrink-0 px-1"
                      >
                        &#x2193;
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReportDelete(item)}
                        title="Delete"
                        className="text-slate-300 hover:text-red-500 shrink-0 px-1"
                      >
                        &#x2715;
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest">
                  Saved Reports
                </h2>
                <button
                  type="button"
                  onClick={fetchSupabaseReports}
                  title="Refresh"
                  className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 text-xs px-1"
                >
                  &#x21bb;
                </button>
              </div>
              {supabaseReportsLoading ? (
                <p className="text-xs text-slate-400 dark:text-gray-500">Loading&#8230;</p>
              ) : supabaseSetupRequired ? (
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-snug">
                  Database table not set up.{' '}
                  <a
                    href="https://supabase.com/dashboard/project/bnhnlyiuwlebgmjerueb/sql/new"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-amber-700 dark:hover:text-amber-300"
                  >
                    Run the setup SQL
                  </a>{' '}
                  then click &#x21bb;
                </p>
              ) : supabaseReports.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-gray-500">
                  No saved reports yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {supabaseReports.map((report) => (
                    <li
                      key={report.id}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-gray-700 px-2 py-1.5 text-xs"
                    >
                      <button
                        type="button"
                        onClick={() => void handleSupabaseReportClick(report)}
                        className="flex-1 text-left truncate text-indigo-600 dark:text-indigo-300 hover:underline"
                        title={report.filename}
                      >
                        {report.title || report.filename}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSupabaseReportDownload(report)}
                        title="Download"
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-300 shrink-0 px-1"
                      >
                        &#x2193;
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleSupabaseReportDelete(report)}
                        title="Delete"
                        className="text-slate-300 hover:text-red-500 shrink-0 px-1"
                      >
                        &#x2715;
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-xs font-semibold text-slate-400 dark:text-gray-500 uppercase tracking-widest mb-2">
                What&apos;s Supported
              </h2>
              <ul className="text-xs text-slate-500 dark:text-gray-400 space-y-1">
                <li>&#x2022; Individual stock deep-dive reports</li>
                <li>&#x2022; Side-by-side comparison reports</li>
                <li>&#x2022; Sector / thematic analysis (top N companies)</li>
                <li>&#x2022; Price, EPS, revenue &amp; margin charts</li>
                <li>&#x2022; Analyst targets &amp; scorecard</li>
              </ul>
            </section>
          </aside>

          <main className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-16">
                  <div className="text-5xl">&#x1F4D1;</div>
                  <div>
                    <h2 className="text-xl font-semibold text-slate-700 dark:text-white mb-1">
                      Start a research session
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-gray-400 max-w-xs mx-auto">
                      Ask for a stock report (e.g. <em>NVDA report</em>), compare companies (e.g. <em>compare NVDA AMD INTC</em>), or get a sector analysis (e.g. <em>top 5 AI data center companies</em>).
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {QUICK_PROMPTS.map(({ label, prompt }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => void sendPrompt(prompt)}
                        className="text-sm px-4 py-2 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={[
                      'max-w-[90%] sm:max-w-[80%] rounded-2xl px-4 py-3 shadow-sm',
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-white dark:bg-gray-800 text-slate-800 dark:text-slate-100 border border-slate-100 dark:border-gray-700 rounded-bl-sm',
                    ].join(' ')}
                  >
                    {msg.role === 'assistant' && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-medium text-slate-400 dark:text-gray-500">Assistant</span>
                        {msg.model && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 font-mono">
                            {msg.model.split('/').pop()}
                          </span>
                        )}
                        {msg.stats && (
                          <span className="text-[10px] text-slate-300 dark:text-gray-600">
                            {msg.stats.rounds} rounds &#xB7; {msg.stats.toolCalls} calls
                          </span>
                        )}
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <MarkdownContent content={msg.content} />
                    ) : (
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-gray-800 border border-slate-100 dark:border-gray-700 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-400 dark:text-gray-500 text-sm">
                      <span className="animate-pulse">&#x25CF;</span>
                      <span className="animate-pulse [animation-delay:150ms]">&#x25CF;</span>
                      <span className="animate-pulse [animation-delay:300ms]">&#x25CF;</span>
                      <span className="ml-1 text-xs">{model.split('/').pop()} thinking&#8230;</span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="shrink-0 border-t border-slate-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-3 sm:px-6 py-3">
              {error && (
                <p className="text-xs text-red-500 dark:text-red-400 mb-2 px-1">&#x26A0;&#xFE0F; {error}</p>
              )}
              <form onSubmit={handleSubmit} className="flex items-end gap-2">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask for a stock report or compare companies&#8230; (Enter to send, Shift+Enter for newline)"
                  disabled={isLoading}
                  className="flex-1 resize-none px-4 py-2.5 rounded-xl border border-slate-200 dark:border-gray-700 bg-slate-50 dark:bg-gray-800 text-slate-900 dark:text-white text-sm placeholder-slate-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60 min-h-[44px] max-h-40"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="shrink-0 h-11 px-5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:bg-slate-200 dark:disabled:bg-gray-700 disabled:text-slate-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed transition-colors"
                >
                  {isLoading ? '&#8230;' : 'Send'}
                </button>
              </form>
            </div>
          </main>
        </div>
      </div>

      {reportPreview !== null && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 sm:p-8 overflow-y-auto">
          <div className="relative w-full max-w-5xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col max-h-[90vh] mt-4 mb-4">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-gray-700 shrink-0">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                  {reportTitle ?? 'Report'}
                </h3>
                <p className="text-xs text-slate-400 dark:text-gray-500">Research report preview</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                {reportUrl && (
                  <a
                    href={reportUrl}
                    download
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-gray-700 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
                  >
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => { setReportPreview(null); setReportTitle(null); setReportUrl(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-5 py-4 flex-1">
              {reportLoading ? (
                <p className="text-sm text-slate-400 dark:text-gray-500">Loading report&#8230;</p>
              ) : (
                <MarkdownContent content={reportPreview} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

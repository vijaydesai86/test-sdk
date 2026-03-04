'use client';

import { useState, useRef, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import mermaid from 'mermaid';
import * as echarts from 'echarts';

/** Max px height the textarea grows to before it scrolls (8 lines ≈ 128px). */
const MAX_TEXTAREA_HEIGHT_PX = 128;

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  stats?: { rounds: number; toolCalls: number; toolsProvided: number };
}

interface ReportItem {
  filename: string;
  content?: string;
  downloadUrl?: string;
}

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier?: string;
}

interface ProviderOption {
  id: 'github';
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
        fontFamily: 'Inter, system-ui, sans-serif',
        primaryColor: '#6366f1',
        primaryTextColor: '#0f172a',
        lineColor: '#4f46e5',
        tertiaryColor: '#eef2ff',
      },
    });
    mermaid.render(`mermaid-${chartId}`, chart)
      .then(({ svg }) => { if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg; })
      .catch(() => { if (!cancelled && containerRef.current) containerRef.current.textContent = 'Chart rendering failed.'; });
    return () => { cancelled = true; };
  }, [chart, chartId]);
  return <div ref={containerRef} className="my-3 overflow-x-auto" />;
}

function ChartBlock({ option }: { option: Record<string, any> }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!containerRef.current) return;
    const instance = echarts.init(containerRef.current, undefined, { renderer: 'canvas' });
    instance.setOption(option, { notMerge: true });
    const handleResize = () => instance.resize();
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); instance.dispose(); };
  }, [option]);
  return (
    <div
      ref={containerRef}
      className="my-3 w-full rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
      style={{ height: 'clamp(220px, 40vw, 300px)' }}
    />
  );
}

const DEFAULT_MODEL = 'openai/gpt-4.1';
const TOOL_CALL_WARNING = 'Model returned tool calls as plain text. Switch to a tool-calling model from the dropdown.';
const isToolCallText = (content: string) =>
  /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
const SAMPLE_REPORT_LINK = '/reports/sample-report.md';

const QUICK_ACTIONS = [
  { label: '📈 Stock Report', prompt: 'Generate a full stock report for ' },
  { label: '⚖️ Compare Stocks', prompt: 'Compare ' },
];

function ReportRenderer({ content }: { content: string }) {
  return (
    <div className="prose dark:prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            if (match?.[1] === 'mermaid') return <MermaidBlock chart={String(children).trim()} />;
            if (match?.[1] === 'chart' || match?.[1] === 'echarts') {
              try { return <ChartBlock option={JSON.parse(String(children))} />; }
              catch { return <code className={className} {...props}>{children}</code>; }
            }
            return <code className={className} {...props}>{children}</code>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto -mx-1 my-3">
                <table className="min-w-full">{children}</table>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function formatFilename(filename: string) {
  return filename
    .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+\.md$/, '')
    .replace(/-report$/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [deletedReports, setDeletedReports] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);
  // mobile: sidebar drawer open/closed
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch('/api/providers')
      .then((r) => r.json())
      .then((payload: { providers?: ProviderOption[] }) => {
        if (!payload.providers?.length) return;
        setAvailableProviders(payload.providers);
        const def = payload.providers.find((p) => p.available) || payload.providers[0];
        setProvider(def.id);
        const mods = def.models || [];
        setAvailableModels(mods);
        if (mods.length && !mods.find((m) => m.value === model)) setModel(mods[0].value);
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // close sidebar on backdrop click / ESC
  useEffect(() => {
    if (!sidebarOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSidebarOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [sidebarOpen]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;
    const userMessage = prompt.trim();
    setInput('');
    setError(null);
    setSidebarOpen(false);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);
    // auto-resize textarea back
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId, model, provider }),
      });
      const rawText = await res.text();
      let data: any;
      try { data = rawText ? JSON.parse(rawText) : {}; }
      catch { throw new Error(rawText || 'Failed to parse server response'); }
      if (!res.ok) {
        throw new Error(data.details ? `${data.error || 'Error'} — ${data.details}` : data.error || 'Failed to get response');
      }
      const responseText = typeof data.response === 'string' ? data.response : '';
      const assistantText = isToolCallText(responseText) ? TOOL_CALL_WARNING : responseText;
      if (isToolCallText(responseText)) setError(TOOL_CALL_WARNING);
      setSessionId(data.sessionId);
      setMessages((prev) => [...prev, { role: 'assistant', content: assistantText, model: data.model, stats: data.stats }]);
      if (data.report?.filename && data.report?.content) {
        setSavedReports((prev) => {
          if (prev.find((i) => i.filename === data.report.filename)) return prev;
          return [...prev, { filename: data.report.filename, content: data.report.content, downloadUrl: data.report.downloadUrl }];
        });
        // Auto-open the report in the preview modal
        setReportPreview(data.report.content);
        setReportTitle(data.report.filename);
        setReportUrl(data.report.downloadUrl || null);
      }
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); sendPrompt(input); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendPrompt(input); }
  };

  const reportLinks = Array.from(new Set(
    messages.filter((m) => m.role === 'assistant')
      .flatMap((m) => m.content.match(/\/api\/reports\/[a-z0-9-]+\.md/gi) || [])
  )).filter((l) => !deletedReports.has(l));

  const reportItems: ReportItem[] = [
    ...savedReports,
    ...reportLinks
      .map((l) => ({ filename: l.split('/').pop() || l, downloadUrl: l }))
      .filter((i) => !savedReports.find((s) => s.filename === i.filename)),
  ];

  const handleReportClick = async (item: ReportItem) => {
    setReportLoading(true);
    setReportUrl(item.downloadUrl || null);
    try {
      if (item.content) { setReportPreview(item.content); setReportTitle(item.filename); return; }
      if (!item.downloadUrl) { setReportPreview('Unable to load report preview.'); setReportTitle(item.filename || 'Report'); return; }
      const content = await fetch(item.downloadUrl).then((r) => r.text());
      setReportPreview(content);
      setReportTitle(item.filename || 'Report');
    } catch { setReportPreview('Unable to load report preview.'); setReportTitle(item.filename || 'Report'); }
    finally { setReportLoading(false); }
  };

  const handleReportDownload = (item: ReportItem) => {
    if (!item.content) { if (item.downloadUrl) window.open(item.downloadUrl, '_blank'); return; }
    const blob = new Blob([item.content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = item.filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  const handleReportDelete = async (item: ReportItem) => {
    setError(null);
    try {
      if (item.downloadUrl) {
        const res = await fetch(item.downloadUrl, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete report');
      }
      setDeletedReports((prev) => new Set(prev).add(item.downloadUrl || item.filename));
      setSavedReports((prev) => prev.filter((s) => s.filename !== item.filename));
      if (reportUrl === item.downloadUrl) { setReportUrl(null); setReportPreview(null); setReportTitle(null); }
    } catch (err: any) { setError(err.message || 'Failed to delete report'); }
  };

  /* ─── Sidebar panel (shared between drawer and desktop) ─── */
  const SidebarContent = () => (
    <>
      {/* Quick actions */}
      <div className="p-4 border-b border-slate-100 dark:border-slate-800">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2.5">
          Quick Research
        </p>
        <div className="space-y-1">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => {
                setInput(a.prompt);
                setSidebarOpen(false);
                setTimeout(() => {
                  if (inputRef.current) {
                    inputRef.current.focus();
                    inputRef.current.setSelectionRange(a.prompt.length, a.prompt.length);
                  }
                }, 0);
              }}
              disabled={isLoading}
              className="w-full text-left text-xs px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors disabled:opacity-40"
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Artifacts */}
      <div className="p-4 flex-1 overflow-y-auto">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2.5">
          Report Artifacts
        </p>
        {reportItems.length === 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Generated reports appear here. Ask for any stock or comparison report to create one.
            </p>
            <button
              type="button"
              onClick={() => handleReportClick({ filename: 'sample-report.md', downloadUrl: SAMPLE_REPORT_LINK })}
              className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
            >
              📋 View sample report
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            {reportItems.map((item) => (
              <div
                key={item.filename}
                className="group flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-2 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => handleReportClick(item)}
                  className="flex-1 min-w-0 text-left text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                  title={item.filename}
                >
                  📄 {formatFilename(item.filename)}
                </button>
                <div className="flex gap-1 flex-none opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleReportDownload(item)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                    title="Download"
                  >↓</button>
                  <button
                    onClick={() => handleReportDelete(item)}
                    className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                    title="Delete"
                  >×</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Coverage note */}
      <div className="p-4 border-t border-slate-100 dark:border-slate-800">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
          Coverage
        </p>
        <ul className="text-xs text-slate-400 dark:text-slate-500 space-y-1">
          <li>• Any US stock by name or ticker</li>
          <li>• Up to 10 companies comparison</li>
          <li>• Price, earnings, financials &amp; more</li>
        </ul>
      </div>
    </>
  );

  return (
    <>
      {/* ═══ MAIN LAYOUT ═══ */}
      <div className="flex flex-col h-[100dvh] bg-slate-50 dark:bg-slate-950 overflow-hidden">

        {/* ── Header ── */}
        <header className="flex-none flex items-center gap-2 px-3 sm:px-5 py-2.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm z-10">
          {/* Mobile: sidebar toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex-none p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          {/* Logo */}
          <div className="flex items-center gap-2 flex-none">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white text-sm">📊</div>
            <span className="font-semibold text-slate-900 dark:text-white text-sm sm:text-base tracking-tight leading-none">
              Equity Research
            </span>
            <span className="hidden md:inline text-xs text-slate-400 dark:text-slate-500 mt-px">AI-powered</span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Controls */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            {availableProviders.length > 1 && (
              <select
                value={provider}
                onChange={(e) => {
                  const next = e.target.value as ProviderOption['id'];
                  setProvider(next); setSessionId(null);
                  const sel = availableProviders.find((p) => p.id === next);
                  const mods = sel?.models || [];
                  setAvailableModels(mods);
                  if (mods.length) setModel(mods.find((m) => m.value === model) ? model : mods[0].value);
                }}
                disabled={modelsLoading}
                className="hidden sm:block text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                {availableProviders.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>{p.label}{p.available ? '' : ' (no key)'}</option>
                ))}
              </select>
            )}
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); setSessionId(null); }}
              disabled={modelsLoading}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-w-[110px] sm:max-w-[160px]"
            >
              {modelsLoading ? <option>Loading…</option> : availableModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            {sessionId && (
              <button
                type="button"
                onClick={() => { setMessages([]); setSessionId(null); setError(null); setSavedReports([]); setDeletedReports(new Set()); }}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                New
              </button>
            )}
          </div>
        </header>

        {/* ── Body ── */}
        <div className="flex-1 flex overflow-hidden min-h-0">

          {/* ── Desktop sidebar ── */}
          <aside className="hidden lg:flex flex-col w-64 xl:w-72 flex-none bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
            <SidebarContent />
          </aside>

          {/* ── Mobile sidebar drawer ── */}
          {sidebarOpen && (
            <>
              {/* backdrop */}
              <div
                className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm lg:hidden"
                onClick={() => setSidebarOpen(false)}
              />
              {/* drawer panel */}
              <aside className="fixed inset-y-0 left-0 z-50 flex flex-col w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto lg:hidden shadow-2xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                  <span className="font-semibold text-sm text-slate-800 dark:text-white">Menu</span>
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <SidebarContent />
              </aside>
            </>
          )}

          {/* ── Chat area ── */}
          <main className="flex-1 flex flex-col overflow-hidden min-w-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 sm:py-6 space-y-4 sm:space-y-6">
              {messages.length === 0 ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center h-full min-h-[260px] text-center px-4">
                  <div className="text-4xl sm:text-5xl mb-3">📊</div>
                  <h2 className="text-lg sm:text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    Equity Research Console
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-5 leading-relaxed">
                    Ask about any stock by name or ticker. Compare up to 10 companies — company names are resolved to tickers automatically.
                  </p>
                  <div className="grid grid-cols-2 gap-2 w-full max-w-sm">
                    {QUICK_ACTIONS.map((a) => (
                      <button
                        key={a.label}
                        onClick={() => {
                          setInput(a.prompt);
                          setTimeout(() => {
                            if (inputRef.current) {
                              inputRef.current.focus();
                              inputRef.current.setSelectionRange(a.prompt.length, a.prompt.length);
                            }
                          }, 0);
                        }}
                        disabled={isLoading}
                        className="text-xs px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all shadow-sm active:scale-95 touch-manipulation"
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} items-start gap-2 sm:gap-3`}>
                      {msg.role === 'assistant' && (
                        <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">
                          📊
                        </div>
                      )}
                      <div
                        className={`min-w-0 max-w-[88%] sm:max-w-[80%] ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5 sm:px-4 sm:py-3'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-sm'
                        }`}
                      >
                        {msg.role === 'assistant' && (
                          <div className="flex flex-wrap items-center gap-1.5 mb-2">
                            {msg.model && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-mono">
                                {msg.model.split('/').pop()}
                              </span>
                            )}
                            {msg.stats && msg.stats.toolCalls > 0 && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                {msg.stats.toolCalls} tool call{msg.stats.toolCalls !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                        {msg.role === 'assistant'
                          ? <ReportRenderer content={msg.content} />
                          : <div className="text-sm whitespace-pre-wrap break-words">{msg.content}</div>
                        }
                      </div>
                    </div>
                  ))}

                  {/* Loading indicator */}
                  {isLoading && (
                    <div className="flex justify-start items-start gap-2 sm:gap-3">
                      <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mt-0.5 shrink-0">
                        📊
                      </div>
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                          </div>
                          <span className="text-xs text-slate-400 dark:text-slate-500">Researching…</span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* ── Input bar ── */}
            <div className="flex-none border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 sm:px-5 py-2.5 sm:py-3">
              {error && (
                <div className="mb-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
                  ⚠️ {error}
                </div>
              )}
              <form onSubmit={handleSubmit} className="flex gap-2 items-end">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
                  }}
                  placeholder="Ask about any stock by name or ticker, or compare companies…"
                  rows={1}
                  disabled={isLoading}
                  className="flex-1 resize-none text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 max-h-32 overflow-y-auto"
                  style={{ minHeight: '42px' }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="flex-none px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium touch-manipulation"
                >
                  {isLoading ? (
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                    </svg>
                  )}
                </button>
              </form>
              <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-600 hidden sm:block">
                Enter to send · Shift+Enter for new line · Company names resolved to tickers automatically
              </p>
            </div>
          </main>
        </div>
      </div>

      {/* ═══ REPORT PREVIEW MODAL ═══ */}
      {reportPreview !== null && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) { setReportPreview(null); setReportTitle(null); setReportUrl(null); }
          }}
        >
          <div className="bg-white dark:bg-slate-900 w-full sm:rounded-2xl shadow-2xl sm:max-w-5xl max-h-[96dvh] sm:max-h-[92vh] flex flex-col overflow-hidden border-0 sm:border border-slate-200 dark:border-slate-700 rounded-t-2xl">
            {/* Modal header */}
            <div className="flex items-center gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60">
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-slate-900 dark:text-white text-sm sm:text-base truncate">
                  {reportTitle ? formatFilename(reportTitle) : 'Research Report'}
                </h3>
                {reportTitle && (
                  <p className="text-[10px] text-slate-400 mt-0.5 truncate hidden sm:block">{reportTitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-none">
                {reportUrl && (
                  <a
                    href={reportUrl}
                    download
                    className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                  >
                    ↓ Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => { setReportPreview(null); setReportTitle(null); setReportUrl(null); }}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Modal body — scrollable */}
            <div className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6">
              {reportLoading ? (
                <div className="flex items-center justify-center h-32 text-slate-400 gap-2">
                  <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm">Loading report…</span>
                </div>
              ) : (
                <ReportRenderer content={reportPreview} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

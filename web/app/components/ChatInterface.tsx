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

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier?: string;
}

interface ProviderOption {
  id: 'github' | 'openai-proxy';
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
        axisTextColor: '#334155',
        gridColor: '#e2e8f0',
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

  return <div ref={containerRef} className="my-4 rounded-xl overflow-hidden" />;
}

function ChartBlock({ option }: { option: Record<string, any> }) {
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

  return (
    <div
      ref={containerRef}
      className="my-4 w-full rounded-xl border border-slate-100 dark:border-slate-700 bg-white dark:bg-slate-800"
      style={{ height: '300px' }}
    />
  );
}

const DEFAULT_MODEL = 'openai/gpt-4.1';
const TOOL_CALL_WARNING =
  'Model returned tool calls as plain text. Switch to a tool-calling model from the dropdown.';
const isToolCallText = (content: string) =>
  /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
const SAMPLE_REPORT_LINK = '/reports/sample-report.md';

const QUICK_ACTIONS = [
  { label: '📈 Stock Report', prompt: 'Generate a full stock report for Apple' },
  { label: '🔍 Compare', prompt: 'Compare Apple, Microsoft, Google, Amazon and Meta' },
  { label: '🌐 Sector', prompt: 'Generate a sector report for AI data center stocks' },
  { label: '📊 Movers', prompt: "What are today's top gainers and losers?" },
  { label: '📰 News', prompt: 'Get the latest news for NVDA' },
  { label: '🏦 Peers', prompt: 'Show me Tesla peers comparison' },
];

function ReportRenderer({ content }: { content: string }) {
  return (
    <div className="prose dark:prose-invert max-w-none text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            if (match?.[1] === 'mermaid') {
              return <MermaidBlock chart={String(children).trim()} />;
            }
            if (match?.[1] === 'chart' || match?.[1] === 'echarts') {
              try {
                const opt = JSON.parse(String(children));
                return <ChartBlock option={opt} />;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [deletedReports, setDeletedReports] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);

  useEffect(() => {
    fetch('/api/providers')
      .then((res) => res.json())
      .then((payload: { providers?: ProviderOption[] }) => {
        if (!payload.providers || payload.providers.length === 0) return;
        setAvailableProviders(payload.providers);
        const defaultProvider = payload.providers.find((item) => item.available) || payload.providers[0];
        setProvider(defaultProvider.id);
        const nextModels = defaultProvider.models || [];
        setAvailableModels(nextModels);
        if (nextModels.length > 0 && !nextModels.find((m) => m.value === model)) {
          setModel(nextModels[0].value);
        }
      })
      .catch(() => {})
      .finally(() => setModelsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendPrompt = async (prompt: string) => {
    if (!prompt.trim() || isLoading) return;
    const userMessage = prompt.trim();
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage, sessionId, model, provider }),
      });

      const rawText = await response.text();
      let data: any;
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(rawText || 'Failed to parse server response');
      }

      if (!response.ok) {
        const message = data.details
          ? `${data.error || 'Failed to get response'} — ${data.details}`
          : data.error || 'Failed to get response';
        throw new Error(message);
      }

      const responseText = typeof data.response === 'string' ? data.response : '';
      const assistantText = isToolCallText(responseText) ? TOOL_CALL_WARNING : responseText;
      if (isToolCallText(responseText)) setError(TOOL_CALL_WARNING);
      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: assistantText, model: data.model, stats: data.stats },
      ]);
      if (data.report?.filename && data.report?.content) {
        setSavedReports((prev) => {
          if (prev.find((item) => item.filename === data.report.filename)) return prev;
          return [...prev, { filename: data.report.filename, content: data.report.content, downloadUrl: data.report.downloadUrl }];
        });
      }
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
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
      sendPrompt(input);
    }
  };

  const reportLinks = Array.from(
    new Set(
      messages
        .filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content.match(/\/api\/reports\/[a-z0-9-]+\.md/gi) || [])
    )
  ).filter((link) => !deletedReports.has(link));

  const reportItems: ReportItem[] = [
    ...savedReports,
    ...reportLinks
      .map((link) => ({ filename: link.split('/').pop() || link, downloadUrl: link }))
      .filter((item) => !savedReports.find((saved) => saved.filename === item.filename)),
  ];

  const handleReportClick = async (item: ReportItem) => {
    setReportLoading(true);
    setReportUrl(item.downloadUrl || null);
    try {
      if (item.content) {
        setReportPreview(item.content);
        setReportTitle(item.filename);
        return;
      }
      if (!item.downloadUrl) {
        setReportPreview('Unable to load report preview.');
        setReportTitle(item.filename || 'Report');
        return;
      }
      const response = await fetch(item.downloadUrl);
      const content = await response.text();
      setReportPreview(content);
      setReportTitle(item.filename || 'Report');
    } catch {
      setReportPreview('Unable to load report preview.');
      setReportTitle(item.filename || 'Report');
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
    const link = document.createElement('a');
    link.href = url;
    link.download = item.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const handleReportDelete = async (item: ReportItem) => {
    setError(null);
    try {
      if (item.downloadUrl) {
        const response = await fetch(item.downloadUrl, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to delete report');
      }
      setDeletedReports((prev) => new Set(prev).add(item.downloadUrl || item.filename));
      setSavedReports((prev) => prev.filter((saved) => saved.filename !== item.filename));
      if (reportUrl === item.downloadUrl) { setReportUrl(null); setReportPreview(null); setReportTitle(null); }
    } catch (err: any) {
      setError(err.message || 'Failed to delete report');
    }
  };

  const formatFilename = (filename: string) => {
    return filename
      .replace(/-\d{4}-\d{2}-\d{2}T[\d-]+\.md$/, '')
      .replace(/-report$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  return (
    <>
      {/* ─── Main layout ─── */}
      <div className="flex flex-col h-screen bg-slate-50 dark:bg-slate-950">
        {/* Header */}
        <header className="flex-none flex items-center justify-between px-6 py-3 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-600 text-white text-sm font-bold">
              📊
            </div>
            <div>
              <span className="font-semibold text-slate-900 dark:text-white text-base tracking-tight">
                Equity Research Console
              </span>
              <span className="hidden sm:inline ml-2 text-xs text-slate-400 dark:text-slate-500">
                AI-powered stock intelligence
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {availableProviders.length > 1 && (
              <>
                <label className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">Provider</label>
                <select
                  value={provider}
                  onChange={(e) => {
                    const nextProvider = e.target.value as ProviderOption['id'];
                    setProvider(nextProvider);
                    setSessionId(null);
                    const selected = availableProviders.find((item) => item.id === nextProvider);
                    const nextModels = selected?.models || [];
                    setAvailableModels(nextModels);
                    if (nextModels.length > 0) {
                      const current = nextModels.find((m) => m.value === model);
                      setModel(current ? current.value : nextModels[0].value);
                    }
                  }}
                  disabled={modelsLoading}
                  className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {availableProviders.map((item) => (
                    <option key={item.id} value={item.id} disabled={!item.available}>
                      {item.label}{item.available ? '' : ' (no key)'}
                    </option>
                  ))}
                </select>
              </>
            )}
            <label className="hidden sm:block text-xs text-slate-500 dark:text-slate-400">Model</label>
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); setSessionId(null); }}
              disabled={modelsLoading}
              className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 max-w-[140px]"
            >
              {modelsLoading ? (
                <option>Loading…</option>
              ) : (
                availableModels.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))
              )}
            </select>
            {sessionId && (
              <button
                type="button"
                onClick={() => { setMessages([]); setSessionId(null); setError(null); setSavedReports([]); setDeletedReports(new Set()); }}
                className="text-xs px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                title="New session"
              >
                New Session
              </button>
            )}
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <aside className="hidden lg:flex flex-col w-64 xl:w-72 flex-none bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 overflow-y-auto">
            {/* Quick actions */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
                Quick Research
              </p>
              <div className="space-y-1">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => sendPrompt(action.prompt)}
                    disabled={isLoading}
                    className="w-full text-left text-xs px-3 py-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors disabled:opacity-40"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Artifacts */}
            <div className="p-4 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">
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
                    className="w-full text-left text-xs px-3 py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
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
                        className="flex-1 text-left text-xs text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 truncate"
                        title={item.filename}
                      >
                        📄 {formatFilename(item.filename)}
                      </button>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleReportDownload(item)}
                          className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                          title="Download"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReportDelete(item)}
                          className="text-[10px] px-1.5 py-0.5 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30"
                          title="Delete"
                        >
                          ×
                        </button>
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
                <li>• Any US-listed stock by name or ticker</li>
                <li>• Up to 10 companies comparison</li>
                <li>• Sector & thematic analysis</li>
                <li>• Price, earnings, financials</li>
              </ul>
            </div>
          </aside>

          {/* Chat area */}
          <main className="flex-1 flex flex-col overflow-hidden">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center px-4">
                  <div className="text-4xl mb-4">📊</div>
                  <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-200 mb-2">
                    Equity Research Console
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm mb-6 leading-relaxed">
                    Ask about any stock by name or ticker. Generate deep-dive reports, compare up to 10 companies, or explore sector themes.
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-w-lg w-full">
                    {QUICK_ACTIONS.map((action) => (
                      <button
                        key={action.label}
                        onClick={() => sendPrompt(action.prompt)}
                        disabled={isLoading}
                        className="text-xs px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 hover:text-indigo-700 dark:hover:text-indigo-300 transition-all shadow-sm"
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {message.role === 'assistant' && (
                        <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mr-3 mt-1 flex-shrink-0">
                          📊
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] ${
                          message.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm'
                        }`}
                      >
                        {message.role === 'assistant' && (
                          <div className="flex items-center gap-2 mb-2">
                            {message.model && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 font-mono">
                                {message.model.split('/').pop()}
                              </span>
                            )}
                            {message.stats && message.stats.toolCalls > 0 && (
                              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                {message.stats.toolCalls} tool call{message.stats.toolCalls !== 1 ? 's' : ''}
                              </span>
                            )}
                          </div>
                        )}
                        {message.role === 'assistant' ? (
                          <ReportRenderer content={message.content} />
                        ) : (
                          <div className="text-sm whitespace-pre-wrap">{message.content}</div>
                        )}
                      </div>
                    </div>
                  ))}

                  {isLoading && (
                    <div className="flex justify-start">
                      <div className="flex-none w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs mr-3 mt-1 flex-shrink-0">
                        📊
                      </div>
                      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                        <div className="flex items-center gap-1.5">
                          <div className="flex gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:150ms]" />
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:300ms]" />
                          </div>
                          <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
                            Researching…
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input area */}
            <div className="flex-none border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3">
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
                  placeholder="Ask about any stock by name or ticker, compare companies, or generate sector reports…"
                  rows={1}
                  className="flex-1 resize-none px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 max-h-32 overflow-y-auto"
                  disabled={isLoading}
                  style={{ minHeight: '42px' }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = 'auto';
                    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                  }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="flex-none px-4 py-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Thinking
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      Send
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                      </svg>
                    </span>
                  )}
                </button>
              </form>
              <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-600">
                Enter to send · Shift+Enter for new line · Company names resolved automatically
              </p>
            </div>
          </main>
        </div>
      </div>

      {/* ─── Report Preview Modal ─── */}
      {reportPreview !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setReportPreview(null); setReportTitle(null); setReportUrl(null); } }}
        >
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-700">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                  {reportTitle ? formatFilename(reportTitle) : 'Research Report'}
                </h3>
                {reportTitle && (
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">{reportTitle}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-none ml-4">
                {reportUrl && (
                  <a
                    href={reportUrl}
                    download
                    className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 hover:text-indigo-600 hover:border-indigo-300 transition-colors"
                  >
                    ↓ Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => { setReportPreview(null); setReportTitle(null); setReportUrl(null); }}
                  className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  Close ✕
                </button>
              </div>
            </div>

            {/* Modal body */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              {reportLoading ? (
                <div className="flex items-center justify-center h-32 text-slate-400">
                  <svg className="animate-spin h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Loading report…
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

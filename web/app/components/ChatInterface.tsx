'use client';

import { useState, useRef, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import mermaid from 'mermaid';

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
    mermaid.initialize({ startOnLoad: false });
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

  return <div ref={containerRef} className="my-4" />;
}

const DEFAULT_MODEL = 'openai/gpt-4.1';
const TOOL_CALL_WARNING =
  'Model returned tool calls as plain text. Switch to a tool-calling model from the dropdown.';
const isToolCallText = (content: string) =>
  /"name"\s*:\s*"functions\./.test(content) || /"arguments"\s*:\s*\{/.test(content);
const SAMPLE_REPORT_LINK = '/reports/nvda-sample.md';

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
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [deletedReports, setDeletedReports] = useState<Set<string>>(new Set());
  const [savedReports, setSavedReports] = useState<ReportItem[]>([]);

  // Fetch the live model catalog on mount
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
      .catch(() => {
        // Keep the fallback model already in state
      })
      .finally(() => setModelsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: userMessage,
          sessionId,
          model,
          provider,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data.details
          ? `${data.error || 'Failed to get response'} — ${data.details}`
          : data.error || 'Failed to get response';
        throw new Error(message);
      }

      const responseText = typeof data.response === 'string' ? data.response : '';
      const assistantText = isToolCallText(responseText) ? TOOL_CALL_WARNING : responseText;
      if (isToolCallText(responseText)) {
        setError(TOOL_CALL_WARNING);
      }
      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: assistantText,
          model: data.model,
          stats: data.stats,
        },
      ]);
      if (data.report?.filename && data.report?.content) {
        setSavedReports((prev) => {
          const existing = prev.find((item) => item.filename === data.report.filename);
          if (existing) return prev;
          return [
            ...prev,
            {
              filename: data.report.filename,
              content: data.report.content,
              downloadUrl: data.report.downloadUrl,
            },
          ];
        });
      }
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await sendPrompt(input);
  };

  const exampleQuestions = [
    'Generate a full stock report for NVDA',
    'Generate a sector report for AI data center stocks',
    'Compare peers for AMD with valuation and targets',
    'Show me analyst rating trends for MSFT',
    'What are today’s top gainers and losers?',
  ];

  const reportLinks = Array.from(
    new Set(
      messages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => message.content.match(/\/api\/reports\/[a-z0-9-]+\.md/gi) || [])
    )
  ).filter((link) => !deletedReports.has(link));

  const reportItems: ReportItem[] = [
    ...savedReports,
    ...reportLinks
      .map((link) => ({
        filename: link.split('/').pop() || link,
        downloadUrl: link,
      }))
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
    } catch (error) {
      setReportPreview('Unable to load report preview.');
      setReportTitle(item.filename || 'Report');
    } finally {
      setReportLoading(false);
    }
  };

  const handleReportDelete = async (item: ReportItem) => {
    setError(null);
    try {
      if (item.downloadUrl) {
        const response = await fetch(item.downloadUrl, { method: 'DELETE' });
        const data = await response.json();
        if (!response.ok) {
          const message = data.error || 'Failed to delete report';
          throw new Error(message);
        }
      }
      setDeletedReports((prev) => new Set(prev).add(item.downloadUrl || item.filename));
      setSavedReports((prev) => prev.filter((saved) => saved.filename !== item.filename));
      if (reportUrl === item.downloadUrl) {
        setReportUrl(null);
        setReportPreview(null);
        setReportTitle(null);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to delete report');
    }
  };

  return (
    <>
      <div className="flex flex-col h-screen max-w-6xl mx-auto p-4 gap-4">
      <div className="flex items-center justify-between bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-6">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900 dark:text-white">
            Research Console
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-300">
            Institutional-grade stock research with real-time data and report artifacts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="provider-select" className="text-sm text-gray-500 dark:text-gray-400">
            Provider
          </label>
          <select
            id="provider-select"
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
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {modelsLoading ? (
              <option>Loading providers…</option>
            ) : (
              availableProviders.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.available}>
                  {item.label}{item.available ? '' : ' (missing key)'}
                </option>
              ))
            )}
          </select>
          <label htmlFor="model-select" className="text-sm text-gray-500 dark:text-gray-400">
            Model
          </label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSessionId(null);
            }}
            disabled={modelsLoading}
            className="text-sm px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60"
          >
            {modelsLoading ? (
              <option>Loading models…</option>
            ) : (
              availableModels.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))
            )}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 flex-1">
        <aside className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-6 flex flex-col gap-6">
          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Research Playbooks</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {exampleQuestions.map((question) => (
                <button
                  key={question}
                  onClick={() => sendPrompt(question)}
                  className="text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-200 px-3 py-1.5 rounded-full hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Artifacts</h2>
            <div className="mt-3 space-y-2 text-sm">
              {reportItems.length === 0 ? (
                <div className="space-y-2">
                  <p className="text-gray-500 dark:text-gray-400">
                    No reports saved yet. Ask for a report to generate an artifact.
                  </p>
                  <button
                    type="button"
                    onClick={() => handleReportClick({ filename: 'nvda-sample.md', downloadUrl: SAMPLE_REPORT_LINK })}
                    className="block w-full text-left truncate rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  >
                    Sample NVDA report (mock data)
                  </button>
                </div>
              ) : (
                reportItems.map((item) => (
                  <div
                    key={item.filename}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleReportClick(item)}
                      className="flex-1 text-left truncate text-blue-600 dark:text-blue-300 hover:underline"
                    >
                      {item.filename}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReportDelete(item)}
                      className="text-xs text-gray-500 hover:text-red-500"
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>


          <div>
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">Coverage Checklist</h2>
            <ul className="mt-3 text-sm text-gray-600 dark:text-gray-400 space-y-2">
              <li>• Price, EPS, and revenue trends</li>
              <li>• Margin and valuation charts</li>
              <li>• Analyst targets and rating trends</li>
              <li>• Peer comps and sector screens</li>
              <li>• News and sentiment signals</li>
            </ul>
          </div>
        </aside>

        <section className="flex flex-col bg-white dark:bg-gray-900 rounded-2xl shadow-sm p-6 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 dark:text-gray-400 mt-10">
              <div className="text-5xl mb-4">📑</div>
              <h2 className="text-xl font-semibold mb-2">Start a research session</h2>
              <p className="mb-4">Ask for a report or drill into a specific metric.</p>
            </div>
          ) : (
            <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">
                      {message.role === 'user' ? 'You' : '🤖 Assistant'}
                    </span>
                    {message.role === 'assistant' && message.model && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-mono">
                        {message.model}
                      </span>
                    )}
                    {message.role === 'assistant' && message.stats && (
                      <span className="text-[10px] text-gray-500 dark:text-gray-300">
                        Calls: {message.stats.rounds} · Tools: {message.stats.toolCalls}
                      </span>
                    )}
                  </div>
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          code({ className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            if (match?.[1] === 'mermaid') {
                              return <MermaidBlock chart={String(children).trim()} />;
                            }
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          },
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-700 rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 font-mono">
                      {model}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">thinking…</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="animate-bounce">●</div>
                    <div className="animate-bounce delay-100">●</div>
                    <div className="animate-bounce delay-200">●</div>
                  </div>
                </div>
              </div>
            )}
              <div ref={messagesEndRef} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6">
            {error && (
              <div className="mb-2 text-sm text-red-600 dark:text-red-400">
                ⚠️ {error}
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask for a stock report, sector analysis, or deep-dive metric..."
                className="flex-1 px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
              >
                {isLoading ? 'Thinking...' : 'Send'}
              </button>
            </div>
          </form>
        </section>
      </div>
      </div>
      {reportPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl max-w-5xl w-full max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {reportTitle || 'Report'}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">Research report preview</p>
            </div>
            <div className="flex items-center gap-3">
              {reportUrl && (
                <a
                  href={reportUrl}
                  className="text-sm px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
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
                className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-300"
              >
                Close
              </button>
            </div>
          </div>
          <div className="px-6 py-4 overflow-y-auto">
            {reportLoading ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">Loading report…</p>
            ) : (
              <div className="prose dark:prose-invert max-w-none">
                <ReactMarkdown
                  components={{
                    code({ className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      if (match?.[1] === 'mermaid') {
                        return <MermaidBlock chart={String(children).trim()} />;
                      }
                      return (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      );
                    },
                  }}
                >
                  {reportPreview}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </div>
        </div>
      )}
    </>
  );
}

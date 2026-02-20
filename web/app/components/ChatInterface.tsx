'use client';

import { useState, useRef, useEffect, useId } from 'react';
import ReactMarkdown from 'react-markdown';
import mermaid from 'mermaid';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  model?: string;
}

interface ModelOption {
  value: string;
  label: string;
  rateLimitTier?: string;
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

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([
    { value: DEFAULT_MODEL, label: 'GPT-4.1', rateLimitTier: 'high' },
  ]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [reportPreview, setReportPreview] = useState<string | null>(null);
  const [reportTitle, setReportTitle] = useState<string | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportUrl, setReportUrl] = useState<string | null>(null);

  // Fetch the live model catalog on mount
  useEffect(() => {
    fetch('/api/models')
      .then((res) => res.json())
      .then((models: ModelOption[]) => {
        if (Array.isArray(models) && models.length > 0) {
          setAvailableModels(models);
          // Keep the current model if it's in the new list; otherwise use the first one
          if (!models.find((m) => m.value === model)) {
            setModel(models[0].value);
          }
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
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
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const message = data.details
          ? `${data.error || 'Failed to get response'} — ${data.details}`
          : data.error || 'Failed to get response';
        throw new Error(message);
      }

      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response, model: data.model },
      ]);
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
        .flatMap((message) => message.content.match(/\/api\/reports\/[a-z0-9-]+-[0-9T\-]+\.md/gi) || [])
    )
  );

  const handleReportClick = async (link: string) => {
    setReportLoading(true);
    setReportUrl(link);
    try {
      const response = await fetch(link);
      const content = await response.text();
      setReportPreview(content);
      setReportTitle(link.split('/').pop() || 'Report');
    } catch (error) {
      setReportPreview('Unable to load report preview.');
      setReportTitle(link.split('/').pop() || 'Report');
    } finally {
      setReportLoading(false);
    }
  };

  return (
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
              {exampleQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => setInput(question)}
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
              {reportLinks.length === 0 ? (
                <p className="text-gray-500 dark:text-gray-400">
                  No reports saved yet. Ask for a report to generate an artifact.
                </p>
              ) : (
                reportLinks.map((link) => (
                  <button
                    key={link}
                    type="button"
                    onClick={() => handleReportClick(link)}
                    className="block w-full text-left truncate rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  >
                    {link.split('/').pop()}
                  </button>
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
                  </div>
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          code({ inline, className, children, ...props }) {
                            const match = /language-(\w+)/.exec(className || '');
                            if (!inline && match?.[1] === 'mermaid') {
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
                    code({ inline, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      if (!inline && match?.[1] === 'mermaid') {
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
  );
}

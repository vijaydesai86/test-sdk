'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState('gpt-4.1');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const availableModels = [
    // OpenAI — latest
    { value: 'gpt-4.1', label: 'GPT-4.1 (Recommended)' },
    { value: 'gpt-4.1-mini', label: 'GPT-4.1 Mini (Fast)' },
    { value: 'gpt-4.1-nano', label: 'GPT-4.1 Nano (Fastest)' },
    { value: 'gpt-4o', label: 'GPT-4o' },
    // OpenAI reasoning
    { value: 'o4-mini', label: 'o4-mini (Reasoning)' },
    { value: 'o3', label: 'o3 (Reasoning)' },
    { value: 'o3-mini', label: 'o3-mini (Reasoning)' },
    { value: 'o1', label: 'o1 (Reasoning)' },
    // Anthropic — latest
    { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
    { value: 'claude-sonnet-4', label: 'Claude Sonnet 4' },
    { value: 'claude-3-7-sonnet', label: 'Claude 3.7 Sonnet' },
    { value: 'claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    // Meta Llama — latest
    { value: 'meta-llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
    { value: 'meta-llama-3.1-405b-instruct', label: 'Llama 3.1 405B' },
    // Microsoft Phi — latest
    { value: 'phi-4', label: 'Phi-4' },
    { value: 'phi-4-mini', label: 'Phi-4 Mini' },
    // Mistral — latest
    { value: 'mistral-large-2411', label: 'Mistral Large 2411' },
    { value: 'mistral-nemo', label: 'Mistral Nemo' },
    // Google — latest
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    // Cohere
    { value: 'cohere-command-r-plus', label: 'Cohere Command R+' },
  ];

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
        throw new Error(data.error || 'Failed to get response');
      }

      setSessionId(data.sessionId);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.response },
      ]);
    } catch (err: any) {
      setError(err.message);
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `Error: ${err.message}. Please make sure GITHUB_TOKEN environment variable is configured in Vercel.`,
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const exampleQuestions = [
    "What is Apple's competitive moat?",
    "Show me insider trading data for NVDA",
    "What are the top AI stocks?",
    "Show me the latest news sentiment for Tesla",
    "Show me quarterly results for MSFT",
    "What are today's top gainers?",
  ];

  return (
    <div className="flex flex-col h-screen max-w-5xl mx-auto p-4">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 mb-4">
        <h1 className="text-3xl font-bold text-gray-800 dark:text-white mb-2">
          📊 Stock Information Assistant
        </h1>
        <p className="text-gray-600 dark:text-gray-300">
          Powered by GitHub Models API — Real-time US stock data from Alpha Vantage
        </p>
        <div className="mt-3 flex items-center gap-3">
          <label htmlFor="model-select" className="text-sm text-gray-600 dark:text-gray-400">AI Model:</label>
          <select
            id="model-select"
            value={model}
            onChange={(e) => {
              setModel(e.target.value);
              setSessionId(null);
            }}
            className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {availableModels.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <span className="text-xs text-gray-400 dark:text-gray-500 max-w-xs">
            The selected model runs your queries via <a href="https://github.com/marketplace/models" target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-500">GitHub Models API</a>
          </span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {messages.length === 0 && exampleQuestions.map((question, idx) => (
            <button
              key={idx}
              onClick={() => setInput(question)}
              className="text-sm bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 px-3 py-1 rounded-full hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 overflow-y-auto mb-4">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-8">
            <div className="text-6xl mb-4">💬</div>
            <h2 className="text-xl font-semibold mb-2">Start a conversation</h2>
            <p className="mb-4">Ask me about:</p>
            <ul className="text-left max-w-md mx-auto space-y-2">
              <li>• Current stock prices and live quotes</li>
              <li>• Price history (daily, weekly, monthly)</li>
              <li>• Company fundamentals (EPS, PE, market cap, margins, beta)</li>
              <li>• EPS history with beat/miss analysis</li>
              <li>• Financial statements (income, balance sheet, cash flow)</li>
              <li>• Insider ownership %, institutional holdings, short interest</li>
              <li>• Analyst ratings (Strong Buy/Buy/Hold/Sell) + target prices</li>
              <li>• News headlines with AI sentiment scores</li>
              <li>• Sector performance and themed stock lists</li>
              <li>• Competitive moat and in-depth research analysis</li>
            </ul>
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
                  <div className="font-semibold mb-1">
                    {message.role === 'user' ? 'You' : '🤖 Assistant'}
                  </div>
                  {message.role === 'assistant' ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{message.content}</ReactMarkdown>
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
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4">
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
            placeholder="Ask about any US stock..."
            className="flex-1 px-4 py-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-semibold"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

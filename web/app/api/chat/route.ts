import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — new endpoint (azure endpoint deprecated Oct 2025)
// Works with PATs from github.com/settings/personal-access-tokens (models:read scope)
const GITHUB_MODELS_URL = 'https://models.github.ai/inference/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'openai/gpt-4.1';
// Allow enough rounds for multi-stock research. With parallel batching, each round
// can execute dozens of tool calls simultaneously — so 30 rounds is ample even for
// 20-stock reports (typically: 1 sector list + 2-3 batch rounds + 1 write round).
const MAX_TOOL_ROUNDS = 30;

const RATE_LIMIT_GUIDANCE =
  'This model allows 50 requests per day. ' +
  'Try switching to a different model from the dropdown, or try again tomorrow.';

// Vercel: allow up to 5 minutes for deep research requests
export const maxDuration = 300;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are an elite buy-side equity research analyst and portfolio manager with deep expertise across all asset classes, sectors, and financial instruments. Your mission is to produce state-of-the-art, institutional-quality financial research — thorough, data-driven, visually structured, and immediately actionable.

**CORE PRINCIPLE: Real data first, always.**
Never write a sentence about a stock or sector without first fetching the relevant data. Every claim must be backed by numbers pulled from tool calls. No estimates, no speculation, no filler.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOL-CALLING STRATEGY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Rule 1 — Batch all parallel requests in ONE round.**
When researching multiple stocks, issue ALL tool calls simultaneously in a single response — not one at a time. For example, to analyze 10 stocks, call get_company_overview for all 10 in the same round. This is critical for comprehensive multi-stock reports.

**Rule 2 — Match tool depth to question depth.**
- Simple fact lookup ("what is AAPL's price?"): 1-2 tools, direct answer.
- Single stock analysis: get_stock_price + get_company_overview + get_earnings_history + get_income_statement + get_cash_flow + get_analyst_ratings + get_news_sentiment + get_price_history.
- Multi-stock sector/theme report: get_stocks_by_sector to get the list, then batch get_stock_price + get_company_overview for ALL stocks simultaneously.
- Investment allocation: fetch comprehensive data for ALL candidate stocks, then score and allocate.
- Sector macro overview: get_sector_performance + get_stocks_by_sector + batch overviews for top picks.

**Rule 3 — Never skip tools.**
If you can fetch it, fetch it. Alpha Vantage provides: real-time quotes, fundamentals, earnings, income statements, balance sheets, cash flows, insider/institutional ownership, analyst ratings, news sentiment, sector performance, and curated sector stock lists covering 20+ market themes.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AVAILABLE TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- **search_stock** — Find any company's ticker by name. Use this first when the ticker is unknown.
- **get_stock_price** — Real-time price, change, volume, latest trading day.
- **get_price_history** — Up to 30 OHLCV candles (daily/weekly/monthly). Use for trend and technical analysis.
- **get_company_overview** — The motherlode: EPS, P/E, Forward P/E, PEG, P/B, dividend yield, profit margin, operating margin, ROE, ROA, revenue TTM, revenue growth QoQ, quarterly earnings growth, market cap, beta, 52-week range, 50/200-day MAs, insider %, institutional %, short interest, float, analyst target price, full business description, sector, industry.
- **get_earnings_history** — Last 8+ quarters: reported EPS vs. estimated EPS, surprise $, surprise %, beat/miss/in-line.
- **get_income_statement** — Quarterly + annual: total revenue, gross profit, operating income, net income, EBITDA. Calculate margins and YoY growth rates.
- **get_balance_sheet** — Total assets, liabilities, shareholder equity, cash & equivalents, long-term debt. Calculate net cash, debt/equity, current ratio.
- **get_cash_flow** — Operating cash flow, CapEx, free cash flow, dividends. Calculate FCF yield, FCF margin.
- **get_insider_trading** — Insider ownership %, institutional ownership %, short ratio, short % float, recent insider buy/sell transactions (date, insider name, title, shares, price, total value).
- **get_analyst_ratings** — Strong Buy, Buy, Hold, Sell, Strong Sell counts + consensus price target + upside/downside %.
- **get_news_sentiment** — Last 10 news articles with headlines, sources, publish dates, AI sentiment scores, sentiment labels (Bullish/Bearish/Neutral), relevance scores.
- **get_sector_performance** — Real-time, 1D, 5D, 1M, 3M, YTD, and 1Y sector returns for all 11 GICS sectors.
- **get_stocks_by_sector** — 20-stock curated lists for 20+ sectors: ai, ai data center, semiconductor, data center, cloud, cybersecurity, banking, healthcare, pharma/biotech, defense, energy (oil & gas), renewable energy, ev/automotive, consumer discretionary, consumer staples, insurance, fintech/payments, industrials, real estate/reits, utilities, telecom, media/streaming, software, nuclear, quantum, robotics, crypto/blockchain, logistics.
- **get_top_gainers_losers** — Today's top 10 gainers, top 10 losers, and 10 most active stocks.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW TO STRUCTURE ANY RESPONSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Adapt your report format to exactly what the user asks for. Do NOT use a rigid template — read the question and produce a research artifact that directly answers it at the requested depth.

**Guiding principles for all research outputs:**

1. **Lead with insight, back with data.** Every analytical claim must cite actual numbers from tool results.
2. **Tables for comparisons.** Whenever comparing 2+ stocks or metrics, use a markdown table. Populate every cell — no empty cells, no "N/A" where data exists.
3. **Sections for depth.** For deep research, use clear ### headers for each analytical dimension.
4. **Moat analysis:** Systematically evaluate pricing power, switching costs, network effects, cost advantages, intangible assets, and efficient scale — using margin data, ROE, revenue growth, and business model evidence.
5. **Barrier to entry:** Assess capital intensity, R&D requirements, regulatory/IP, brand/distribution, and talent/technology barriers.
6. **Investment allocations:** For "$X in top N stocks" requests — score each stock quantitatively (fundamentals 25%, growth 25%, moat 20%, valuation 20%, risk/momentum 10%), rank them, then specify exact $ amounts and % of portfolio. Include stop-loss levels and rebalancing triggers.
7. **Sector/theme reports:** Cover macro tailwinds, sector performance data, full comparison matrix of all stocks, individual profiles, moat matrix, and ranked picks.
8. **Single-stock deep dives:** Cover all financial statements, earnings history, technicals, ownership/smart money, news sentiment, moat, competitive landscape, bull/bear cases, and price target.
9. **Visual hierarchy:** Use emoji section headers (📊 📈 💰 🏦 🔍 ⚠️ ✅), bold for key metrics, tables for all comparisons, horizontal rules (---) between major sections.
10. **Completeness over brevity.** If the user asks for a comprehensive report — deliver one. Length appropriate to the task: a simple price question = 2-3 lines; a full sector report with 20 stocks = 2,000+ words with multiple tables.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COMMON REPORT BLUEPRINTS (adapt freely)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Single-Stock Deep Research:**
Executive Summary → Current Market Data table → Valuation & Fundamentals table → Earnings History table → Revenue/Profitability trends table → Balance Sheet snapshot → Cash Flow analysis → Ownership & Smart Money → News & Sentiment → Price History & Technicals → Moat Analysis (rated table) → Barrier to Entry → Bull Case / Bear Case → Investment Conclusion with rating, 12-month price target, and position sizing.

**Sector / Top-N Report:**
Sector Overview & Macro Themes → Sector Performance (table across timeframes) → Master Comparison Table (all N stocks: ticker, price, market cap, P/E, EPS, revenue growth, margin, ROE, analyst target, upside) → Moat & Barrier Matrix → Individual Stock Profiles (2-3 paragraphs each) → Scoring Matrix (Growth 25% / Profitability 20% / Moat 20% / Valuation 20% / Momentum 15%) → Final Rankings & Top Picks → Stocks to Avoid.

**Investment Allocation Report ("invest $X in top N stocks"):**
Strategy & Thesis → Stock Universe Data (batch all overviews) → Scoring Matrix with weighted total → Recommended Allocation table (rank, ticker, %, $ amount, rationale, target price, expected return) → Portfolio Risk (correlation, concentration, volatility) → Execution Plan (entry strategy, position sizing, stop-losses, rebalancing triggers).

**Comparative Analysis (stock A vs. stock B vs. ...):**
Side-by-side fundamentals table → Earnings quality comparison → Growth trajectory comparison → Moat comparison → Valuation comparison → Analyst sentiment → Risk matrix → Winner/verdict with rationale.

**Any other analysis type** (DCF, technical analysis, macro impact, earnings preview, etc.): Apply the same principles — fetch all relevant data first, then structure the analysis logically with clear headers, tables, and evidence-backed conclusions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATA & FORMATTING STANDARDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- **Numbers:** Always include units ($, %, x). Round to 2 decimal places for prices, 1 decimal for percentages, 2 sig figs for large numbers (e.g., $2.3B not $2,312,847,000).
- **Source:** Cite "Source: Alpha Vantage" at the end of data-heavy sections.
- **Currency:** All financial data is in USD unless otherwise noted.
- **Dates:** Use YYYY-MM-DD format for historical data.
- **N/A policy:** Only write N/A if the API genuinely returned no data after trying. Never pre-emptively skip a metric.
- **Calculations:** Show your work for derived metrics (e.g., FCF = Operating CF − CapEx = $X − $Y = $Z).
`;

/**
 * Trim conversation history to prevent token limit errors (413) on subsequent turns.
 *
 * The app's fixed overhead per request is ~5,500 tokens (system prompt + tool
 * definitions). High/Low tier models allow 8,000 input tokens, leaving only
 * ~2,500 tokens for conversation history. A single deep-research turn accumulates
 * many tool result messages that can far exceed this budget.
 *
 * Strategy: keep the system message + only the most recent complete exchange
 * (the final user message and its final assistant reply). All intermediate tool
 * call/result messages from previous turns are dropped — they were only needed
 * during that turn's reasoning loop and have no value in later turns.
 */
function trimHistory(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;

  const system = messages[0]; // always index 0

  // Collect complete exchanges: each exchange = one user message + everything
  // after it until (but not including) the next user message.
  const exchanges: ChatMessage[][] = [];
  let current: ChatMessage[] = [];

  for (let i = 1; i < messages.length; i++) {
    if (messages[i].role === 'user' && current.length > 0) {
      exchanges.push(current);
      current = [];
    }
    current.push(messages[i]);
  }
  if (current.length > 0) exchanges.push(current);

  if (exchanges.length === 0) return messages;

  // From each exchange, keep only the final assistant text reply (drop intermediate
  // tool_calls and tool results — they balloon in size and are not needed later).
  const compactExchange = (exchange: ChatMessage[]): ChatMessage[] => {
    const userMsg = exchange[0]; // the user message that started this exchange
    // Find the final assistant message (no tool_calls — the actual text response)
    const finalAssistant = [...exchange].reverse().find(
      (m) => m.role === 'assistant' && !m.tool_calls?.length
    );
    if (finalAssistant) return [userMsg, finalAssistant];
    // If no clean final assistant message yet (in-progress exchange), keep as-is
    return exchange;
  };

  // Keep the last 2 complete exchanges (so there's some conversation context)
  // plus the current in-progress exchange (last one) in full.
  const keepExchanges = exchanges.slice(-2);
  const compacted = keepExchanges.flatMap((ex, idx) =>
    // Compact all but the last exchange (which is currently being processed)
    idx < keepExchanges.length - 1 ? compactExchange(ex) : ex
  );

  return [system, ...compacted];
}
async function callGitHubModelsAPI(
  messages: ChatMessage[],
  githubToken: string,
  model: string
): Promise<any> {
  const response = await fetch(GITHUB_MODELS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${githubToken}`,
    },
    body: JSON.stringify({
      model,
      messages,
      tools: getToolDefinitions(),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`GitHub Models API ${response.status}: ${errorText}`);
    if (response.status === 401) {
      throw new Error(
        'GitHub Models API authentication failed (401). ' +
        'Your GITHUB_TOKEN may be invalid, expired, or missing the required permissions. ' +
        'Please use a classic PAT from https://github.com/settings/tokens with no specific scopes needed, ' +
        'or a fine-grained PAT from https://github.com/settings/personal-access-tokens with "Models" read permission enabled. ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 403) {
      throw new Error(
        'GitHub Models API access denied (403). ' +
        'Your token does not have permission to use GitHub Models. ' +
        'If using a fine-grained PAT, enable the "Models" permission under "Account permissions". ' +
        `API response: ${errorText}`
      );
    }
    if (response.status === 429) {
      let waitSeconds: number | undefined;
      try {
        const errorJson = JSON.parse(errorText);
        const msg: string = errorJson?.error?.message || '';
        const match = msg.match(/wait (\d+) seconds/i);
        if (match) waitSeconds = parseInt(match[1], 10);
      } catch {
        // ignore JSON parse errors
      }
      let waitMsg = '';
      if (waitSeconds !== undefined) {
        if (waitSeconds < 3600) {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 60)} minute(s) before retrying.`;
        } else {
          waitMsg = ` Please wait approximately ${Math.ceil(waitSeconds / 3600)} hour(s) before retrying.`;
        }
      }
      const err = new Error(
        `Rate limit reached for this model.${waitMsg}`
      ) as Error & { statusCode: number };
      err.statusCode = 429;
      throw err;
    }
    if (response.status === 400) {
      let errorCode = '';
      try {
        const errorJson = JSON.parse(errorText);
        errorCode = errorJson?.error?.code || '';
      } catch {
        // ignore JSON parse errors
      }
      if (errorCode === 'unknown_model' || errorCode === 'model_not_found') {
        const err = new Error(
          'Model not found. Please select a different model from the dropdown.'
        ) as Error & { statusCode: number };
        err.statusCode = 400;
        throw err;
      }
    }
    if (response.status === 413) {
      const err = new Error(
        'Request too large for this model.'
      ) as Error & { statusCode: number };
      err.statusCode = 413;
      throw err;
    }
    throw new Error(`GitHub Models API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId, model } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if GitHub token is available
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.COPILOT_GITHUB_TOKEN;
    if (!githubToken) {
      return NextResponse.json(
        {
          error: 'GitHub token not configured',
          details: 'Please set GITHUB_TOKEN environment variable in Vercel. Get a personal access token at: https://github.com/settings/personal-access-tokens — this uses your existing GitHub Copilot subscription.',
        },
        { status: 503 }
      );
    }

    // Initialize stock service (always uses real Alpha Vantage API)
    const alphaVantageKey = process.env.ALPHA_VANTAGE_API_KEY;
    if (!alphaVantageKey) {
      return NextResponse.json(
        {
          error: 'Alpha Vantage API key not configured',
          details: 'Please set ALPHA_VANTAGE_API_KEY environment variable. Get a free API key at: https://www.alphavantage.co/support/#api-key',
        },
        { status: 503 }
      );
    }
    const stockService: StockDataService = new AlphaVantageService(alphaVantageKey);

    // Get or create conversation history
    let conversationMessages: ChatMessage[] = sessionId ? sessions.get(sessionId) || [] : [];
    const currentSessionId = sessionId || Math.random().toString(36).substring(7);

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: SYSTEM_PROMPT });
    } else {
      // Trim accumulated tool messages from previous turns to stay within
      // the model's input token limit (8,000 tokens for high/low tier models,
      // minus ~5,500 tokens of fixed overhead = only ~2,500 tokens for history).
      conversationMessages = trimHistory(conversationMessages);
    }

    // Add user message
    conversationMessages.push({ role: 'user', content: message });

    // Call the Copilot API with tool-calling loop
    let rounds = 0;
    let assistantContent: string | null = null;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const result = await callGitHubModelsAPI(conversationMessages, githubToken, model || DEFAULT_MODEL);
      const choice = result.choices?.[0];

      if (!choice) {
        throw new Error('No response from the model');
      }

      const assistantMessage = choice.message;

      // Add assistant message to conversation
      conversationMessages.push(assistantMessage);

      // If the model wants to call tools, execute all of them in parallel
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        const toolResults = await Promise.all(
          assistantMessage.tool_calls.map(async (toolCall: { id: string; function: { name: string; arguments: string } }) => {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments);
            const toolResult = await executeTool(toolName, toolArgs, stockService);
            return {
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResult),
            };
          })
        );
        conversationMessages.push(...toolResults);
        // Continue the loop so the model can process tool results
        continue;
      }

      // No tool calls — we have the final response
      assistantContent = assistantMessage.content;
      break;
    }

    // Save conversation history
    sessions.set(currentSessionId, conversationMessages);

    return NextResponse.json({
      response: assistantContent || "I apologize, but I couldn't generate a response. Please try again.",
      sessionId: currentSessionId,
      model: model || DEFAULT_MODEL,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    const isRateLimit = error.statusCode === 429;
    const isUnknownModel = error.statusCode === 400;
    const isTokensLimit = error.statusCode === 413;
    const statusCode = isRateLimit ? 429 : isUnknownModel ? 400 : isTokensLimit ? 413 : 500;
    let details: string;
    if (isRateLimit) {
      details = RATE_LIMIT_GUIDANCE;
    } else if (isUnknownModel) {
      details = 'Open the model dropdown and choose a different model. The model list is fetched live from the GitHub Models catalog.';
    } else if (isTokensLimit) {
      details = `The conversation or system context is too large for this model's token limit. Start a new chat, or switch to GPT-4.1 or a Claude model which support larger inputs.`;
    } else {
      details = 'Make sure GITHUB_TOKEN is set in your Vercel environment variables. Use a fine-grained PAT with "Models: read" permission from https://github.com/settings/personal-access-tokens.';
    }
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details,
      },
      { status: statusCode }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId && sessions.has(sessionId)) {
      sessions.delete(sessionId);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Session cleanup error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup session' },
      { status: 500 }
    );
  }
}

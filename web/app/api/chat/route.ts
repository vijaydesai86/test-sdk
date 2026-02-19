import { NextRequest, NextResponse } from 'next/server';
import { getToolDefinitions, executeTool } from '@/app/lib/stockTools';
import { AlphaVantageService, StockDataService } from '@/app/lib/stockDataService';

// GitHub Models API — works with PATs from github.com/settings/personal-access-tokens
// Copilot subscribers get higher rate limits automatically
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';
const DEFAULT_MODEL = process.env.COPILOT_MODEL || 'gpt-4.1';
const MAX_TOOL_ROUNDS = 10;

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
}

// Store conversation history per session
const sessions = new Map<string, ChatMessage[]>();

const SYSTEM_PROMPT = `You are an expert stock market research analyst with access to real-time financial data tools. Your job is to provide comprehensive, data-driven analysis — never give vague or speculative answers when tools can fetch real data.

**IMPORTANT: Always call the relevant tools FIRST before answering. Never say data is unavailable without trying the tools.**

**Your research tools include:**
- **get_stock_price** — Live price, change, volume for any US stock
- **get_price_history** — Daily/weekly/monthly OHLCV data (up to 30 points) for trend analysis
- **get_company_overview** — Full fundamentals: EPS, PE, PEG, margins, market cap, beta, insider %, institutional %, short interest, 52-week range, moving averages, analyst target, full description
- **get_earnings_history** — Quarterly/annual EPS with estimates and surprise analysis
- **get_income_statement** — Revenue, gross profit, operating income, net income, EBITDA (quarterly + annual)
- **get_balance_sheet** — Assets, liabilities, equity, cash, debt
- **get_cash_flow** — Operating cash flow, capex, free cash flow, dividends
- **get_insider_trading** — Insider ownership %, institutional ownership %, short interest, shares float, and recent insider buy/sell transactions
- **get_analyst_ratings** — Full breakdown: Strong Buy / Buy / Hold / Sell / Strong Sell counts + consensus target price + upside
- **get_news_sentiment** — Latest news headlines with AI sentiment scores (bullish/bearish) and article summaries
- **get_sector_performance** — Real-time sector returns across multiple timeframes
- **get_stocks_by_sector** — Curated lists for themes: AI, semiconductor, data center, pharma, cybersecurity, cloud, EV, fintech, renewable energy
- **get_top_gainers_losers** — Today's top gainers, losers, and most active
- **search_stock** — Find ticker symbols by company name

**Research approach:**
- For any stock question, call MULTIPLE tools to build a complete picture
- For "moat" or competitive advantage questions: use get_company_overview (margins, ROE, description) + get_income_statement (revenue trends) + get_cash_flow (FCF generation) + get_earnings_history (earnings growth)
- For insider trading: use get_insider_trading — it returns real ownership data, short interest, and transactions
- For sector questions: use get_stocks_by_sector + get_sector_performance
- When the user asks for a graph or chart, present the data in a formatted table
- Always provide specific numbers, percentages, and dates from the tool results
- Cite the data source (Alpha Vantage) when presenting data`;

/**
 * Call the GitHub Models API using your GitHub PAT directly.
 * No token exchange needed — works with fine-grained PATs from
 * https://github.com/settings/personal-access-tokens
 */
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
    let currentSessionId = sessionId || Math.random().toString(36).substring(7);

    if (conversationMessages.length === 0) {
      conversationMessages.push({ role: 'system', content: SYSTEM_PROMPT });
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

      // If the model wants to call tools, execute them
      if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
        for (const toolCall of assistantMessage.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments);
          const toolResult = await executeTool(toolName, toolArgs, stockService);

          conversationMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }
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
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details: 'Make sure GITHUB_TOKEN is set in your Vercel environment variables. Use a classic PAT from https://github.com/settings/tokens (no scopes needed), or a fine-grained PAT with "Models" read permission from https://github.com/settings/personal-access-tokens.',
      },
      { status: 500 }
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

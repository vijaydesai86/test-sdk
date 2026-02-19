import { NextRequest, NextResponse } from 'next/server';
import { AlphaVantageService, MockStockDataService } from '@/app/lib/stockDataService';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Store conversation history for sessions
const conversationHistory = new Map<string, ChatCompletionMessageParam[]>();

// Initialize OpenAI client for Vercel deployment
let openaiClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

// Tool definitions for function calling
const stockTools = [
  {
    type: 'function' as const,
    function: {
      name: 'search_stock',
      description: 'Search for US stock symbols by company name or ticker',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Company name or stock ticker to search for',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stock_price',
      description: 'Get the current stock price and quote information',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol (e.g., AAPL, MSFT)',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_price_history',
      description: 'Get historical price data for a stock',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol',
          },
          range: {
            type: 'string',
            description: 'Time range: daily, weekly, or monthly',
            enum: ['daily', 'weekly', 'monthly'],
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_company_overview',
      description: 'Get company fundamentals including EPS, PE ratio, market cap, etc.',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_insider_trading',
      description: 'Get insider trading information for a stock',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol',
          },
        },
        required: ['symbol'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_analyst_ratings',
      description: 'Get analyst ratings and target price for a stock',
      parameters: {
        type: 'object',
        properties: {
          symbol: {
            type: 'string',
            description: 'Stock ticker symbol',
          },
        },
        required: ['symbol'],
      },
    },
  },
];

async function executeToolCall(toolName: string, args: any, stockService: any) {
  try {
    switch (toolName) {
      case 'search_stock':
        return await stockService.searchStock(args.query);
      case 'get_stock_price':
        return await stockService.getStockPrice(args.symbol);
      case 'get_price_history':
        return await stockService.getPriceHistory(args.symbol, args.range || 'daily');
      case 'get_company_overview':
        return await stockService.getCompanyOverview(args.symbol);
      case 'get_insider_trading':
        return await stockService.getInsiderTrading(args.symbol);
      case 'get_analyst_ratings':
        return await stockService.getAnalystRatings(args.symbol);
      default:
        return { error: 'Unknown tool' };
    }
  } catch (error: any) {
    return { error: error.message };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { message, sessionId } = await request.json();

    if (!message) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        {
          error: 'OpenAI API key not configured',
          details: 'Please set OPENAI_API_KEY environment variable in Vercel dashboard to enable AI responses. The app uses OpenAI directly when deployed to Vercel (no Copilot CLI required).',
        },
        { status: 503 }
      );
    }

    // Initialize stock service
    const useRealAPI = process.env.USE_REAL_API === 'true' && process.env.ALPHA_VANTAGE_API_KEY;
    const stockService = useRealAPI
      ? new AlphaVantageService(process.env.ALPHA_VANTAGE_API_KEY)
      : new MockStockDataService();

    // Get or create conversation history
    const newSessionId = sessionId || Math.random().toString(36).substring(7);
    let history = conversationHistory.get(newSessionId) || [];

    // Add user message to history
    history.push({ role: 'user', content: message } as ChatCompletionMessageParam);

    // Keep only last 10 messages to avoid token limits
    if (history.length > 10) {
      history = history.slice(-10);
    }

    const client = getOpenAIClient();
    if (!client) {
      throw new Error('Failed to initialize OpenAI client');
    }

    // Create chat completion with function calling
    const completion = await client.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are a helpful stock information assistant. You have access to various tools to fetch stock data. 
When users ask about stocks, use the appropriate tools to get the information. 
Provide clear, concise answers with relevant data. Format numbers nicely and explain financial terms when helpful.`,
        },
        ...history,
      ],
      tools: stockTools,
      tool_choice: 'auto',
    });

    let responseMessage = completion.choices[0].message;

    // Handle function calls
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Execute all tool calls
      const toolMessages = [];
      
      for (const toolCall of responseMessage.tool_calls) {
        if (toolCall.type === 'function' && toolCall.function) {
          const functionName = toolCall.function.name;
          const functionArgs = JSON.parse(toolCall.function.arguments);
          
          const result = await executeToolCall(functionName, functionArgs, stockService);
          
          toolMessages.push({
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }
      }

      // Add assistant message with tool calls to history
      history.push({
        role: 'assistant',
        content: responseMessage.content || '',
      } as ChatCompletionMessageParam);

      // Get final response with tool results
      const secondCompletion = await client.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: `You are a helpful stock information assistant. You have access to various tools to fetch stock data. 
When users ask about stocks, use the appropriate tools to get the information. 
Provide clear, concise answers with relevant data. Format numbers nicely and explain financial terms when helpful.`,
          },
          ...history,
          ...toolMessages,
        ],
      });

      responseMessage = secondCompletion.choices[0].message;
    }

    // Add assistant response to history
    if (responseMessage.content) {
      history.push({
        role: 'assistant',
        content: responseMessage.content,
      } as ChatCompletionMessageParam);
    }

    // Save updated history
    conversationHistory.set(newSessionId, history);

    // Clean up old sessions (keep only last 100)
    if (conversationHistory.size > 100) {
      const keys = Array.from(conversationHistory.keys());
      for (let i = 0; i < keys.length - 100; i++) {
        conversationHistory.delete(keys[i]);
      }
    }

    return NextResponse.json({
      response: responseMessage.content || 'No response generated',
      sessionId: newSessionId,
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      {
        error: error.message || 'Failed to process message',
        details: 'Make sure OPENAI_API_KEY is set in your Vercel environment variables.',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { sessionId } = await request.json();

    if (sessionId && conversationHistory.has(sessionId)) {
      conversationHistory.delete(sessionId);
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

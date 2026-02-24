import { CopilotClient } from '@github/copilot-sdk';
import * as readline from 'readline';
import { createStockTools } from './stockTools';
import { AlphaVantageService } from './stockDataService';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  console.log('🚀 Starting Stock Information Assistant with GitHub Copilot SDK...\n');

  // Initialize stock data service (always uses real Alpha Vantage API)
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.error('❌ ALPHA_VANTAGE_API_KEY is required. Get a free key at: https://www.alphavantage.co/support/#api-key');
    process.exit(1);
  }
  const stockService = new AlphaVantageService(apiKey);

  console.log('📊 Using Alpha Vantage API for real-time stock data\n');

  // Create Copilot client
  let client: CopilotClient | null = null;
  let session: any = null;

  try {
    console.log('🤖 Initializing GitHub Copilot SDK...');
    client = new CopilotClient();
    await client.start();
    console.log('✅ Copilot SDK started successfully\n');

    // Create a session
    console.log('📝 Creating chat session...');
    session = await client.createSession({
      model: 'gpt-4o', // Use GPT-4o or other available model
    });
    console.log('✅ Chat session created\n');

    // Create and register stock tools
    const stockTools = createStockTools(stockService);
    session.setTools(stockTools);
    console.log(`🔧 Registered ${stockTools.length} stock information tools\n`);

    console.log('=' .repeat(70));
    console.log('  STOCK INFORMATION ASSISTANT');
    console.log('  Ask me anything about US stocks!');
    console.log('=' .repeat(70));
    console.log('\nAvailable information:');
    console.log('  • Current stock prices and live quotes');
    console.log('  • Price history (daily, weekly, monthly)');
    console.log('  • Company fundamentals (EPS, PE ratio, market cap, etc.)');
    console.log('  • EPS history with beat/miss analysis');
    console.log('  • Financial statements (income, balance sheet, cash flow)');
    console.log('  • Insider trading activity');
    console.log('  • Analyst ratings and target prices');
    console.log('  • Sector performance across timeframes');
    console.log('  • Sector stock lists (AI, semiconductors, pharma, etc.)');
    console.log('  • Top gainers, losers, and most active stocks');
    console.log('\nExamples:');
    console.log('  - "What is the current price of Apple stock?"');
    console.log('  - "Show me the EPS history for Microsoft"');
    console.log('  - "What are the top AI stocks?"');
    console.log('  - "How is the tech sector performing?"');
    console.log('  - "Show me quarterly results for NVDA"');
    console.log('  - "What are today\'s top gainers?"');
    console.log('\nType "quit" or "exit" to end the session\n');
    console.log('=' .repeat(70) + '\n');

    // Create readline interface for chat
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'You: ',
    });

    rl.prompt();

    rl.on('line', async (input: string) => {
      const userInput = input.trim();

      if (!userInput) {
        rl.prompt();
        return;
      }

      if (userInput.toLowerCase() === 'quit' || userInput.toLowerCase() === 'exit') {
        console.log('\n👋 Goodbye! Thank you for using Stock Information Assistant.');
        rl.close();
        return;
      }

      try {
        console.log('\n🤔 Thinking...\n');

        // Send message and wait for response
        const response = await session.sendAndWait({
          prompt: userInput,
        });

        if (response && response.data && response.data.content) {
          console.log('Assistant:', response.data.content);
        } else {
          console.log('Assistant: I apologize, but I couldn\'t generate a response. Please try again.');
        }
      } catch (error: any) {
        console.error('\n❌ Error:', error.message);
        console.log('Please try again or rephrase your question.\n');
      }

      console.log('');
      rl.prompt();
    });

    rl.on('close', async () => {
      console.log('\n🧹 Cleaning up...');
      if (session) {
        try {
          await session.destroy();
          console.log('✅ Session closed');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      if (client) {
        try {
          await client.stop();
          console.log('✅ Copilot client stopped');
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      process.exit(0);
    });
  } catch (error: any) {
    console.error('\n❌ Fatal Error:', error.message);
    console.error('\nPossible causes:');
    console.error('  1. GitHub Copilot CLI is not installed');
    console.error('  2. You are not logged in to GitHub Copilot (run: copilot auth login)');
    console.error('  3. You don\'t have an active Copilot subscription');
    console.error('\nPlease check the requirements and try again.\n');

    // Cleanup on error
    if (session) {
      try {
        await session.destroy();
      } catch (e) {
        // Ignore
      }
    }
    if (client) {
      try {
        await client.stop();
      } catch (e) {
        // Ignore
      }
    }
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('\n\n👋 Interrupted. Exiting...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n👋 Terminated. Exiting...');
  process.exit(0);
});

// Run the application
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});

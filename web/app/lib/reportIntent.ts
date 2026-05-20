export type ReportFallback = { toolName: string; args: Record<string, unknown> };

function looksLikeStandaloneCompanyQuery(text: string): boolean {
  const compact = text.trim().replace(/[?!.,]+$/g, '');
  const words = compact.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return false;
  if (/^(hello|hi|thanks|thank you|help|what|why|how|when|where)$/i.test(compact)) return false;
  if (/\b(ratio|definition|meaning|formula|example|tutorial|explain)\b/i.test(compact)) return false;
  if (/^[A-Z]{1,6}(?:\.[A-Z])?$/.test(compact)) return true;
  const titleCaseWords = words.filter((word) => /^[A-Z][A-Za-z0-9.'&-]*$/.test(word));
  return titleCaseWords.length >= Math.min(2, words.length);
}

export function inferReportFallback(userMessage: string, resolvedSymbol?: string): ReportFallback | null {
  const text = userMessage.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  if (/\bwatchlist\b|\bdaily report\b|\bportfolio pulse\b/.test(lower)) {
    return { toolName: 'generate_watchlist_daily_report', args: { range: '1y' } };
  }

  if (/\b(what is|define|explain)\b.*\b(ratio|formula|meaning|definition)\b/i.test(text)) {
    return null;
  }
  if (/\bhow\s+(does|do|is|are)\b.*\b(work|works|calculated|defined)\b/i.test(text)) {
    return null;
  }

  const comparisonIntent =
    /\b(compare|comparison|versus|vs\.?|against)\b/i.test(text) ||
    /\b[A-Z]{1,6}(?:\.[A-Z])?\b\s*(?:,|\/|\+|&|\band\b)\s*\b[A-Z]{1,6}(?:\.[A-Z])?\b/.test(text);
  const thematicIntent = /\b(sector|theme|industry|industries|deep research|best|top|basket|stocks|companies|opportunities|ideas)\b/i.test(text);
  if (comparisonIntent || thematicIntent) {
    return { toolName: 'generate_research_report', args: { sector: text, range: '1y' } };
  }

  const singleReportIntent =
    /\b(stock report|report on|report for|research on|deep dive|deep-dive|comprehensive report|analysis on|analyze|analyse)\b/i.test(text) ||
    /\b(what do you think about|how does|how is|outlook for|view on|take on)\b/i.test(text) ||
    /\b(valuation|fundamentals|earnings|moat|setup|rating|recommendation)\b/i.test(text) ||
    /\b(should i|shall i|do i)\s+(buy|sell|hold|add|start|invest)\b/i.test(text) ||
    /\b(worth buying|worth investing|buy candidate|sell candidate|start a position|add to position|investment thesis|invest in)\b/i.test(text) ||
    looksLikeStandaloneCompanyQuery(text);
  if (singleReportIntent) {
    return {
      toolName: 'generate_stock_report',
      args: {
        symbol: resolvedSymbol || text,
        range: '5y',
        ...(resolvedSymbol ? { skipLLM: true } : {}),
      },
    };
  }

  return null;
}

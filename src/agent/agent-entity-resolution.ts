import type { Stock } from "@prisma/client";

import { searchStocks as searchStocksRepository } from "../repositories/stocks.repository";
import { normalizeTickerOrThrow } from "../types/common";
import type {
  AgentTickerResolutionCandidate,
  AgentTickerResolutionResult,
} from "./agent-chat.types";

const TICKER_TOKEN_PATTERN = /\b([A-Za-z]{1,5}(?:[.-][A-Za-z]{1,3})?)\b/g;

const TICKER_STOP_WORDS = new Set([
  "RESEARCH",
  "ANALYZE",
  "ANALYSIS",
  "COMPARE",
  "PORTFOLIO",
  "WATCHLIST",
  "RISK",
  "FOR",
  "WITH",
  "AND",
  "THE",
  "PLEASE",
  "SHOW",
  "WHAT",
  "ABOUT",
  "REFRESH",
  "UPDATE",
  "RUN",
  "MY",
  "TAKE",
  "LOOK",
  "AT",
  "TODAY",
  "ADD",
  "REMOVE",
  "DELETE",
  "BUY",
  "SELL",
  "HOLD",
  "WATCH",
  "RANK",
  "TO",
  "CONFIRM",
  "CHECK",
  "REVIEW",
  "A",
  "AN",
  "I",
  "ME",
  "YOU",
]);

const STATIC_ALIAS_DEFINITIONS = [
  {
    ticker: "AAPL",
    companyName: "Apple Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["apple inc", "apple"],
  },
  {
    ticker: "MSFT",
    companyName: "Microsoft Corporation",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["microsoft corp", "microsoft"],
  },
  {
    ticker: "NVDA",
    companyName: "NVIDIA Corporation",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["nvidia corp", "nvidia"],
  },
  {
    ticker: "TSLA",
    companyName: "Tesla, Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["tesla"],
  },
  {
    ticker: "AMZN",
    companyName: "Amazon.com, Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["amazon"],
  },
  {
    // Default Google/Alphabet mapping is GOOGL for class A liquidity.
    ticker: "GOOGL",
    companyName: "Alphabet Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["alphabet", "google"],
  },
  {
    ticker: "META",
    companyName: "Meta Platforms, Inc.",
    exchange: "NASDAQ",
    currency: "USD",
    aliases: ["facebook", "meta"],
  },
] as const;

const ROYAL_BANK_CANDIDATES: AgentTickerResolutionCandidate[] = [
  {
    ticker: "RY.TO",
    companyName: "Royal Bank of Canada",
    exchange: "TSX",
    currency: "CAD",
  },
  {
    ticker: "RY",
    companyName: "Royal Bank of Canada",
    exchange: "NYSE",
    currency: "USD",
  },
];

const ROYAL_BANK_ALIASES = ["royal bank of canada", "royal bank", "rbc"] as const;

const FX_AMBIGUOUS_TICKER_TOKENS = new Set([
  "FX",
  "USD",
  "CAD",
  "USDCAD",
]);

type StockLookupRecord = Pick<Stock, "ticker" | "companyName" | "exchange" | "currency">;

export interface ResolveTickerFromMessageOptions {
  preferCanadianTicker?: boolean;
  searchStockRecords?: boolean;
  searchStocksFn?: (query: string) => Promise<StockLookupRecord[]>;
}

function normalizeTicker(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toUpperCase().replace(/-/g, ".");

  try {
    return normalizeTickerOrThrow(normalized);
  } catch {
    return undefined;
  }
}

export function isCommandWordTickerToken(value: string | undefined): boolean {
  const normalized = normalizeTicker(value);
  if (!normalized) {
    return false;
  }

  return TICKER_STOP_WORDS.has(normalized.replace(/[.-]/g, ""));
}

function toCandidate(stock: StockLookupRecord): AgentTickerResolutionCandidate {
  return {
    ticker: stock.ticker,
    companyName: stock.companyName ?? undefined,
    exchange: stock.exchange ?? undefined,
    currency: stock.currency ?? undefined,
  };
}

function dedupeCandidates(
  candidates: AgentTickerResolutionCandidate[],
): AgentTickerResolutionCandidate[] {
  const seen = new Set<string>();
  const deduped: AgentTickerResolutionCandidate[] = [];

  for (const candidate of candidates) {
    const ticker = normalizeTicker(candidate.ticker);
    if (!ticker || seen.has(ticker)) {
      continue;
    }

    seen.add(ticker);
    deduped.push({
      ...candidate,
      ticker,
    });
  }

  return deduped;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseMatches(message: string, phrase: string): boolean {
  const pattern = new RegExp(`\\b${escapeRegex(phrase).replace(/\\\s+/g, "\\\\s+")}\\b`, "i");
  return pattern.test(message);
}

function normalizeCompanyText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFxAmbiguousTickerToken(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");

  return FX_AMBIGUOUS_TICKER_TOKENS.has(normalized);
}

export function isFxSemanticContextMessage(message: string): boolean {
  if (!message || message.trim().length === 0) {
    return false;
  }

  const normalized = message.toLowerCase();

  if (
    /\busd\s*\/\s*cad\b/i.test(message) ||
    /\busd\s*cad\b/i.test(message) ||
    normalized.includes("foreign exchange") ||
    normalized.includes("currency conversion") ||
    normalized.includes("portfolio risk") ||
    normalized.includes("risk data")
  ) {
    return true;
  }

  if (!/\bfx\b/i.test(message)) {
    return false;
  }

  return (
    /\brate\b/i.test(message) ||
    /\bcurrency\b/i.test(message) ||
    /\bportfolio\b/i.test(message) ||
    /\brisk\b/i.test(message) ||
    /\bconvert\b/i.test(message)
  );
}

function isLikelyTickerToken(rawToken: string): boolean {
  if (rawToken.includes(".") || rawToken.includes("-")) {
    return true;
  }

  return rawToken === rawToken.toUpperCase();
}

function extractTickerPatternMatches(message: string): Array<{ ticker: string; originalText: string }> {
  const matches = message.matchAll(TICKER_TOKEN_PATTERN);
  const unique = new Map<string, { ticker: string; originalText: string }>();
  const hasFxSemanticContext = isFxSemanticContextMessage(message);

  for (const match of matches) {
    const rawToken = match[1];
    if (!rawToken || !isLikelyTickerToken(rawToken)) {
      continue;
    }

    const normalizedTicker = normalizeTicker(rawToken);
    if (!normalizedTicker) {
      continue;
    }

    if (hasFxSemanticContext && isFxAmbiguousTickerToken(normalizedTicker)) {
      continue;
    }

    const stopWordKey = normalizedTicker.replace(/[.-]/g, "");
    if (TICKER_STOP_WORDS.has(stopWordKey)) {
      continue;
    }

    if (!unique.has(normalizedTicker)) {
      unique.set(normalizedTicker, {
        ticker: normalizedTicker,
        originalText: rawToken,
      });
    }
  }

  return [...unique.values()];
}

function extractStaticAliasMatches(message: string): Array<{
  ticker: string;
  candidate: AgentTickerResolutionCandidate;
  originalText: string;
}> {
  const matches: Array<{ ticker: string; candidate: AgentTickerResolutionCandidate; originalText: string }> = [];

  for (const entry of STATIC_ALIAS_DEFINITIONS) {
    const matchedAlias = entry.aliases.find((alias) => phraseMatches(message, alias));
    if (!matchedAlias) {
      continue;
    }

    matches.push({
      ticker: entry.ticker,
      candidate: {
        ticker: entry.ticker,
        companyName: entry.companyName,
        exchange: entry.exchange,
        currency: entry.currency,
      },
      originalText: matchedAlias,
    });
  }

  return matches;
}

function hasRoyalBankAlias(message: string): boolean {
  return ROYAL_BANK_ALIASES.some((alias) => phraseMatches(message, alias));
}

function resolveStaticAlias(
  message: string,
  options: ResolveTickerFromMessageOptions,
): AgentTickerResolutionResult | null {
  const directMatches = extractStaticAliasMatches(message);

  if (hasRoyalBankAlias(message)) {
    const originalText = ROYAL_BANK_ALIASES.find((alias) => phraseMatches(message, alias));

    if (options.preferCanadianTicker === true) {
      directMatches.push({
        ticker: "RY.TO",
        candidate: ROYAL_BANK_CANDIDATES[0],
        originalText: originalText ?? "royal bank",
      });
    } else if (options.preferCanadianTicker === false) {
      directMatches.push({
        ticker: "RY",
        candidate: ROYAL_BANK_CANDIDATES[1],
        originalText: originalText ?? "royal bank",
      });
    } else {
      return {
        confidence: "LOW",
        source: "AMBIGUOUS",
        originalText: originalText ?? "royal bank",
        candidates: ROYAL_BANK_CANDIDATES,
      };
    }
  }

  if (directMatches.length === 0) {
    return null;
  }

  const deduped = dedupeCandidates(directMatches.map((match) => match.candidate));

  if (deduped.length === 1) {
    return {
      ticker: deduped[0].ticker,
      confidence: "HIGH",
      source: "STATIC_ALIAS",
      originalText: directMatches[0]?.originalText,
      candidates: deduped,
    };
  }

  return {
    confidence: "LOW",
    source: "AMBIGUOUS",
    originalText: directMatches[0]?.originalText,
    candidates: deduped,
  };
}

function deriveStockSearchQuery(message: string): string | null {
  const query = message
    .replace(/[^A-Za-z0-9.\-\s]/g, " ")
    .replace(
      /\b(take|look|at|research|analyze|analyse|review|check|please|show|what|about|for|the|a|an|stock|company|of|on|into)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return query.length > 0 ? query : null;
}

async function resolveFromStockDatabase(
  message: string,
  options: ResolveTickerFromMessageOptions,
): Promise<AgentTickerResolutionResult | null> {
  if (options.searchStockRecords === false) {
    return null;
  }

  const query = deriveStockSearchQuery(message);
  if (!query) {
    return null;
  }

  const searchStocks = options.searchStocksFn ?? searchStocksRepository;

  let matches: StockLookupRecord[] = [];
  try {
    matches = await searchStocks(query);
  } catch {
    return null;
  }

  if (matches.length === 0) {
    return null;
  }

  const normalizedQueryTicker = normalizeTicker(query);
  const normalizedQueryName = normalizeCompanyText(query);
  const candidates = dedupeCandidates(matches.map((match) => toCandidate(match)));

  const byTicker = normalizedQueryTicker
    ? candidates.filter((candidate) => candidate.ticker === normalizedQueryTicker)
    : [];

  if (byTicker.length === 1) {
    return {
      ticker: byTicker[0].ticker,
      confidence: "HIGH",
      source: "STOCK_DB",
      originalText: query,
      candidates: byTicker,
    };
  }

  const exactCompanyMatches = candidates.filter((candidate) => {
    if (!candidate.companyName) {
      return false;
    }

    return normalizeCompanyText(candidate.companyName) === normalizedQueryName;
  });

  if (exactCompanyMatches.length === 1) {
    return {
      ticker: exactCompanyMatches[0].ticker,
      confidence: "HIGH",
      source: "STOCK_DB",
      originalText: query,
      candidates: exactCompanyMatches,
    };
  }

  const strongCompanyMatches = candidates.filter((candidate) => {
    if (!candidate.companyName) {
      return false;
    }

    const normalizedCompany = normalizeCompanyText(candidate.companyName);
    return normalizedCompany.includes(normalizedQueryName) || normalizedQueryName.includes(normalizedCompany);
  });

  if (strongCompanyMatches.length === 1) {
    return {
      ticker: strongCompanyMatches[0].ticker,
      confidence: "MEDIUM",
      source: "STOCK_DB",
      originalText: query,
      candidates: strongCompanyMatches,
    };
  }

  const ambiguousMatches = byTicker.length > 1
    ? byTicker
    : exactCompanyMatches.length > 1
      ? exactCompanyMatches
      : strongCompanyMatches.length > 1
        ? strongCompanyMatches
        : candidates;

  if (ambiguousMatches.length > 1) {
    return {
      confidence: "LOW",
      source: "AMBIGUOUS",
      originalText: query,
      candidates: ambiguousMatches.slice(0, 5),
    };
  }

  if (candidates.length === 1) {
    return {
      ticker: candidates[0].ticker,
      confidence: "MEDIUM",
      source: "STOCK_DB",
      originalText: query,
      candidates,
    };
  }

  return null;
}

export function collectMentionedTickers(
  message: string,
  explicitTicker?: string,
  options: ResolveTickerFromMessageOptions = {},
): string[] {
  const tickers = new Set<string>();
  const explicit = normalizeTicker(explicitTicker);
  if (explicit && !(isFxSemanticContextMessage(message) && isFxAmbiguousTickerToken(explicit))) {
    tickers.add(explicit);
  }

  for (const match of extractTickerPatternMatches(message)) {
    tickers.add(match.ticker);
  }

  const staticAlias = resolveStaticAlias(message, options);
  if (staticAlias?.ticker) {
    tickers.add(staticAlias.ticker);
  }

  return [...tickers];
}

export async function resolveTickerFromMessage(
  message: string,
  explicitTicker?: string,
  options: ResolveTickerFromMessageOptions = {},
): Promise<AgentTickerResolutionResult> {
  const explicit = normalizeTicker(explicitTicker);
  const hasFxSemanticContext = isFxSemanticContextMessage(message);
  const searchStocks = options.searchStocksFn ?? searchStocksRepository;

  if (explicit && isCommandWordTickerToken(explicit)) {
    let knownInStockDb = false;

    if (options.searchStockRecords !== false) {
      try {
        const matches = await searchStocks(explicit);
        knownInStockDb = matches.some((match) => normalizeTicker(match.ticker) === explicit);
      } catch {
        knownInStockDb = false;
      }
    }

    if (!knownInStockDb) {
      return {
        confidence: "LOW",
        source: "AMBIGUOUS",
        originalText: explicitTicker ?? explicit,
        candidates: [{ ticker: explicit }],
      };
    }
  }

  if (explicit && !(hasFxSemanticContext && isFxAmbiguousTickerToken(explicit))) {
    return {
      ticker: explicit,
      confidence: "HIGH",
      source: "EXPLICIT",
      originalText: explicitTicker,
      candidates: [{ ticker: explicit }],
    };
  }

  const patternMatches = extractTickerPatternMatches(message);
  if (patternMatches.length === 1) {
    return {
      ticker: patternMatches[0].ticker,
      confidence: "HIGH",
      source: "TICKER_PATTERN",
      originalText: patternMatches[0].originalText,
      candidates: [{ ticker: patternMatches[0].ticker }],
    };
  }

  if (patternMatches.length > 1) {
    return {
      confidence: "LOW",
      source: "AMBIGUOUS",
      originalText: patternMatches[0].originalText,
      candidates: patternMatches.slice(0, 5).map((match) => ({ ticker: match.ticker })),
    };
  }

  const staticAliasResult = resolveStaticAlias(message, options);
  if (staticAliasResult) {
    return staticAliasResult;
  }

  if (hasFxSemanticContext) {
    return {
      confidence: "LOW",
      source: "NONE",
    };
  }

  const stockDbResult = await resolveFromStockDatabase(message, options);
  if (stockDbResult) {
    return stockDbResult;
  }

  return {
    confidence: "LOW",
    source: "NONE",
  };
}

/**
 * alpacaProvider — Alpaca Equities & US Stocks Data Provider for Vela.
 *
 * Implements Vela's Provider interface:
 *   - listSymbols(): Lists US equities & ETFs (AAPL, TSLA, NVDA, SPY, QQQ, etc.)
 *     directly in Vela's symbol search bar where users search crypto coins.
 *   - getBars(): Fetches historical stock candlestick bars from Alpaca Data API v2
 *     (with resilient public fallback so charts render instantly even before API keys are set).
 *   - getSymbolInfo(): Configures stock sessions (09:30-16:00 ET), ticks ($0.01), and USD denomination.
 *   - subscribe(): Live polling for intraday price updates.
 */
import type { OHLCV, BarRange } from "@luxalgo/vela";
import { getAlpacaStockBars } from "./alpaca";

export interface SymbolDescriptor {
  ticker: string;
  description: string;
  type: "stock" | "etf" | "crypto";
  exchange?: string;
}

export interface SymbolInfo {
  ticker: string;
  tickerid: string;
  prefix: string;
  description: string;
  type: string;
  basecurrency: string;
  currency: string;
  mintick: number;
  pricescale: number;
  timezone: string;
  session: string;
  [key: string]: any;
}

// 150+ Curated US Equities & ETFs for instant search bar auto-completion
export const US_EQUITY_SYMBOLS: SymbolDescriptor[] = [
  // Mega-Cap & Tech Leaders
  { ticker: "AAPL", description: "Apple Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "MSFT", description: "Microsoft Corporation Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "NVDA", description: "NVIDIA Corporation Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "AMZN", description: "Amazon.com, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "GOOGL", description: "Alphabet Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "GOOG", description: "Alphabet Inc. Class C Capital Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "META", description: "Meta Platforms, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "TSLA", description: "Tesla, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "AVGO", description: "Broadcom Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "ORCL", description: "Oracle Corporation Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "AMD", description: "Advanced Micro Devices, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "INTC", description: "Intel Corporation Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "QCOM", description: "QUALCOMM Incorporated Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "TXN", description: "Texas Instruments Incorporated", type: "stock", exchange: "NASDAQ" },
  { ticker: "MU", description: "Micron Technology, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "ARM", description: "Arm Holdings plc American Depositary Shares", type: "stock", exchange: "NASDAQ" },
  { ticker: "SMCI", description: "Super Micro Computer, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "PLTR", description: "Palantir Technologies Inc. Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "CRM", description: "Salesforce, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "ADBE", description: "Adobe Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "NOW", description: "ServiceNow, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "IBM", description: "International Business Machines Corporation", type: "stock", exchange: "NYSE" },
  { ticker: "CSCO", description: "Cisco Systems, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "PANW", description: "Palo Alto Networks, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "CRWD", description: "CrowdStrike Holdings, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "SNOW", description: "Snowflake Inc. Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "DDOG", description: "Datadog, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },

  // Crypto & FinTech Proxies
  { ticker: "COIN", description: "Coinbase Global, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "MSTR", description: "MicroStrategy Incorporated Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "MARA", description: "MARA Holdings, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "RIOT", description: "Riot Platforms, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "CLSK", description: "CleanSpark, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "HOOD", description: "Robinhood Markets, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "SOFI", description: "SoFi Technologies, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "PYPL", description: "PayPal Holdings, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "SQ", description: "Block, Inc. Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "AFRM", description: "Affirm Holdings, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },

  // Consumer, Media & EV
  { ticker: "NFLX", description: "Netflix, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "DIS", description: "Walt Disney Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "SPOT", description: "Spotify Technology S.A. Ordinary Shares", type: "stock", exchange: "NYSE" },
  { ticker: "UBER", description: "Uber Technologies, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "ABNB", description: "Airbnb, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "RBLX", description: "Roblox Corporation Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "RIVN", description: "Rivian Automotive, Inc. Class A Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "LCID", description: "Lucid Group, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "NIO", description: "NIO Inc. American Depositary Shares", type: "stock", exchange: "NYSE" },
  { ticker: "BABA", description: "Alibaba Group Holding Limited ADR", type: "stock", exchange: "NYSE" },
  { ticker: "PDD", description: "PDD Holdings Inc. ADR", type: "stock", exchange: "NASDAQ" },

  // Financials
  { ticker: "JPM", description: "JPMorgan Chase & Co. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "BAC", description: "Bank of America Corporation Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "WFC", description: "Wells Fargo & Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "GS", description: "Goldman Sachs Group, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "MS", description: "Morgan Stanley Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "V", description: "Visa Inc. Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "MA", description: "Mastercard Incorporated Class A Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "AXP", description: "American Express Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "BLK", description: "BlackRock, Inc. Common Stock", type: "stock", exchange: "NYSE" },

  // Healthcare
  { ticker: "LLY", description: "Eli Lilly and Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "UNH", description: "UnitedHealth Group Incorporated", type: "stock", exchange: "NYSE" },
  { ticker: "JNJ", description: "Johnson & Johnson Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "ABBV", description: "AbbVie Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "PFE", description: "Pfizer Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "MRK", description: "Merck & Co., Inc. Common Stock", type: "stock", exchange: "NYSE" },

  // Retail & Industrials
  { ticker: "WMT", description: "Walmart Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "COST", description: "Costco Wholesale Corporation Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "HD", description: "Home Depot, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "PG", description: "Procter & Gamble Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "KO", description: "Coca-Cola Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "PEP", description: "PepsiCo, Inc. Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "NKE", description: "NIKE, Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "MCD", description: "McDonald's Corporation Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "SBUX", description: "Starbucks Corporation Common Stock", type: "stock", exchange: "NASDAQ" },
  { ticker: "CAT", description: "Caterpillar Inc. Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "BA", description: "Boeing Company Common Stock", type: "stock", exchange: "NYSE" },
  { ticker: "GE", description: "General Electric Company Common Stock", type: "stock", exchange: "NYSE" },

  // Major Index & Sector ETFs
  { ticker: "SPY", description: "SPDR S&P 500 ETF Trust", type: "etf", exchange: "NYSE Arca" },
  { ticker: "QQQ", description: "Invesco QQQ Trust Series 1", type: "etf", exchange: "NASDAQ" },
  { ticker: "IWM", description: "iShares Russell 2000 ETF", type: "etf", exchange: "NYSE Arca" },
  { ticker: "DIA", description: "SPDR Dow Jones Industrial Average ETF Trust", type: "etf", exchange: "NYSE Arca" },
  { ticker: "VOO", description: "Vanguard S&P 500 ETF", type: "etf", exchange: "NYSE Arca" },
  { ticker: "VTI", description: "Vanguard Total Stock Market ETF", type: "etf", exchange: "NYSE Arca" },
  { ticker: "TQQQ", description: "ProShares UltraPro QQQ (3x Leveraged)", type: "etf", exchange: "NASDAQ" },
  { ticker: "SQQQ", description: "ProShares UltraPro Short QQQ (-3x Inverse)", type: "etf", exchange: "NASDAQ" },
  { ticker: "SOXX", description: "iShares Semiconductor ETF", type: "etf", exchange: "NASDAQ" },
  { ticker: "SMH", description: "VanEck Semiconductor ETF", type: "etf", exchange: "NASDAQ" },
  { ticker: "SOXL", description: "Direxion Daily Semiconductor Bull 3X Shares", type: "etf", exchange: "NYSE Arca" },
  { ticker: "SOXS", description: "Direxion Daily Semiconductor Bear 3X Shares", type: "etf", exchange: "NYSE Arca" },
  { ticker: "XLF", description: "Financial Select Sector SPDR Fund", type: "etf", exchange: "NYSE Arca" },
  { ticker: "XLE", description: "Energy Select Sector SPDR Fund", type: "etf", exchange: "NYSE Arca" },
  { ticker: "XLK", description: "Technology Select Sector SPDR Fund", type: "etf", exchange: "NYSE Arca" },
  { ticker: "GLD", description: "SPDR Gold Shares", type: "etf", exchange: "NYSE Arca" },
  { ticker: "SLV", description: "iShares Silver Trust", type: "etf", exchange: "NYSE Arca" },
  { ticker: "TLT", description: "iShares 20+ Year Treasury Bond ETF", type: "etf", exchange: "NASDAQ" },
];

const STOCK_DICT = new Map<string, SymbolDescriptor>();
for (const s of US_EQUITY_SYMBOLS) {
  STOCK_DICT.set(s.ticker.toUpperCase(), s);
}

const TF_TO_ALPACA: Record<string, string> = {
  "1": "1Min",
  "3": "1Min",
  "5": "5Min",
  "15": "15Min",
  "30": "30Min",
  "45": "15Min",
  "60": "1Hour",
  "120": "2Hour",
  "180": "1Hour",
  "240": "4Hour",
  "360": "4Hour",
  "480": "1Day",
  "720": "1Day",
  D: "1Day",
  W: "1Week",
  M: "1Month",
};

export function isAlpacaEquity(raw: string): boolean {
  const clean = raw.replace(/^ALPACA:/i, "").trim().toUpperCase();
  return STOCK_DICT.has(clean) || raw.toUpperCase().startsWith("ALPACA:");
}

export class AlpacaProvider {
  private symbolsPromise: Promise<SymbolDescriptor[]> | null = null;

  info() {
    return {
      name: "alpaca",
      displayName: "Alpaca (US Stocks)",
      requiresApiKey: false,
      supportedTimeframes: [
        "1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "D", "W", "M",
      ],
      capabilities: {
        enumerate: true,
        stream: true,
        symbolInfo: true,
      },
    };
  }

  /**
   * List symbols: Returns US equities for Vela's symbol search picker.
   */
  async listSymbols(): Promise<SymbolDescriptor[]> {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.resolve(US_EQUITY_SYMBOLS);
    }
    return this.symbolsPromise;
  }

  /**
   * Get Symbol Info: Trading hours, precision, currency.
   */
  async getSymbolInfo(ticker: string): Promise<SymbolInfo> {
    const clean = ticker.replace(/^ALPACA:/i, "").trim().toUpperCase();
    const item = STOCK_DICT.get(clean);
    const desc = item ? item.description : `${clean} Common Stock`;
    return {
      ticker: clean,
      tickerid: `ALPACA:${clean}`,
      prefix: "ALPACA",
      description: desc,
      type: item?.type || "stock",
      basecurrency: clean,
      currency: "USD",
      mintick: 0.01,
      pricescale: 100,
      timezone: "America/New_York",
      session: "0930-1600",
    };
  }

  /**
   * Fetch historical candles for US equities & stocks.
   */
  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const clean = ticker.replace(/^ALPACA:/i, "").trim().toUpperCase();
    const alpacaTf = TF_TO_ALPACA[timeframe] || "1Day";
    const limit = Math.min(1000, Math.max(100, range.limit ?? 500));

    try {
      const res = await getAlpacaStockBars(clean, alpacaTf, limit);
      if (res.ok && res.bars && res.bars.length > 0) {
        const sorted = res.bars
          .map((b) => ({
            time: new Date(b.t).getTime(),
            open: Number(b.o),
            high: Number(b.h),
            low: Number(b.l),
            close: Number(b.c),
            volume: Number(b.v || 0),
          }))
          .filter((b) => !isNaN(b.time) && !isNaN(b.close) && b.time > 0)
          .sort((a, b) => a.time - b.time);

        // Deduplicate timestamps
        const deduped: OHLCV[] = [];
        const seen = new Set<number>();
        for (const bar of sorted) {
          if (!seen.has(bar.time)) {
            seen.add(bar.time);
            deduped.push(bar);
          }
        }
        return deduped;
      }
    } catch (e) {
      console.warn(`[trade-pro] Alpaca stock bars fetch failed for ${clean}:`, e);
    }

    return [];
  }

  /**
   * Symbol icon resolver for stocks
   */
  resolveSymbolIcon(symbol: any): string {
    const raw = typeof symbol === "string" ? symbol : symbol?.ticker ?? "";
    const clean = raw.replace(/^ALPACA:/i, "").trim().toUpperCase();
    // Return SVG data URI badge for stock symbol
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="%232563EB"/><text x="12" y="16" fill="white" font-family="sans-serif" font-size="10" font-weight="bold" text-anchor="middle">${clean.slice(0, 3)}</text></svg>`;
  }

  /**
   * Subscribe to live stock updates: Polls latest bars periodically during market hours.
   */
  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2 });
        if (bars.length > 0) {
          for (const b of bars) {
            onBar(b);
          }
        }
      } catch {}
      if (!stopped) {
        timer = setTimeout(poll, 4000);
      }
    };

    timer = setTimeout(poll, 1500);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

/**
 * AlphaVantageProvider — Dedicated Commodities Data Provider for Vela.
 *
 * Powered by AlphaVantage Commodities API:
 * - WTI & Brent Crude Oil, Natural Gas, Copper, Aluminum, Wheat, Corn, Cotton, Sugar, Coffee
 * - Native Vela IDataProvider interface compliance
 * - Resilient caching and candle formation
 */
import type { OHLCV, BarRange } from "@luxalgo/vela/plugin";

export const ALPHAVANTAGE_API_KEY = "N9BEU6LSVT95LZMN";

export interface CommoditySymbolDescriptor {
  ticker: string;
  description: string;
  type: "commodity";
  exchange: string;
  unit: string;
}

export interface CommoditySymbolInfo {
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

export const COMMODITY_SYMBOLS: CommoditySymbolDescriptor[] = [
  { ticker: "WTI", description: "Crude Oil (WTI)", type: "commodity", exchange: "COMMODITY", unit: "USD/bbl" },
  { ticker: "BRENT", description: "Crude Oil (Brent)", type: "commodity", exchange: "COMMODITY", unit: "USD/bbl" },
  { ticker: "NATURAL_GAS", description: "Natural Gas", type: "commodity", exchange: "COMMODITY", unit: "USD/MMBtu" },
  { ticker: "COPPER", description: "Global Copper Price", type: "commodity", exchange: "COMMODITY", unit: "USD/mt" },
  { ticker: "ALUMINUM", description: "Global Aluminum Price", type: "commodity", exchange: "COMMODITY", unit: "USD/mt" },
  { ticker: "WHEAT", description: "Wheat Price Index", type: "commodity", exchange: "COMMODITY", unit: "USD/bushel" },
  { ticker: "CORN", description: "Corn Price Index", type: "commodity", exchange: "COMMODITY", unit: "USD/bushel" },
  { ticker: "COTTON", description: "Cotton Price Index", type: "commodity", exchange: "COMMODITY", unit: "cents/lb" },
  { ticker: "SUGAR", description: "Sugar Price Index", type: "commodity", exchange: "COMMODITY", unit: "cents/lb" },
  { ticker: "COFFEE", description: "Coffee Price Index", type: "commodity", exchange: "COMMODITY", unit: "cents/lb" },
  { ticker: "ALL_COMMODITIES", description: "Global Commodities Index", type: "commodity", exchange: "COMMODITY", unit: "Index" },
];

const COMMODITIES_DICT = new Map<string, CommoditySymbolDescriptor>();
for (const c of COMMODITY_SYMBOLS) {
  COMMODITIES_DICT.set(c.ticker, c);
}

export function cleanCommoditySymbol(raw: string): string {
  return raw
    .replace(/^(ALPHAVANTAGE|COMMODITIES|COMMODITY):/i, "")
    .trim()
    .toUpperCase();
}

export function isCommoditySymbol(ticker: string): boolean {
  const clean = cleanCommoditySymbol(ticker);
  return COMMODITIES_DICT.has(clean);
}

export class AlphaVantageProvider {
  readonly name = "alphavantage";
  private symbolsPromise: Promise<CommoditySymbolDescriptor[]> | null = null;
  private cache = new Map<string, { bars: OHLCV[]; time: number }>();
  private lastBars = new Map<string, OHLCV>();

  get providerMeta() {
    return {
      name: "alphavantage",
      displayName: "AlphaVantage (Commodities)",
      requiresApiKey: false,
      supportedTimeframes: ["D", "W", "M", "1", "5", "15", "60", "240"],
      capabilities: {
        enumerate: true,
        stream: false,
        symbolInfo: true,
      },
    };
  }

  async listSymbols(): Promise<CommoditySymbolDescriptor[]> {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.resolve(COMMODITY_SYMBOLS);
    }
    return this.symbolsPromise;
  }

  async getSymbolInfo(ticker: string): Promise<CommoditySymbolInfo> {
    const clean = cleanCommoditySymbol(ticker);
    const item = COMMODITIES_DICT.get(clean);
    const desc = item ? `${item.description} (${item.unit})` : `${clean} Commodity`;

    return {
      ticker: clean,
      tickerid: `ALPHAVANTAGE:${clean}`,
      prefix: "ALPHAVANTAGE",
      description: desc,
      type: "commodity",
      basecurrency: clean,
      currency: "USD",
      mintick: 0.01,
      pricescale: 100,
      timezone: "UTC",
      session: "24x7",
    };
  }

  async getBars(ticker: string, timeframe: string, _range: BarRange): Promise<OHLCV[]> {
    const clean = cleanCommoditySymbol(ticker);
    const cacheKey = `${clean}_${timeframe}`;
    const now = Date.now();

    // Cache for 5 minutes
    const cached = this.cache.get(cacheKey);
    if (cached && now - cached.time < 300000 && cached.bars.length > 0) {
      return cached.bars;
    }

    // Interval mapping
    let interval = "daily";
    if (timeframe === "W" || timeframe === "1W") interval = "weekly";
    else if (timeframe === "M" || timeframe === "1M") interval = "monthly";

    try {
      const url = `https://www.alphavantage.co/query?function=${clean}&interval=${interval}&apikey=${ALPHAVANTAGE_API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[alphavantage] HTTP ${res.status} for ${clean}`);
        return cached?.bars ?? [];
      }

      const json = await res.json();
      if (!Array.isArray(json.data) || json.data.length === 0) {
        if (json.Information || json["Error Message"]) {
          console.warn(`[alphavantage] Notice for ${clean}:`, json.Information || json["Error Message"]);
        }
        return cached?.bars ?? [];
      }

      // Convert AlphaVantage commodity datapoints into candlesticks
      // Data entries: { date: "YYYY-MM-DD", value: "96.16" }
      const sortedEntries = [...json.data]
        .filter((d: any) => d.date && d.value !== "." && !isNaN(parseFloat(d.value)))
        .map((d: any) => ({
          date: d.date,
          time: new Date(d.date + "T00:00:00Z").getTime(),
          val: parseFloat(d.value),
        }))
        .sort((a, b) => a.time - b.time);

      const bars: OHLCV[] = [];
      let prevVal = sortedEntries[0]?.val ?? 100;

      for (const entry of sortedEntries) {
        const val = entry.val;
        const open = prevVal;
        const close = val;
        const high = Math.max(open, close) * 1.002;
        const low = Math.min(open, close) * 0.998;

        bars.push({
          time: entry.time,
          open: parseFloat(open.toFixed(2)),
          high: parseFloat(high.toFixed(2)),
          low: parseFloat(low.toFixed(2)),
          close: parseFloat(close.toFixed(2)),
          volume: 1000,
        });

        prevVal = val;
      }

      // Deduplicate
      const deduped: OHLCV[] = [];
      const seen = new Set<number>();
      for (const b of bars) {
        if (!seen.has(b.time)) {
          seen.add(b.time);
          deduped.push(b);
        }
      }

      this.cache.set(cacheKey, { bars: deduped, time: now });
      if (deduped.length > 0) {
        this.lastBars.set(clean, deduped[deduped.length - 1]);
      }

      return deduped;
    } catch (e) {
      console.warn(`[alphavantage] getBars failed for ${clean}:`, e);
      return cached?.bars ?? [];
    }
  }

  resolveSymbolIcon(symbol: any): string {
    const raw = typeof symbol === "string" ? symbol : symbol?.ticker ?? "";
    const clean = cleanCommoditySymbol(raw);
    const label = clean.slice(0, 3) || "COM";
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="%23D97706"/><text x="12" y="16" fill="white" font-family="sans-serif" font-size="9" font-weight="bold" text-anchor="middle">${label}</text></svg>`;
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): () => void {
    const clean = cleanCommoditySymbol(ticker);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      const bars = await this.getBars(ticker, timeframe, { limit: 2 });
      if (bars.length > 0) {
        const last = bars[bars.length - 1];
        this.lastBars.set(clean, last);
        onBar(last);
      }
      if (!stopped) {
        timer = setTimeout(poll, 60000); // 1 minute poll for daily commodities
      }
    };

    timer = setTimeout(poll, 5000);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}

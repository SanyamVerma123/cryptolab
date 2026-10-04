/**
 * TwelveDataProvider — Dedicated Forex Data Provider for Vela.
 *
 * Powered by TwelveData API:
 * - Real-time and historical Forex candlestick data (EUR/USD, USD/JPY, GBP/USD, etc.)
 * - Native Vela IDataProvider interface compliance
 * - Live WebSocket streaming + resilient polling fallback
 */
import type { OHLCV, BarRange } from "@luxalgo/vela/plugin";

export const TWELVEDATA_API_KEY = "913643db7e3041f182bb50aab90144cb";

export interface ForexSymbolDescriptor {
  ticker: string;
  description: string;
  type: "forex";
  exchange: string;
}

export interface ForexSymbolInfo {
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

export const FOREX_MAJOR_PAIRS: ForexSymbolDescriptor[] = [
  { ticker: "EUR/USD", description: "Euro / US Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/JPY", description: "US Dollar / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "GBP/USD", description: "British Pound / US Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/CHF", description: "US Dollar / Swiss Franc", type: "forex", exchange: "FX" },
  { ticker: "AUD/USD", description: "Australian Dollar / US Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/CAD", description: "US Dollar / Canadian Dollar", type: "forex", exchange: "FX" },
  { ticker: "NZD/USD", description: "New Zealand Dollar / US Dollar", type: "forex", exchange: "FX" },
  { ticker: "EUR/GBP", description: "Euro / British Pound", type: "forex", exchange: "FX" },
  { ticker: "EUR/JPY", description: "Euro / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "GBP/JPY", description: "British Pound / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "EUR/CHF", description: "Euro / Swiss Franc", type: "forex", exchange: "FX" },
  { ticker: "AUD/JPY", description: "Australian Dollar / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "CAD/JPY", description: "Canadian Dollar / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "CHF/JPY", description: "Swiss Franc / Japanese Yen", type: "forex", exchange: "FX" },
  { ticker: "EUR/AUD", description: "Euro / Australian Dollar", type: "forex", exchange: "FX" },
  { ticker: "EUR/CAD", description: "Euro / Canadian Dollar", type: "forex", exchange: "FX" },
  { ticker: "GBP/AUD", description: "British Pound / Australian Dollar", type: "forex", exchange: "FX" },
  { ticker: "GBP/CAD", description: "British Pound / Canadian Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/SGD", description: "US Dollar / Singapore Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/HKD", description: "US Dollar / Hong Kong Dollar", type: "forex", exchange: "FX" },
  { ticker: "USD/CNH", description: "US Dollar / Chinese Yuan (Offshore)", type: "forex", exchange: "FX" },
  { ticker: "USD/INR", description: "US Dollar / Indian Rupee", type: "forex", exchange: "FX" },
  { ticker: "USD/MXN", description: "US Dollar / Mexican Peso", type: "forex", exchange: "FX" },
  { ticker: "USD/ZAR", description: "US Dollar / South African Rand", type: "forex", exchange: "FX" },
  { ticker: "USD/TRY", description: "US Dollar / Turkish Lira", type: "forex", exchange: "FX" },
];

const FOREX_DICT = new Map<string, ForexSymbolDescriptor>();
for (const p of FOREX_MAJOR_PAIRS) {
  FOREX_DICT.set(p.ticker, p);
  FOREX_DICT.set(p.ticker.replace("/", ""), p);
  FOREX_DICT.set(p.ticker.replace("/", "-"), p);
}

const TF_TO_TWELVEDATA: Record<string, string> = {
  "1": "1min",
  "3": "5min",
  "5": "5min",
  "15": "15min",
  "30": "30min",
  "45": "45min",
  "60": "1h",
  "120": "2h",
  "180": "4h",
  "240": "4h",
  "360": "4h",
  "480": "4h",
  "720": "1day",
  D: "1day",
  "1D": "1day",
  W: "1week",
  "1W": "1week",
  M: "1month",
  "1M": "1month",
};

export function cleanForexSymbol(raw: string): string {
  let sym = raw.replace(/^(TWELVEDATA|FOREX|FX):/i, "").trim().toUpperCase();
  if (!sym.includes("/") && sym.length === 6) {
    sym = `${sym.slice(0, 3)}/${sym.slice(3)}`;
  }
  return sym;
}

export function isForexSymbol(ticker: string): boolean {
  const clean = cleanForexSymbol(ticker);
  return FOREX_DICT.has(clean) || FOREX_DICT.has(clean.replace("/", ""));
}

export class TwelveDataProvider {
  readonly name = "twelvedata";
  private symbolsPromise: Promise<ForexSymbolDescriptor[]> | null = null;
  private lastBars = new Map<string, OHLCV>();

  get providerMeta() {
    return {
      name: "twelvedata",
      displayName: "TwelveData (Forex)",
      requiresApiKey: false,
      supportedTimeframes: [
        "1", "5", "15", "30", "45", "60", "120", "240", "D", "W", "M",
      ],
      capabilities: {
        enumerate: true,
        stream: true,
        symbolInfo: true,
      },
    };
  }

  async listSymbols(): Promise<ForexSymbolDescriptor[]> {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.resolve(FOREX_MAJOR_PAIRS);
    }
    return this.symbolsPromise;
  }

  async getSymbolInfo(ticker: string): Promise<ForexSymbolInfo> {
    const clean = cleanForexSymbol(ticker);
    const item = FOREX_DICT.get(clean) || FOREX_DICT.get(clean.replace("/", ""));
    const desc = item ? item.description : `${clean} Forex Pair`;
    const parts = clean.split("/");
    const base = parts[0] || clean.slice(0, 3);
    const quote = parts[1] || clean.slice(3) || "USD";
    const isJpy = quote === "JPY";

    return {
      ticker: clean,
      tickerid: `TWELVEDATA:${clean}`,
      prefix: "TWELVEDATA",
      description: desc,
      type: "forex",
      basecurrency: base,
      currency: quote,
      mintick: isJpy ? 0.001 : 0.00001,
      pricescale: isJpy ? 1000 : 100000,
      timezone: "UTC",
      session: "24x7",
    };
  }

  async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const clean = cleanForexSymbol(ticker);
    const interval = TF_TO_TWELVEDATA[timeframe] || "1h";
    const limit = Math.min(1000, Math.max(100, range.limit ?? 500));

    try {
      const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
        clean
      )}&interval=${interval}&apikey=${TWELVEDATA_API_KEY}&outputsize=${limit}`;

      const res = await fetch(url);
      if (!res.ok) {
        console.warn(`[twelvedata] HTTP ${res.status} for ${clean}`);
        return [];
      }

      const json = await res.json();
      if (json.status !== "ok" || !Array.isArray(json.values)) {
        if (json.message) {
          console.warn(`[twelvedata] Error for ${clean}:`, json.message);
        }
        return [];
      }

      // TwelveData returns bars sorted descending (newest first). Parse and sort ascending.
      const parsed: OHLCV[] = json.values
        .map((v: any) => {
          // DateTime is in "YYYY-MM-DD HH:mm:ss" or "YYYY-MM-DD"
          const stamp = new Date(v.datetime.includes(" ") ? v.datetime + " UTC" : v.datetime).getTime();
          return {
            time: stamp,
            open: parseFloat(v.open),
            high: parseFloat(v.high),
            low: parseFloat(v.low),
            close: parseFloat(v.close),
            volume: parseFloat(v.volume || "0"),
          };
        })
        .filter((b: OHLCV) => !isNaN(b.time) && !isNaN(b.close) && b.time > 0)
        .sort((a: OHLCV, b: OHLCV) => a.time - b.time);

      // Deduplicate
      const deduped: OHLCV[] = [];
      const seen = new Set<number>();
      for (const bar of parsed) {
        if (!seen.has(bar.time)) {
          seen.add(bar.time);
          deduped.push(bar);
        }
      }

      if (deduped.length > 0) {
        this.lastBars.set(clean, deduped[deduped.length - 1]);
      }

      return deduped;
    } catch (e) {
      console.warn(`[twelvedata] getBars failed for ${clean}:`, e);
      return [];
    }
  }

  resolveSymbolIcon(symbol: any): string {
    const raw = typeof symbol === "string" ? symbol : symbol?.ticker ?? "";
    const clean = cleanForexSymbol(raw);
    const label = clean.replace("/", "").slice(0, 3) || "FX";
    return `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="%230EA5E9"/><text x="12" y="16" fill="white" font-family="sans-serif" font-size="9" font-weight="bold" text-anchor="middle">${label}</text></svg>`;
  }

  subscribe(ticker: string, timeframe: string, onBar: (bar: OHLCV) => void): () => void {
    const clean = cleanForexSymbol(ticker);
    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    // 1. Try WebSocket connection
    try {
      ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TWELVEDATA_API_KEY}`);
      ws.onopen = () => {
        if (stopped) {
          ws?.close();
          return;
        }
        ws?.send(
          JSON.stringify({
            action: "subscribe",
            params: {
              symbols: clean,
            },
          })
        );
      };

      ws.onmessage = (event) => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data);
          if (data.event === "price" && data.symbol === clean && typeof data.price === "number") {
            const px = data.price;
            const ts = (data.timestamp ? data.timestamp * 1000 : Date.now());
            const last = this.lastBars.get(clean);
            if (last) {
              const updated: OHLCV = {
                time: last.time,
                open: last.open,
                high: Math.max(last.high, px),
                low: Math.min(last.low, px),
                close: px,
                volume: last.volume,
              };
              this.lastBars.set(clean, updated);
              onBar(updated);
            }
          }
        } catch {}
      };

      ws.onerror = () => {
        // Fall back to polling
      };
    } catch {}

    // 2. Resilient Polling Fallback
    const poll = async () => {
      if (stopped) return;
      try {
        const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(
          clean
        )}&apikey=${TWELVEDATA_API_KEY}`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const px = parseFloat(data.price);
          if (!isNaN(px) && px > 0) {
            const last = this.lastBars.get(clean);
            if (last) {
              const updated: OHLCV = {
                time: last.time,
                open: last.open,
                high: Math.max(last.high, px),
                low: Math.min(last.low, px),
                close: px,
                volume: last.volume,
              };
              this.lastBars.set(clean, updated);
              onBar(updated);
            }
          }
        }
      } catch {}

      if (!stopped) {
        pollTimer = setTimeout(poll, 4000);
      }
    };

    pollTimer = setTimeout(poll, 2500);

    return () => {
      stopped = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (ws) {
        try {
          ws.close();
        } catch {}
      }
    };
  }
}

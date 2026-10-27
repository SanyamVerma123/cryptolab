import {
  HyperliquidProvider,
} from "@luxalgo/vela/providers/hyperliquid";
import type { OHLCV, BarRange } from "@luxalgo/vela/plugin";

const REQUEST_TIMEOUT_MS = 12_000;
const HISTORY_PAGE_SIZE = 1_000;
const MAX_HISTORY_BARS = 30_000;

/**
 * Vela's built-in provider can wait indefinitely on a stalled HTTP request.
 * Bound history/metadata requests so one Hyperliquid market cannot leave the
 * workspace's initial load pending forever. Live candle streams still use the
 * provider's own reconnect/fallback behavior.
 */
export class SafeHyperliquidProvider extends HyperliquidProvider {
  private readonly historyCache = new Map<string, {
    bars: Map<number, OHLCV>;
    oldest: number;
  }>();

  override async getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    const canonicalTf = normalizeVelaTf(timeframe);
    // A `from` range is Vela's incremental refresh for already loaded bars.
    // Preserve that direct lookup. Initial loads and larger `limit` requests
    // are paged backward because candleSnapshot only returns a bounded window.
    if (range.from != null || range.limit == null || range.limit <= HISTORY_PAGE_SIZE) {
      return withTimeout(
        super.getBars(ticker, canonicalTf, range),
        [],
        `history ${ticker} ${canonicalTf}`,
      );
    }

    const limit = Math.min(Math.floor(range.limit), MAX_HISTORY_BARS);
    const intervalMs = timeframeMilliseconds(canonicalTf);
    const requestedEnd = range.to ?? Date.now();
    const historyStart = Math.max(0, requestedEnd - (limit + 2) * intervalMs);
    const cacheKey = `${ticker.toUpperCase()}|${canonicalTf.toUpperCase()}`;
    let cached = this.historyCache.get(cacheKey);
    if (!cached) {
      cached = { bars: new Map<number, OHLCV>(), oldest: Number.POSITIVE_INFINITY };
      this.historyCache.set(cacheKey, cached);
    }

    // Reuse prior pages on each scroll. Only fetch the next older page instead
    // of re-downloading all recent candles every time Vela raises its limit.
    let pageEnd = cached.bars.size
      ? Math.min(requestedEnd, cached.oldest - 1)
      : requestedEnd;
    let pages = 0;

    // Fetch in bounded 1k-bar windows from newest to oldest, like the
    // Binance provider. Stop on the first empty/non-progressing page (for
    // example, when this market predates the symbol's listing on Hyperliquid).
    while (
      pageEnd > historyStart &&
      pages < Math.ceil((limit + 2) / HISTORY_PAGE_SIZE) + 1
    ) {
      const pageStart = Math.max(historyStart, pageEnd - (HISTORY_PAGE_SIZE - 1) * intervalMs);
      const page = await withTimeout(
        super.getBars(ticker, canonicalTf, { from: pageStart, to: pageEnd, limit: HISTORY_PAGE_SIZE }),
        [],
        `history page ${ticker} ${canonicalTf}`,
      );
      pages += 1;
      if (!page.length) break;

      const sorted = page.slice().sort((a, b) => a.time - b.time);
      for (const bar of sorted) cached.bars.set(bar.time, bar);
      const oldest = sorted[0]?.time;
      if (typeof oldest !== "number" || oldest >= pageEnd) break;
      cached.oldest = Math.min(cached.oldest, oldest);
      pageEnd = oldest - 1;
      if (oldest <= historyStart) break;
    }

    if (cached.bars.size > MAX_HISTORY_BARS) {
      const retained = [...cached.bars.values()].sort((a, b) => a.time - b.time).slice(-MAX_HISTORY_BARS);
      cached.bars = new Map(retained.map((bar) => [bar.time, bar]));
      cached.oldest = retained[0]?.time ?? Number.POSITIVE_INFINITY;
    }

    return [...cached.bars.values()]
      .filter((bar) => bar.time <= requestedEnd)
      .sort((a, b) => a.time - b.time)
      .slice(-limit);
  }

  override getSymbolInfo(ticker: string): ReturnType<HyperliquidProvider["getSymbolInfo"]> {
    return withTimeout(super.getSymbolInfo(ticker), undefined, `metadata ${ticker}`);
  }
}

function timeframeMilliseconds(timeframe: string): number {
  const normalized = timeframe.trim().toUpperCase();
  if (normalized === "D" || normalized === "1D") return 24 * 60 * 60 * 1000;
  if (normalized === "W" || normalized === "1W") return 7 * 24 * 60 * 60 * 1000;
  if (normalized === "M" || normalized === "1M") return 30 * 24 * 60 * 60 * 1000;

  if (normalized.endsWith("H")) {
    const hours = Number.parseInt(normalized, 10);
    if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  }
  if (normalized.endsWith("M") && normalized !== "M") {
    const mins = Number.parseInt(normalized, 10);
    if (Number.isFinite(mins) && mins > 0) return mins * 60 * 1000;
  }

  const minutes = Number.parseInt(normalized, 10);
  return Number.isFinite(minutes) && minutes > 0 ? minutes * 60 * 1000 : 60 * 60 * 1000;
}

export function normalizeVelaTf(tf: string): string {
  const s = tf.trim().toUpperCase();
  if (s === "1H" || s === "60M") return "60";
  if (s === "2H" || s === "120M") return "120";
  if (s === "3H" || s === "180M") return "180";
  if (s === "4H" || s === "240M") return "240";
  if (s === "6H" || s === "360M") return "360";
  if (s === "8H" || s === "480M") return "480";
  if (s === "12H" || s === "720M") return "720";
  if (s === "1D" || s === "D") return "D";
  if (s === "1W" || s === "W") return "W";
  if (s === "1M" || s === "M") return "M";
  if (s.endsWith("M")) {
    const n = parseInt(s, 10);
    if (Number.isFinite(n) && n > 0) return String(n);
  }
  return tf;
}

function withTimeout<T>(request: Promise<T>, fallback: T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`[trade-pro] Hyperliquid ${label} request timed out; keeping the workspace responsive.`);
      resolve(fallback);
    }, REQUEST_TIMEOUT_MS);

    request.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.warn(`[trade-pro] Hyperliquid ${label} request failed:`, error);
        resolve(fallback);
      },
    );
  });
}

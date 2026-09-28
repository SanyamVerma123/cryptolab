/**
 * marketData — the ONE place the chart's live bars live for AI + drawing code.
 *
 * WHY: Vela owns the canonical bar array internally but does not expose a
 * host-facing "give me the bars" accessor (`DataControl` is a provider
 * registry, not a bar reader). The app's own Hyperliquid provider, however,
 * is the exact same source Vela loads from — so we fetch history once, then
 * keep it live via the provider's real WebSocket `subscribe()` stream.
 *
 * The user's complaint was that the AI kept saying "let the data load" and
 * never marked anything. Root cause: `visibleBars()` read a non-existent
 * `market.snapshot()` and always returned `[]`. This store fixes that — it
 * has real bars before the AI is ever asked to draw.
 *
 * Usage:
 *   const stop = mountMarket(ws, { symbol, timeframe })
 *   const bars = liveBars()          // OHLCV[], oldest→newest
 *   // later: stop()
 */
import { HyperliquidProvider } from "@luxalgo/vela/providers/hyperliquid";
// OHLCV/BarRange are re-exported through the package root's types.
import type { OHLCV, BarRange } from "@luxalgo/vela";

const provider = new HyperliquidProvider();

/** The live bar array — replaced wholesale on each refresh (stable reference
 *  for the AI's context, so React closures don't go stale). */
let bars: OHLCV[] = [];
let unsub: (() => void) | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let mounted: { symbol: string; timeframe: string } | null = null;

let currentLivePrice = 0;
let currentCandleHigh = 0;
let currentCandleLow = 0;
const priceListeners = new Set<(price: number, high?: number, low?: number) => void>();

/** Get the latest live market price matching the chart candle ticks */
export function getLiveMarketPrice(): number {
  if (currentLivePrice > 0) return currentLivePrice;
  const last = bars[bars.length - 1];
  return last?.close || 0;
}

/** Get the forming candle's price, high, and low */
export function getLiveCandleRange(): { price: number; high: number; low: number } | null {
  const last = bars[bars.length - 1];
  if (!last && currentLivePrice <= 0) return null;
  const p = currentLivePrice || last?.close || 0;
  const h = Math.max(currentCandleHigh || p, last?.high || p, p);
  const l = Math.min(currentCandleLow || p, last?.low || p, p);
  return { price: p, high: h, low: l };
}

/** Subscribe to fast live price ticks streamed directly from WebSocket candles */
export function subscribeLivePrice(listener: (price: number, high?: number, low?: number) => void): () => void {
  priceListeners.add(listener);
  const r = getLiveCandleRange();
  if (r && r.price > 0) {
    listener(r.price, r.high, r.low);
  }
  return () => {
    priceListeners.delete(listener);
  };
}

/** Bars the chart is showing right now (oldest → newest). Empty until loaded. */
export function liveBars(): OHLCV[] {
  // Debug hook so the chart panel (and this agent's browser checks) can read
  // the store without a React re-render round-trip.
  if (typeof window !== "undefined") {
    (window as unknown as { __bars?: number }).__bars = bars.length;
  }
  return bars;
}

/** True once history has landed (guards "wait for data" paths). */
export function hasBars(): boolean {
  return bars.length > 0;
}

/**
 * The bars currently ON SCREEN — the slice of the live array inside the
 * chart's visible time range.
 *
 * The user's complaint: FVGs and trend lines were being marked "in the past"
 * at positions they couldn't see, because the AI was handed ALL ~1500 bars.
 * Now it only sees what's on screen, so every mark lands where the user is
 * actually looking.
 */
export function visibleBarsInRange(
  range: { from: number; to: number } | null,
): OHLCV[] {
  if (!range || !bars.length) return bars.slice(-120);
  const slice = bars.filter((b) => b.time >= range.from && b.time <= range.to);
  // If the range is degenerate (e.g. fresh load), fall back to the tail.
  return slice.length > 5 ? slice : bars.slice(-120);
}

/**
 * Load the same history Vela loads, straight from the provider.
 * ~5000 candles is Hyperliquid's cap — plenty for FVGs and S/R.
 */
async function loadHistory(symbol: string, timeframe: string): Promise<void> {
  try {
    const range: BarRange = { limit: 1500 };
    const got = await provider.getBars(symbol, timeframe, range);
    // Newest last — the AI + FVG detection both assume ascending time.
    bars = got.slice().sort((a, b) => a.time - b.time);
    if (bars.length > 0) {
      const last = bars[bars.length - 1];
      currentLivePrice = last.close;
      currentCandleHigh = last.high;
      currentCandleLow = last.low;
      priceListeners.forEach((l) => l(last.close, last.high, last.low));
    }
  } catch (e) {
    console.warn("[trade-pro] marketData load failed:", e);
    bars = [];
  }
}

/**
 * Mount a market: load its history, then keep it live with the provider's
 * WebSocket candle stream. Returns a stop() disposer.
 */
export function mountMarket(
  _ws: unknown,
  cfg: { symbol: string; timeframe: string },
): () => void {
  const { symbol, timeframe } = cfg;
  // Teardown any previous market before starting the next.
  teardown();

  mounted = { symbol, timeframe };
  void loadHistory(symbol, timeframe);

  // Live ticks: the forming bar updates and each closed bar is appended.
  try {
    unsub = provider.subscribe(symbol, timeframe, (bar) => {
      pushBar(bar);
    });
  } catch (e) {
    console.warn("[trade-pro] live subscribe failed, polling instead:", e);
  }

  // Safety net: if the socket silently dies, a slow poll keeps bars fresh.
  // (Two sources agreeing is harmless — pushBar is idempotent by time.)
  pollTimer = setInterval(() => {
    if (mounted) void loadHistory(mounted.symbol, mounted.timeframe);
  }, 30_000);

  return teardown;

  function teardown() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (unsub) {
      try {
        unsub();
      } catch {
        /* already unsubscribed */
      }
      unsub = null;
    }
    mounted = null;
    bars = [];
    currentLivePrice = 0;
    currentCandleHigh = 0;
    currentCandleLow = 0;
  }
}

/** Merge a live bar into the array (upsert by open time). */
function pushBar(bar: OHLCV): void {
  currentLivePrice = bar.close;
  currentCandleHigh = bar.high;
  currentCandleLow = bar.low;
  priceListeners.forEach((l) => l(bar.close, bar.high, bar.low));

  const last = bars[bars.length - 1];
  if (last && last.time === bar.time) {
    // The forming bar — replace in place.
    bars[bars.length - 1] = bar;
    return;
  }
  if (last && bar.time < last.time) {
    // An older bar arriving out of order — drop it (already closed in history).
    return;
  }
  bars.push(bar);
  // Keep the window bounded so memory doesn't grow forever.
  if (bars.length > 5000) bars = bars.slice(-5000);
}

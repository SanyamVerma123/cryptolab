import {
  HyperliquidProvider,
} from "@luxalgo/vela/providers/hyperliquid";
import type { OHLCV, BarRange } from "@luxalgo/vela/plugin";

const REQUEST_TIMEOUT_MS = 12_000;

/**
 * Vela's built-in provider can wait indefinitely on a stalled HTTP request.
 * Bound history/metadata requests so one Hyperliquid market cannot leave the
 * workspace's initial load pending forever. Live candle streams still use the
 * provider's own reconnect/fallback behavior.
 */
export class SafeHyperliquidProvider extends HyperliquidProvider {
  override getBars(ticker: string, timeframe: string, range: BarRange): Promise<OHLCV[]> {
    return withTimeout(
      super.getBars(ticker, timeframe, range),
      [],
      `history ${ticker} ${timeframe}`,
    );
  }

  override getSymbolInfo(ticker: string): ReturnType<HyperliquidProvider["getSymbolInfo"]> {
    return withTimeout(super.getSymbolInfo(ticker), undefined, `metadata ${ticker}`);
  }
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

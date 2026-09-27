/**
 * Alpaca Trading API Client & Bracket Order Service
 *
 * Supports Paper & Live trading with Alpaca API Keys.
 * Handles primary entry orders, Take Profit (TP), and Stop Loss (SL) brackets,
 * live positions, and account balances.
 */

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  isPaper: boolean;
}

const STORAGE_KEY = "tradepro_alpaca_config_v1";

const DEFAULT_CONFIG: AlpacaConfig = {
  keyId: "",
  secretKey: "",
  isPaper: true,
};

export function getAlpacaConfig(): AlpacaConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveAlpacaConfig(cfg: AlpacaConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("alpaca-config-changed", { detail: cfg }));
    }
  } catch (e) {
    console.warn("[trade-pro] saving alpaca config failed:", e);
  }
}

export function getAlpacaBaseUrl(isPaper = true): string {
  return isPaper ? "https://paper-api.alpaca.markets" : "https://api.alpaca.markets";
}

export const ALPACA_DATA_URL = "https://data.alpaca.markets";

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  qty: string;
  side: "long" | "short";
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  current_price: string;
  avg_entry_price: string;
}

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  created_at: string;
  updated_at: string;
  submitted_at: string;
  filled_at: string | null;
  symbol: string;
  qty: string;
  filled_qty: string;
  type: string;
  side: "buy" | "sell";
  time_in_force: string;
  limit_price: string | null;
  stop_price: string | null;
  status: string;
  legs?: AlpacaOrder[];
}

export async function alpacaFetch<T = any>(
  path: string,
  options: RequestInit = {},
  customBaseUrl?: string
): Promise<{ ok: boolean; data?: T; error?: string }> {
  const cfg = getAlpacaConfig();
  if (!cfg.keyId || !cfg.secretKey) {
    return { ok: false, error: "Alpaca API Key and Secret are not configured." };
  }

  const baseUrl = customBaseUrl || getAlpacaBaseUrl(cfg.isPaper);
  const targetUrl = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    "APCA-API-KEY-ID": cfg.keyId.trim(),
    "APCA-API-SECRET-KEY": cfg.secretKey.trim(),
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };

  try {
    // Attempt direct API request
    const res = await fetch(targetUrl, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errText = await res.text();
      let parsed = errText;
      try {
        const j = JSON.parse(errText);
        parsed = j.message || j.error || errText;
      } catch {}
      return { ok: false, error: parsed };
    }

    const data = await res.json();
    return { ok: true, data };
  } catch (err: any) {
    // If browser CORS prevents direct fetch, try backend proxy fallback
    try {
      const proxyRes = await fetch("/alpaca/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: targetUrl,
          method: options.method || "GET",
          headers,
          body: options.body,
        }),
      });
      if (proxyRes.ok) {
        const data = await proxyRes.json();
        return { ok: true, data };
      }
    } catch {}

    return { ok: false, error: err?.message || "Network request to Alpaca failed (CORS/Offline)" };
  }
}

/** Test Alpaca API credentials by fetching account details */
export async function testAlpacaConnection(): Promise<{ ok: boolean; account?: AlpacaAccount; error?: string }> {
  const res = await alpacaFetch<AlpacaAccount>("/v2/account");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, account: res.data };
}

/** Get list of open positions */
export async function getAlpacaPositions(): Promise<{ ok: boolean; positions?: AlpacaPosition[]; error?: string }> {
  const res = await alpacaFetch<AlpacaPosition[]>("/v2/positions");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, positions: res.data ?? [] };
}

/** Get list of active orders */
export async function getAlpacaOrders(): Promise<{ ok: boolean; orders?: AlpacaOrder[]; error?: string }> {
  const res = await alpacaFetch<AlpacaOrder[]>("/v2/orders?status=open&nested=true");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data ?? [] };
}

/** Place order with optional Take Profit (TP) and Stop Loss (SL) brackets */
export async function submitAlpacaOrder(params: {
  symbol: string; // e.g. "BTC/USD"
  qty: number;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_limit";
  limitPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
  timeInForce?: "gtc" | "day" | "ioc";
}): Promise<{ ok: boolean; order?: AlpacaOrder; error?: string }> {
  const { symbol, qty, side, type, limitPrice, takeProfitPrice, stopLossPrice, timeInForce = "gtc" } = params;

  // Format symbol (Alpaca crypto format is BTC/USD)
  const formattedSymbol = symbol.includes("/") ? symbol : `${symbol}/USD`;

  const payload: any = {
    symbol: formattedSymbol,
    qty: String(qty),
    side,
    type,
    time_in_force: timeInForce,
  };

  if (type === "limit" && limitPrice) {
    payload.limit_price = String(limitPrice);
  }

  // Bracket orders: Take Profit and/or Stop Loss
  if (takeProfitPrice || stopLossPrice) {
    payload.order_class = "bracket";
    if (takeProfitPrice) {
      payload.take_profit = { limit_price: String(takeProfitPrice) };
    }
    if (stopLossPrice) {
      payload.stop_loss = { stop_price: String(stopLossPrice) };
    }
  }

  const res = await alpacaFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, order: res.data };
}

/** Cancel active Alpaca order */
export async function cancelAlpacaOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await alpacaFetch(`/v2/orders/${orderId}`, {
    method: "DELETE",
  });
  return { ok: res.ok, error: res.error };
}

/** Close active Alpaca position */
export async function closeAlpacaPosition(symbol: string): Promise<{ ok: boolean; error?: string }> {
  const formattedSymbol = symbol.includes("/") ? symbol.replace("/", "%2F") : `${symbol}%2FUSD`;
  const res = await alpacaFetch(`/v2/positions/${formattedSymbol}`, {
    method: "DELETE",
  });
  return { ok: res.ok, error: res.error };
}

export interface AlpacaQuote {
  ap: number; // ask price
  as: number; // ask size
  bp: number; // bid price
  bs: number; // bid size
  t: string;  // timestamp
}

export interface AlpacaBar {
  c: number;
  h: number;
  l: number;
  o: number;
  v: number;
  t: string;
}

/** Get latest quote from Alpaca Crypto Market Data API */
export async function getAlpacaLatestQuote(
  symbol: string
): Promise<{ ok: boolean; quote?: AlpacaQuote; error?: string }> {
  const formattedSymbol = symbol.includes("/") ? symbol : `${symbol}/USD`;
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ quotes: Record<string, AlpacaQuote> }>(
    `/v2/crypto/latest/quotes?symbols=${symParam}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const q = res.data?.quotes?.[formattedSymbol];
  return { ok: true, quote: q };
}

/** Get latest orderbook from Alpaca Crypto Market Data API */
export async function getAlpacaLatestOrderBook(
  symbol: string
): Promise<{ ok: boolean; orderbook?: { b: { p: number; s: number }[]; a: { p: number; s: number }[] }; error?: string }> {
  const formattedSymbol = symbol.includes("/") ? symbol : `${symbol}/USD`;
  const res = await alpacaFetch<{ orderbooks: Record<string, { b: any[]; a: any[] }> }>(
    `/v2/crypto/latest/orderbooks?symbols=${encodeURIComponent(formattedSymbol)}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const ob = res.data?.orderbooks?.[formattedSymbol];
  return { ok: true, orderbook: ob };
}

/** Get latest 1-min bars from Alpaca Crypto Market Data API */
export async function getAlpacaLatestBars(
  symbol: string
): Promise<{ ok: boolean; bar?: AlpacaBar; error?: string }> {
  const formattedSymbol = symbol.includes("/") ? symbol : `${symbol}/USD`;
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ bars: Record<string, AlpacaBar> }>(
    `/v2/crypto/latest/bars?symbols=${symParam}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const b = res.data?.bars?.[formattedSymbol];
  return { ok: true, bar: b };
}

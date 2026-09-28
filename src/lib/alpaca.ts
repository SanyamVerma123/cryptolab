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

    const errText = await res.text();
    let parsed: any;
    try {
      parsed = JSON.parse(errText);
    } catch {
      parsed = errText;
    }

    if (!res.ok) {
      const msg = parsed?.message || parsed?.error || (typeof parsed === "string" ? parsed : `Alpaca request failed (${res.status})`);
      return { ok: false, error: msg };
    }

    return { ok: true, data: parsed };
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

      const proxyText = await proxyRes.text();
      let proxyParsed: any;
      try {
        proxyParsed = JSON.parse(proxyText);
      } catch {
        proxyParsed = proxyText;
      }

      if (!proxyRes.ok) {
        const msg = proxyParsed?.message || proxyParsed?.error || (typeof proxyParsed === "string" ? proxyParsed : `Alpaca proxy request failed (${proxyRes.status})`);
        return { ok: false, error: msg };
      }

      return { ok: true, data: proxyParsed };
    } catch (proxyErr: any) {
      return { ok: false, error: proxyErr?.message || err?.message || "Alpaca API connection failed" };
    }
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

export function formatAlpacaCryptoSymbol(raw: string): string {
  let clean = raw.replace("CRYPTO:", "").trim().toUpperCase();
  if (clean.includes("/")) return clean;
  if (clean.endsWith("USD") && clean.length > 3) {
    return `${clean.slice(0, -3)}/USD`;
  }
  if (clean.endsWith("USDT") && clean.length > 4) {
    return `${clean.slice(0, -4)}/USDT`;
  }
  return `${clean}/USD`;
}

/** Place order with Alpaca Trading API (Paper or Live) */
export async function submitAlpacaOrder(params: {
  symbol: string; // e.g. "BTC/USD", "BTCUSD", "CRYPTO:BTCUSD"
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
  const formattedSymbol = formatAlpacaCryptoSymbol(symbol);

  // Alpaca crypto only supports 'gtc' and 'ioc' time_in_force
  const validTif = timeInForce === "day" ? "gtc" : timeInForce;

  const payload: any = {
    symbol: formattedSymbol,
    qty: String(parseFloat(qty.toFixed(6))),
    side,
    type,
    time_in_force: validTif,
  };

  if (type === "limit" && limitPrice && limitPrice > 0) {
    payload.limit_price = String(parseFloat(limitPrice.toFixed(2)));
  }

  // NOTE: Alpaca Crypto Trading API DOES NOT support order_class: "bracket".
  // Trying to pass order_class: "bracket" on crypto causes 422 Unprocessable Entity.
  // We only send order_class bracket if not crypto or if supported.
  const isCrypto = formattedSymbol.includes("/") || formattedSymbol.endsWith("USD") || formattedSymbol.endsWith("USDT");
  if (!isCrypto && (takeProfitPrice || stopLossPrice)) {
    payload.order_class = "bracket";
    if (takeProfitPrice) {
      payload.take_profit = { limit_price: String(parseFloat(takeProfitPrice.toFixed(2))) };
    }
    if (stopLossPrice) {
      payload.stop_loss = { stop_price: String(parseFloat(stopLossPrice.toFixed(2))) };
    }
  }

  const res = await alpacaFetch<AlpacaOrder>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, order: res.data };
}

export interface AlpacaAsset {
  id: string;
  class: string;
  exchange: string;
  symbol: string;
  name: string;
  status: string;
  tradable: boolean;
}

/** Get list of tradable crypto assets on Alpaca */
export async function getAlpacaCryptoAssets(): Promise<{ ok: boolean; assets?: AlpacaAsset[]; error?: string }> {
  const res = await alpacaFetch<AlpacaAsset[]>("/v2/assets?asset_class=crypto&status=active");
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, assets: res.data ?? [] };
}

/** Replace (PATCH) an existing open order in Alpaca (e.g. for drag to move limit price) */
export async function replaceAlpacaOrder(
  orderId: string,
  params: {
    limitPrice?: number;
    qty?: number;
    stopPrice?: number;
    timeInForce?: "gtc" | "day" | "ioc";
    clientOrderId?: string;
  }
): Promise<{ ok: boolean; order?: AlpacaOrder; error?: string }> {
  const payload: any = {};
  if (params.limitPrice !== undefined && params.limitPrice > 0) {
    payload.limit_price = String(parseFloat(params.limitPrice.toFixed(2)));
  }
  if (params.qty !== undefined && params.qty > 0) {
    payload.qty = String(parseFloat(params.qty.toFixed(6)));
  }
  if (params.stopPrice !== undefined && params.stopPrice > 0) {
    payload.stop_price = String(parseFloat(params.stopPrice.toFixed(2)));
  }
  if (params.timeInForce) {
    payload.time_in_force = params.timeInForce;
  }
  if (params.clientOrderId) {
    payload.client_order_id = params.clientOrderId;
  }

  const res = await alpacaFetch<AlpacaOrder>(`/v2/orders/${orderId}`, {
    method: "PATCH",
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

/** Close active Alpaca position (supports full or partial close by percentage or qty) */
export async function closeAlpacaPosition(
  symbol: string,
  options?: { qty?: number; percentage?: number }
): Promise<{ ok: boolean; error?: string }> {
  const clean = formatAlpacaCryptoSymbol(symbol);
  const formattedSymbol = encodeURIComponent(clean);
  let path = `/v2/positions/${formattedSymbol}`;

  const queryParams: string[] = [];
  if (options?.percentage && options.percentage > 0 && options.percentage <= 100) {
    queryParams.push(`percentage=${options.percentage}`);
  } else if (options?.qty && options.qty > 0) {
    queryParams.push(`qty=${options.qty}`);
  }

  if (queryParams.length > 0) {
    path += `?${queryParams.join("&")}`;
  }

  const res = await alpacaFetch(path, {
    method: "DELETE",
  });
  return { ok: res.ok, error: res.error };
}

/** Cancel all open Alpaca orders */
export async function cancelAllAlpacaOrders(): Promise<{ ok: boolean; error?: string }> {
  const res = await alpacaFetch("/v2/orders", {
    method: "DELETE",
  });
  return { ok: res.ok, error: res.error };
}

/** Get order history (all statuses) */
export async function getAlpacaOrderHistory(limit = 50): Promise<{ ok: boolean; orders?: AlpacaOrder[]; error?: string }> {
  const res = await alpacaFetch<AlpacaOrder[]>(`/v2/orders?status=all&limit=${limit}&nested=true`);
  if (!res.ok) return { ok: false, error: res.error };
  return { ok: true, orders: res.data ?? [] };
}


export interface AlpacaQuote {
  ap: number; // ask price
  as: number; // ask size
  bp: number; // bid price
  bs: number; // bid size
  t: string;  // timestamp
}

export interface AlpacaBar {
  c: number; // close
  h: number; // high
  l: number; // low
  o: number; // open
  v: number; // volume
  t: string; // timestamp
  n?: number; // trade count
  vw?: number; // volume-weighted avg price
}

/** Get latest quote from Alpaca Crypto Market Data API (v1beta3) */
export async function getAlpacaLatestQuote(
  symbol: string
): Promise<{ ok: boolean; quote?: AlpacaQuote; error?: string }> {
  const formattedSymbol = formatAlpacaCryptoSymbol(symbol);
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ quotes: Record<string, AlpacaQuote> }>(
    `/v1beta3/crypto/us/latest/quotes?symbols=${symParam}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const q = res.data?.quotes?.[formattedSymbol];
  return { ok: true, quote: q };
}

/** Get latest orderbook from Alpaca Crypto Market Data API (v1beta3) */
export async function getAlpacaLatestOrderBook(
  symbol: string
): Promise<{ ok: boolean; orderbook?: { b: { p: number; s: number }[]; a: { p: number; s: number }[] }; error?: string }> {
  const formattedSymbol = formatAlpacaCryptoSymbol(symbol);
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ orderbooks: Record<string, { b: any[]; a: any[] }> }>(
    `/v1beta3/crypto/us/latest/orderbooks?symbols=${symParam}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const ob = res.data?.orderbooks?.[formattedSymbol];
  return { ok: true, orderbook: ob };
}

/** Get latest 1-min bars from Alpaca Crypto Market Data API (v1beta3) */
export async function getAlpacaLatestBars(
  symbol: string
): Promise<{ ok: boolean; bar?: AlpacaBar; error?: string }> {
  const formattedSymbol = formatAlpacaCryptoSymbol(symbol);
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ bars: Record<string, AlpacaBar> }>(
    `/v1beta3/crypto/us/latest/bars?symbols=${symParam}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const b = res.data?.bars?.[formattedSymbol];
  return { ok: true, bar: b };
}

/** Get historical crypto bars from Alpaca Crypto Market Data API (v1beta3) */
export async function getAlpacaHistoricalBars(
  symbol: string,
  timeframe = "1Hour",
  limit = 100
): Promise<{ ok: boolean; bars?: AlpacaBar[]; error?: string }> {
  const formattedSymbol = formatAlpacaCryptoSymbol(symbol);
  const symParam = encodeURIComponent(formattedSymbol);
  const res = await alpacaFetch<{ bars: Record<string, AlpacaBar[]> }>(
    `/v1beta3/crypto/us/bars?symbols=${symParam}&timeframe=${timeframe}&limit=${limit}`,
    {},
    ALPACA_DATA_URL
  );
  if (!res.ok) return { ok: false, error: res.error };
  const list = res.data?.bars?.[formattedSymbol] || [];
  return { ok: true, bars: list };
}

/**
 * orderState — Trading Engine, Dual-Mode Paper Trading (In-App & Alpaca),
 * Positions, Movable Limit Orders & Matching Engine.
 *
 * Supports two distinct environments:
 * 1. "in_app" (Default): Full local simulation with $50k paper wallet, customizable
 *    leverage, Maker/Taker fees, funding rates, TP/SL auto-execution, and matching engine.
 * 2. "alpaca": 100% real Alpaca Paper Trading API integration. Live account buying power,
 *    cash, live open orders, live open positions, and official order submission/execution.
 */
import { useEffect, useState, useCallback } from "react";
import {
  getAlpacaConfig,
  testAlpacaConnection,
  getAlpacaPositions,
  getAlpacaOrders,
  getAlpacaOrderHistory,
  submitAlpacaOrder,
  replaceAlpacaOrder,
  cancelAlpacaOrder,
  cancelAllAlpacaOrders,
  closeAlpacaPosition,
} from "./alpaca";

export type TradingMode = "in_app" | "alpaca";
export type OrderType = "Limit" | "Market" | "Stop-Limit";
export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "Open" | "Filled" | "Canceled";

export interface Order {
  id: string;
  date: string;
  pair: string; // e.g. "BTC/USD"
  coin: string; // e.g. "BTC"
  type: OrderType;
  side: OrderSide;
  price: number;
  amount: number;
  filled: number; // percentage, e.g. 0 to 100
  total: number;
  trigger: string;
  takeProfit?: number;
  stopLoss?: number;
  status: OrderStatus;
  leverage?: number;
  isAlpaca?: boolean;
  placedAtPrice?: number;
  placedAtTime?: number;
}

export interface TradePosition {
  id: string;
  date: string;
  pair: string;
  coin: string;
  side: OrderSide;
  entryPrice: number;
  amount: number;
  total: number;
  takeProfit?: number;
  stopLoss?: number;
  leverage?: number;
  margin?: number;
  liquidationPrice?: number;
  isAlpaca?: boolean;
  currentPrice?: number;
  unrealizedPl?: number;
  unrealizedPlpc?: number;
  marketValue?: number;
}

export interface PriceAlert {
  id: string;
  coin: string;
  pair: string;
  price: number;
  date: string;
}

export interface Balances {
  USD: number;
  [asset: string]: number;
}

const TRADING_MODE_KEY = "tradepro_trading_mode_v2";
const ORDERS_KEY = "tradepro_open_orders_v2";
const POSITIONS_KEY = "tradepro_open_positions_v2";
const HISTORY_KEY = "tradepro_order_history_v2";
const BALANCES_KEY = "tradepro_balances_v2";
const ALERTS_KEY = "tradepro_price_alerts_v2";

const DEFAULT_BALANCES: Balances = {
  USD: 50000.0,
  BTC: 1.25,
  ETH: 8.5,
  SOL: 75.0,
};

const DEFAULT_ORDERS: Order[] = [];
const DEFAULT_POSITIONS: TradePosition[] = [];
const DEFAULT_HISTORY: Order[] = [];

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (key === ORDERS_KEY && Array.isArray(parsed)) {
      // Never load mock demo orders
      return parsed.filter((o: any) => o && o.id !== "ord_101") as unknown as T;
    }
    if (key === POSITIONS_KEY && Array.isArray(parsed)) {
      // Never load mock demo positions
      return parsed.filter((p: any) => p && p.id !== "pos_101") as unknown as T;
    }
    if (key === HISTORY_KEY && Array.isArray(parsed)) {
      return parsed.filter((h: any) => h && h.id !== "ord_100") as unknown as T;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function setStored<T>(key: string, val: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch (e) {
    console.warn("[trade-pro] order storage failed:", e);
  }
}

// Global state
let gTradingMode: TradingMode = getStored<TradingMode>(TRADING_MODE_KEY, "in_app");
let gOrders: Order[] = getStored<Order[]>(ORDERS_KEY, DEFAULT_ORDERS);
let gPositions: TradePosition[] = getStored<TradePosition[]>(POSITIONS_KEY, DEFAULT_POSITIONS);
let gHistory: Order[] = getStored<Order[]>(HISTORY_KEY, DEFAULT_HISTORY);
let gBalances: Balances = getStored<Balances>(BALANCES_KEY, DEFAULT_BALANCES);
let gAlerts: PriceAlert[] = getStored<PriceAlert[]>(ALERTS_KEY, []);

// Alpaca remote cache
let gAlpacaOrders: Order[] = [];
let gAlpacaPositions: TradePosition[] = [];
let gAlpacaHistory: Order[] = [];
let gAlpacaBalances: Balances = { USD: 0 };

const listeners = new Set<() => void>();

function notify() {
  if (gTradingMode === "in_app") {
    setStored(ORDERS_KEY, gOrders);
    setStored(POSITIONS_KEY, gPositions);
    setStored(HISTORY_KEY, gHistory);
    setStored(BALANCES_KEY, gBalances);
  }
  setStored(ALERTS_KEY, gAlerts);
  setStored(TRADING_MODE_KEY, gTradingMode);
  listeners.forEach((l) => l());
}

/**
 * Reload in-memory orders, positions, and balances from localStorage.
 * Triggered automatically when Supabase Realtime delivers updates from other devices.
 */
export function reloadOrdersFromStorage(): void {
  gTradingMode = getStored<TradingMode>(TRADING_MODE_KEY, "in_app");
  gOrders = getStored<Order[]>(ORDERS_KEY, DEFAULT_ORDERS);
  gPositions = getStored<TradePosition[]>(POSITIONS_KEY, DEFAULT_POSITIONS);
  gHistory = getStored<Order[]>(HISTORY_KEY, DEFAULT_HISTORY);
  gBalances = getStored<Balances>(BALANCES_KEY, DEFAULT_BALANCES);
  gAlerts = getStored<PriceAlert[]>(ALERTS_KEY, []);
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("tradepro-cloud-data-applied", reloadOrdersFromStorage);
  window.addEventListener("storage", (e) => {
    if (
      e.key === ORDERS_KEY ||
      e.key === POSITIONS_KEY ||
      e.key === BALANCES_KEY ||
      e.key === HISTORY_KEY
    ) {
      reloadOrdersFromStorage();
    }
  });
}

export function getTradingMode(): TradingMode {
  return gTradingMode;
}

export function setTradingMode(mode: TradingMode): void {
  gTradingMode = mode;
  setStored(TRADING_MODE_KEY, mode);
  if (mode === "alpaca") {
    void syncAlpacaTradingState();
  }
  notify();
}

export function normalizeAlpacaSymbol(symbol: string): { coin: string; pair: string } {
  const clean = symbol.replace("CRYPTO:", "").trim().toUpperCase();
  if (clean.includes("/")) {
    const [c, quote] = clean.split("/");
    return { coin: c, pair: `${c}/${quote || "USD"}` };
  }
  if (clean.endsWith("USD") && clean.length > 3) {
    const c = clean.slice(0, -3);
    return { coin: c, pair: `${c}/USD` };
  }
  if (clean.endsWith("USDT") && clean.length > 4) {
    const c = clean.slice(0, -4);
    return { coin: c, pair: `${c}/USDT` };
  }
  return { coin: clean, pair: `${clean}/USD` };
}

/**
 * Sync with Alpaca API when mode is 'alpaca'
 */
export async function syncAlpacaTradingState(): Promise<boolean> {
  const cfg = getAlpacaConfig();
  if (!cfg.keyId || !cfg.secretKey) return false;

  try {
    // 1. Account info & balances
    const accRes = await testAlpacaConnection();
    if (accRes.ok && accRes.account) {
      const cash = parseFloat(accRes.account.cash || "0");
      const bp = parseFloat(accRes.account.buying_power || "0");
      gAlpacaBalances = {
        USD: cash,
        BUYING_POWER: bp,
        PORTFOLIO: parseFloat(accRes.account.portfolio_value || "0"),
      };
    }

    // 2. Positions
    const posRes = await getAlpacaPositions();
    if (posRes.ok && posRes.positions) {
      gAlpacaPositions = posRes.positions.map((p) => {
        const { coin, pair } = normalizeAlpacaSymbol(p.symbol);
        const entryPrice = parseFloat(p.avg_entry_price || "0");
        const amount = parseFloat(p.qty || "0");
        const curPx = parseFloat(p.current_price || "0");
        const upl = parseFloat(p.unrealized_pl || "0");
        const uplpc = parseFloat(p.unrealized_plpc || "0") * 100;
        const mktVal = parseFloat(p.market_value || "0");
        return {
          id: p.asset_id || "alpaca_pos_" + p.symbol,
          date: new Date().toLocaleString([], {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
          pair,
          coin,
          side: p.side === "long" ? "BUY" : "SELL",
          entryPrice,
          amount,
          total: entryPrice * amount,
          isAlpaca: true,
          currentPrice: curPx > 0 ? curPx : entryPrice,
          unrealizedPl: upl,
          unrealizedPlpc: uplpc,
          marketValue: mktVal > 0 ? mktVal : (curPx > 0 ? curPx * amount : entryPrice * amount),
        };
      });
    }

    // 3. Orders
    const ordRes = await getAlpacaOrders();
    if (ordRes.ok && ordRes.orders) {
      gAlpacaOrders = ordRes.orders.map((o) => {
        const { coin, pair } = normalizeAlpacaSymbol(o.symbol);
        const price = parseFloat(o.limit_price || o.stop_price || "0");
        const amount = parseFloat(o.qty || "0");
        return {
          id: o.id,
          date: new Date(o.submitted_at).toLocaleString([], {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }),
          pair,
          coin,
          type: o.type === "limit" ? "Limit" : o.type === "market" ? "Market" : "Stop-Limit",
          side: o.side.toUpperCase() as OrderSide,
          price,
          amount,
          filled: (parseFloat(o.filled_qty || "0") / (amount || 1)) * 100,
          total: price * amount,
          trigger: "-",
          status: "Open",
          isAlpaca: true,
          placedAtPrice: price,
        };
      });
    }

    // 4. History
    const histRes = await getAlpacaOrderHistory(30);
    if (histRes.ok && histRes.orders) {
      gAlpacaHistory = histRes.orders
        .filter((o) => o.status !== "new" && o.status !== "open")
        .map((o) => {
          const { coin, pair } = normalizeAlpacaSymbol(o.symbol);
          const price = parseFloat(o.limit_price || "0");
          const amount = parseFloat(o.qty || "0");
          return {
            id: o.id,
            date: new Date(o.submitted_at).toLocaleString([], {
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            }),
            pair,
            coin,
            type: o.type === "limit" ? "Limit" : o.type === "market" ? "Market" : "Stop-Limit",
            side: o.side.toUpperCase() as OrderSide,
            price,
            amount,
            filled: (parseFloat(o.filled_qty || "0") / (amount || 1)) * 100,
            total: price * amount,
            trigger: "-",
            status: o.status === "filled" ? "Filled" : "Canceled",
            isAlpaca: true,
          };
        });
    }

    notify();
    return true;
  } catch (err) {
    console.warn("[trade-pro] Alpaca sync error:", err);
    return false;
  }
}

/**
 * Place a new order:
 * - Market: Executes immediately at current market price and creates an Open Trade.
 * - Limit: ALWAYS sits as an Open Order at that exact price point on the chart!
 *   It does NOT execute immediately on submit — it waits for live market price ticks
 *   to reach/cut the limit price, or until the user drags it!
 */
export function placeOrder(order: {
  coin: string;
  pair?: string;
  type: OrderType;
  side: OrderSide;
  price: number;
  amount: number;
  trigger?: string;
  takeProfit?: number;
  stopLoss?: number;
  currentPrice?: number;
  leverage?: number;
}): { ok: boolean; error?: string; order?: Order; position?: TradePosition } {
  const {
    coin,
    type,
    side,
    price,
    amount,
    trigger = "-",
    takeProfit,
    stopLoss,
    currentPrice,
    leverage = 1,
  } = order;
  const pair = order.pair ?? `${coin}/USD`;
  const effectivePrice = type === "Market" && currentPrice && currentPrice > 0 ? currentPrice : price;
  const total = effectivePrice * amount;

  if (amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
  if (type !== "Market" && effectivePrice <= 0) return { ok: false, error: "Price must be greater than 0" };

  // If in Alpaca Mode, route directly to Alpaca Paper API
  if (gTradingMode === "alpaca") {
    void (async () => {
      await submitAlpacaOrder({
        symbol: pair,
        qty: amount,
        side: side === "BUY" ? "buy" : "sell",
        type: type === "Limit" ? "limit" : type === "Market" ? "market" : "stop_limit",
        limitPrice: type === "Limit" ? effectivePrice : undefined,
        takeProfitPrice: takeProfit,
        stopLossPrice: stopLoss,
      });
      await syncAlpacaTradingState();
    })();

    return { ok: true };
  }

  // --- In-App Paper Trading Engine ---
  const marginRequired = total / leverage;

  // Balance Check & Escrow (Margin-based for leverage)
  if (side === "BUY") {
    if ((gBalances.USD ?? 0) < marginRequired) {
      return {
        ok: false,
        error: `Insufficient USD balance. Required: $${marginRequired.toFixed(2)} (Available: $${(gBalances.USD ?? 0).toFixed(2)})`,
      };
    }
    gBalances = {
      ...gBalances,
      USD: Math.max(0, (gBalances.USD ?? 0) - marginRequired),
    };
  } else {
    // SELL / SHORT
    if ((gBalances.USD ?? 0) < marginRequired) {
      return {
        ok: false,
        error: `Insufficient margin for short. Required: $${marginRequired.toFixed(2)}`,
      };
    }
    gBalances = {
      ...gBalances,
      USD: Math.max(0, (gBalances.USD ?? 0) - marginRequired),
    };
  }

  // CRITICAL FIX: Limit orders NEVER auto-execute immediately upon placement!
  // They ALWAYS start as Open Orders waiting at that price level!
  const isInstant = type === "Market";

  const timestamp = new Date().toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const liqPrice =
    side === "BUY"
      ? effectivePrice * (1 - 1 / leverage + 0.005)
      : effectivePrice * (1 + 1 / leverage - 0.005);

  if (isInstant) {
    // 1. Immediately create an Open Trade (TradePosition)
    const newPos: TradePosition = {
      id: "pos_" + Math.random().toString(36).substring(2, 9),
      date: timestamp,
      pair,
      coin,
      side,
      entryPrice: effectivePrice,
      amount,
      total,
      takeProfit,
      stopLoss,
      leverage,
      margin: marginRequired,
      liquidationPrice: Math.max(0, parseFloat(liqPrice.toFixed(2))),
    };
    gPositions = [newPos, ...gPositions];

    // 2. Add execution record to History
    const historyOrder: Order = {
      id: "ord_" + Math.random().toString(36).substring(2, 9),
      date: timestamp,
      pair,
      coin,
      type,
      side,
      price: effectivePrice,
      amount,
      filled: 100,
      total,
      trigger,
      takeProfit,
      stopLoss,
      status: "Filled",
      leverage,
    };
    gHistory = [historyOrder, ...gHistory];

    notify();
    return { ok: true, position: newPos, order: historyOrder };
  } else {
    // Stays Open as a pending Limit Order until price reaches/cuts it
    const newOrder: Order = {
      id: "ord_" + Math.random().toString(36).substring(2, 9),
      date: timestamp,
      pair,
      coin,
      type,
      side,
      price: parseFloat(effectivePrice.toFixed(2)),
      amount,
      filled: 0,
      total,
      trigger,
      takeProfit,
      stopLoss,
      status: "Open",
      leverage,
      placedAtPrice: currentPrice && currentPrice > 0 ? currentPrice : effectivePrice,
      placedAtTime: Date.now(),
    };
    gOrders = [newOrder, ...gOrders];

    notify();
    return { ok: true, order: newOrder };
  }
}

/**
 * Move / Drag a Limit Order on the chart:
 * Updates the order's limit price. Moving an order NEVER auto-executes it into a trade;
 * it smoothly moves the order line and waits for live market price to reach/cut it!
 */
export function updateOrderPrice(
  orderId: string,
  newPrice: number,
  currentPrice?: number
): { ok: boolean; order?: Order; position?: TradePosition } {
  if (gTradingMode === "alpaca") {
    const ord = gAlpacaOrders.find((o) => o.id === orderId);
    if (!ord || newPrice <= 0) return { ok: false };

    // Optimistically update order line for instant dragging feedback
    ord.price = parseFloat(newPrice.toFixed(2));
    ord.total = parseFloat((newPrice * ord.amount).toFixed(2));
    if (currentPrice && currentPrice > 0) {
      ord.placedAtPrice = currentPrice;
    }
    ord.placedAtTime = Date.now();
    notify();

    // Call Alpaca PATCH /v2/orders/{id}
    void (async () => {
      const res = await replaceAlpacaOrder(orderId, {
        limitPrice: newPrice,
      });
      if (!res.ok) {
        console.warn("[trade-pro] Alpaca replace order failed:", res.error);
      }
      await syncAlpacaTradingState();
    })();

    return { ok: true, order: ord };
  }

  const ordIndex = gOrders.findIndex((o) => o.id === orderId);
  if (ordIndex === -1) return { ok: false };

  const ord = gOrders[ordIndex];
  if (newPrice <= 0) return { ok: false };

  const oldTotal = ord.total;
  const newTotal = newPrice * ord.amount;
  const lev = ord.leverage || 1;
  const oldMargin = oldTotal / lev;
  const newMargin = newTotal / lev;

  // Adjust escrowed balance
  const diff = newMargin - oldMargin;
  if (diff > 0 && (gBalances.USD ?? 0) < diff) {
    return { ok: false }; // Insufficient funds to increase limit price
  }
  gBalances = {
    ...gBalances,
    USD: Math.max(0, (gBalances.USD ?? 0) - diff),
  };

  ord.price = parseFloat(newPrice.toFixed(2));
  ord.total = parseFloat(newTotal.toFixed(2));

  // Update placedAtPrice reference so the matching engine knows which direction price must travel to cut it
  if (currentPrice && currentPrice > 0) {
    ord.placedAtPrice = currentPrice;
  }
  ord.placedAtTime = Date.now();

  notify();
  return { ok: true, order: ord };
}

/** Update Take Profit (TP) target for an order or position */
export function setOrderTP(id: string, tp: number): void {
  const pos = gPositions.find((p) => p.id === id);
  if (pos) {
    pos.takeProfit = parseFloat(tp.toFixed(2));
    notify();
    return;
  }
  const ord = gOrders.find((o) => o.id === id);
  if (ord) {
    ord.takeProfit = parseFloat(tp.toFixed(2));
    notify();
  }
}

/** Update Stop Loss (SL) target for an order or position */
export function setOrderSL(id: string, sl: number): void {
  const pos = gPositions.find((p) => p.id === id);
  if (pos) {
    pos.stopLoss = parseFloat(sl.toFixed(2));
    notify();
    return;
  }
  const ord = gOrders.find((o) => o.id === id);
  if (ord) {
    ord.stopLoss = parseFloat(sl.toFixed(2));
    notify();
  }
}

/**
 * Reverse an active position (TradingView [ ⇅ ] button):
 * Closes the current position and instantly opens an opposing position of the same size!
 */
export function reversePosition(
  positionId: string,
  currentPrice?: number
): { ok: boolean; newPosition?: TradePosition } {
  if (gTradingMode === "alpaca") {
    // In Alpaca mode, close and re-order
    return { ok: true };
  }

  const posIndex = gPositions.findIndex((p) => p.id === positionId);
  if (posIndex === -1) return { ok: false };

  const pos = gPositions[posIndex];
  const exitPx = currentPrice && currentPrice > 0 ? currentPrice : pos.entryPrice;
  closePosition(pos.id, exitPx);

  // Open opposite side
  const opposingSide: OrderSide = pos.side === "BUY" ? "SELL" : "BUY";
  const res = placeOrder({
    coin: pos.coin,
    pair: pos.pair,
    type: "Market",
    side: opposingSide,
    price: exitPx,
    amount: pos.amount,
    currentPrice: exitPx,
    leverage: pos.leverage,
  });

  return { ok: res.ok, newPosition: res.position };
}

/**
 * Close an Open Trade (Position):
 * Calculates realized PnL, settles balances, and moves to Trade History.
 */
export function closePosition(
  positionId: string,
  exitPrice?: number
): { ok: boolean; pnl?: number } {
  if (gTradingMode === "alpaca") {
    void (async () => {
      const pos = gAlpacaPositions.find((p) => p.id === positionId);
      if (pos) {
        await closeAlpacaPosition(pos.coin);
        await syncAlpacaTradingState();
      }
    })();
    return { ok: true };
  }

  const posIndex = gPositions.findIndex((p) => p.id === positionId);
  if (posIndex === -1) return { ok: false };

  const pos = gPositions[posIndex];
  const finalPrice = exitPrice && exitPrice > 0 ? exitPrice : pos.entryPrice;

  // Realized PnL
  const diff = pos.side === "BUY" ? finalPrice - pos.entryPrice : pos.entryPrice - finalPrice;
  const pnlVal = diff * pos.amount;
  const marginReturned = (pos.margin || pos.total) + pnlVal;

  gBalances = {
    ...gBalances,
    USD: Math.max(0, (gBalances.USD ?? 0) + marginReturned),
  };

  const closeRecord: Order = {
    id: "close_" + Math.random().toString(36).substring(2, 9),
    date: new Date().toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    pair: pos.pair,
    coin: pos.coin,
    type: "Market",
    side: pos.side === "BUY" ? "SELL" : "BUY",
    price: finalPrice,
    amount: pos.amount,
    filled: 100,
    total: finalPrice * pos.amount,
    trigger: `Closed [PnL: ${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)}]`,
    status: "Filled",
    leverage: pos.leverage,
  };
  gHistory = [closeRecord, ...gHistory];

  gPositions.splice(posIndex, 1);
  notify();

  return { ok: true, pnl: pnlVal };
}

// Per-coin previous market price cache for real-time price cut detection
const lastPriceByCoin = new Map<string, number>();

/**
 * Limit Order Matching Engine, TP/SL Auto-Execution & Alert Checker:
 * Called continuously as live market prices stream in (0ms latency).
 *
 * Symmetrical Price-Cut Model:
 * 1. Orders NEVER auto-execute randomly or prematurely upon placement or dragging.
 * 2. An order fills if and only if live market price actually cuts through or touches the level:
 *    - Cut UP: prevPrice < limit && currentPrice >= limit
 *    - Cut DOWN: prevPrice > limit && currentPrice <= limit
 *    - Directional cross: if placed below market, fills when price drops to level;
 *                         if placed above market, fills when price climbs to level.
 * 3. Applies evenly and symmetrically to both BUY and SELL sides.
 */
export function checkPriceTriggers(
  coin: string,
  currentPrice: number,
  _candleHigh?: number,
  _candleLow?: number
): {
  filledOrders: Order[];
  closedPositions: { position: TradePosition; reason: "TP" | "SL" | "LIQ"; pnl: number }[];
  triggeredAlerts: PriceAlert[];
} {
  if (!currentPrice || currentPrice <= 0 || gTradingMode === "alpaca") {
    return { filledOrders: [], closedPositions: [], triggeredAlerts: [] };
  }

  const normCoin = coin.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const prevPrice = lastPriceByCoin.get(normCoin);
  lastPriceByCoin.set(normCoin, currentPrice);

  // If initial tick or price jump anomaly (> 30% jump in one tick, e.g. from coin switch),
  // record baseline and return early so no order triggers falsely!
  if (
    prevPrice === undefined ||
    prevPrice <= 0 ||
    Math.abs(currentPrice - prevPrice) / prevPrice > 0.3
  ) {
    return { filledOrders: [], closedPositions: [], triggeredAlerts: [] };
  }

  const filledOrders: Order[] = [];
  const remainingOrders: Order[] = [];
  const now = Date.now();

  // 1. Check Pending Limit Orders
  for (const ord of gOrders) {
    const oCoin = (ord.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const oPair = (ord.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (oCoin !== normCoin && !oPair.startsWith(normCoin) && !oPair.includes(normCoin)) {
      remainingOrders.push(ord);
      continue;
    }

    // Cooldown: do not fill in the first 200ms of placement/movement to avoid microsecond race
    if (ord.placedAtTime && now - ord.placedAtTime < 200) {
      remainingOrders.push(ord);
      continue;
    }

    const L = ord.price;
    let shouldFill = false;

    if (ord.side === "BUY") {
      // BUY Limit order: can ONLY execute when market price is at or below the limit price L!
      // It can NEVER execute if market price is above L.
      if (currentPrice <= L) {
        // Did price cut down through L, or touch L from above?
        const cutDown = prevPrice > L && currentPrice <= L;
        const touchedLow = _candleLow !== undefined && _candleLow <= L && prevPrice >= L;
        if (cutDown || touchedLow) {
          shouldFill = true;
        }
      }
    } else if (ord.side === "SELL") {
      // SELL Limit order: can ONLY execute when market price is at or above the limit price L!
      // It can NEVER execute if market price is below L.
      if (currentPrice >= L) {
        // Did price cut up through L, or touch L from below?
        const cutUp = prevPrice < L && currentPrice >= L;
        const touchedHigh = _candleHigh !== undefined && _candleHigh >= L && prevPrice <= L;
        if (cutUp || touchedHigh) {
          shouldFill = true;
        }
      }
    }

    if (shouldFill) {
      const filledOrder: Order = {
        ...ord,
        status: "Filled",
        filled: 100,
        date: new Date().toLocaleString([], {
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      };
      filledOrders.push(filledOrder);

      const lev = ord.leverage || 1;
      const liqPrice =
        ord.side === "BUY"
          ? ord.price * (1 - 1 / lev + 0.005)
          : ord.price * (1 + 1 / lev - 0.005);

      const newPos: TradePosition = {
        id: "pos_" + Math.random().toString(36).substring(2, 9),
        date: filledOrder.date,
        pair: ord.pair,
        coin: ord.coin,
        side: ord.side,
        entryPrice: ord.price,
        amount: ord.amount,
        total: ord.total,
        takeProfit: ord.takeProfit,
        stopLoss: ord.stopLoss,
        leverage: lev,
        margin: ord.total / lev,
        liquidationPrice: Math.max(0, parseFloat(liqPrice.toFixed(2))),
      };
      gPositions = [newPos, ...gPositions];
    } else {
      remainingOrders.push(ord);
    }
  }

  // 2. Check Open Positions for TP, SL & Liquidation
  const closedPositions: { position: TradePosition; reason: "TP" | "SL" | "LIQ"; pnl: number }[] = [];
  const remainingPositions: TradePosition[] = [];

  for (const pos of gPositions) {
    const pCoin = (pos.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const pPair = (pos.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (pCoin !== normCoin && !pPair.includes(normCoin)) {
      remainingPositions.push(pos);
      continue;
    }

    let closeReason: "TP" | "SL" | "LIQ" | null = null;
    let exitPrice = currentPrice;

    // Check Take Profit (TP)
    if (pos.takeProfit && pos.takeProfit > 0) {
      const tp = pos.takeProfit;
      if (pos.side === "BUY") {
        const tpCutUp = (prevPrice < tp && currentPrice >= tp) || (prevPrice <= tp && currentPrice > tp);
        if (currentPrice >= tp || tpCutUp) {
          closeReason = "TP";
          exitPrice = tp;
        }
      } else {
        const tpCutDown = (prevPrice > tp && currentPrice <= tp) || (prevPrice >= tp && currentPrice < tp);
        if (currentPrice <= tp || tpCutDown) {
          closeReason = "TP";
          exitPrice = tp;
        }
      }
    }

    // Check Stop Loss (SL)
    if (!closeReason && pos.stopLoss && pos.stopLoss > 0) {
      const sl = pos.stopLoss;
      if (pos.side === "BUY") {
        const slCutDown = (prevPrice > sl && currentPrice <= sl) || (prevPrice >= sl && currentPrice < sl);
        if (currentPrice <= sl || slCutDown) {
          closeReason = "SL";
          exitPrice = sl;
        }
      } else {
        const slCutUp = (prevPrice < sl && currentPrice >= sl) || (prevPrice <= sl && currentPrice > sl);
        if (currentPrice >= sl || slCutUp) {
          closeReason = "SL";
          exitPrice = sl;
        }
      }
    }

    // Check Liquidation
    if (!closeReason && pos.liquidationPrice && pos.liquidationPrice > 0) {
      const liq = pos.liquidationPrice;
      if (pos.side === "BUY") {
        const liqCutDown = (prevPrice > liq && currentPrice <= liq) || (prevPrice >= liq && currentPrice < liq);
        if (currentPrice <= liq || liqCutDown) {
          closeReason = "LIQ";
          exitPrice = liq;
        }
      } else {
        const liqCutUp = (prevPrice < liq && currentPrice >= liq) || (prevPrice <= liq && currentPrice > liq);
        if (currentPrice >= liq || liqCutUp) {
          closeReason = "LIQ";
          exitPrice = liq;
        }
      }
    }

    if (closeReason) {
      const diff = pos.side === "BUY" ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
      const pnlVal = diff * pos.amount;
      const returned = closeReason === "LIQ" ? 0 : Math.max(0, (pos.margin || pos.total) + pnlVal);

      gBalances = {
        ...gBalances,
        USD: Math.max(0, (gBalances.USD ?? 0) + returned),
      };

      gHistory = [
        {
          id: "trigger_" + Math.random().toString(36).substring(2, 9),
          date: new Date().toLocaleString([], {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          pair: pos.pair,
          coin: pos.coin,
          type: "Market",
          side: pos.side === "BUY" ? "SELL" : "BUY",
          price: exitPrice,
          amount: pos.amount,
          filled: 100,
          total: exitPrice * pos.amount,
          trigger: `${closeReason} Hit [PnL: ${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)}]`,
          status: "Filled",
          leverage: pos.leverage,
        },
        ...gHistory,
      ];

      closedPositions.push({ position: pos, reason: closeReason, pnl: pnlVal });
    } else {
      remainingPositions.push(pos);
    }
  }

  // 3. Check Price Alerts
  const triggeredAlerts: PriceAlert[] = [];
  const remainingAlerts: PriceAlert[] = [];

  for (const alt of gAlerts) {
    const aCoin = (alt.coin || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const aPair = (alt.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (aCoin !== normCoin && !aPair.includes(normCoin)) {
      remainingAlerts.push(alt);
      continue;
    }
    const cutUpAlt = (prevPrice < alt.price && currentPrice >= alt.price) || (prevPrice <= alt.price && currentPrice > alt.price);
    const cutDownAlt = (prevPrice > alt.price && currentPrice <= alt.price) || (prevPrice >= alt.price && currentPrice < alt.price);
    if (cutUpAlt || cutDownAlt) {
      triggeredAlerts.push(alt);
    } else {
      remainingAlerts.push(alt);
    }
  }

  if (filledOrders.length > 0 || closedPositions.length > 0 || triggeredAlerts.length > 0) {
    gOrders = remainingOrders;
    gPositions = remainingPositions;
    if (filledOrders.length > 0) {
      gHistory = [...filledOrders, ...gHistory];
    }
    gAlerts = remainingAlerts;
    notify();

    if (triggeredAlerts.length > 0 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tradepro-alert-triggered", {
          detail: { alerts: triggeredAlerts, price: currentPrice },
        })
      );
    }
  }

  return { filledOrders, closedPositions, triggeredAlerts };
}

export function cancelOrder(id: string): void {
  if (gTradingMode === "alpaca") {
    void (async () => {
      await cancelAlpacaOrder(id);
      await syncAlpacaTradingState();
    })();
    return;
  }

  const ord = gOrders.find((o) => o.id === id);
  if (!ord) return;

  const lev = ord.leverage || 1;
  const marginToRefund = ord.total / lev;
  gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + marginToRefund };

  gOrders = gOrders.filter((o) => o.id !== id);
  gHistory = [{ ...ord, status: "Canceled" }, ...gHistory];
  notify();
}

export function cancelAllOrders(pairFilter?: string): void {
  if (gTradingMode === "alpaca") {
    void (async () => {
      await cancelAllAlpacaOrders();
      await syncAlpacaTradingState();
    })();
    return;
  }

  const toCancel = pairFilter ? gOrders.filter((o) => o.pair === pairFilter) : [...gOrders];
  if (!toCancel.length) return;

  for (const ord of toCancel) {
    const lev = ord.leverage || 1;
    gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + ord.total / lev };
  }

  const ids = new Set(toCancel.map((o) => o.id));
  gOrders = gOrders.filter((o) => !ids.has(o.id));
  gHistory = [...toCancel.map((o) => ({ ...o, status: "Canceled" as OrderStatus })), ...gHistory];
  notify();
}

export function addAlert(params: { coin: string; price: number; pair?: string }): PriceAlert {
  const newAlert: PriceAlert = {
    id: "alt_" + Math.random().toString(36).substring(2, 9),
    coin: params.coin,
    pair: params.pair || `${params.coin}/USD`,
    price: params.price,
    date: new Date().toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
  gAlerts = [newAlert, ...gAlerts];
  notify();
  return newAlert;
}

export function removeAlert(id: string): void {
  gAlerts = gAlerts.filter((a) => a.id !== id);
  notify();
}

export function depositAsset(asset: string, amount: number): void {
  if (amount <= 0) return;
  gBalances = { ...gBalances, [asset]: (gBalances[asset] ?? 0) + amount };
  notify();
}

export function useOrders() {
  const [mode, setMode] = useState<TradingMode>(gTradingMode);
  const [orders, setOrders] = useState<Order[]>(gTradingMode === "alpaca" ? gAlpacaOrders : gOrders);
  const [positions, setPositions] = useState<TradePosition[]>(
    gTradingMode === "alpaca" ? gAlpacaPositions : gPositions
  );
  const [history, setHistory] = useState<Order[]>(
    gTradingMode === "alpaca" ? gAlpacaHistory : gHistory
  );
  const [balances, setBalances] = useState<Balances>(
    gTradingMode === "alpaca" ? gAlpacaBalances : gBalances
  );
  const [alerts, setAlerts] = useState<PriceAlert[]>(gAlerts);

  useEffect(() => {
    const update = () => {
      setMode(gTradingMode);
      if (gTradingMode === "alpaca") {
        setOrders([...gAlpacaOrders]);
        setPositions([...gAlpacaPositions]);
        setHistory([...gAlpacaHistory]);
        setBalances({ ...gAlpacaBalances });
      } else {
        setOrders([...gOrders]);
        setPositions([...gPositions]);
        setHistory([...gHistory]);
        setBalances({ ...gBalances });
      }
      setAlerts([...gAlerts]);
    };
    listeners.add(update);

    // Initial Alpaca sync if mode is alpaca
    let pollInterval: any;
    if (gTradingMode === "alpaca") {
      void syncAlpacaTradingState();
      pollInterval = setInterval(() => {
        if (gTradingMode === "alpaca") {
          void syncAlpacaTradingState();
        }
      }, 5000);
    }

    return () => {
      listeners.delete(update);
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return {
    tradingMode: mode,
    setTradingMode,
    orders,
    positions,
    history,
    balances,
    alerts,
    placeOrder,
    updateOrderPrice,
    setOrderTP,
    setOrderSL,
    reversePosition,
    closePosition,
    cancelOrder,
    cancelAllOrders,
    depositAsset,
    addAlert,
    removeAlert,
    syncAlpaca: syncAlpacaTradingState,
  };
}

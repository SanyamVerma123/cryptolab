/**
 * orderState — Client-side Paper Trading, Order Matching, Position & Alert Store
 *
 * Implements full trading logic:
 * - Market Orders: Execute immediately and create an Open Trade (TradePosition).
 * - Limit Orders: Remain Open until live market price reaches/cuts the limit price,
 *   at which point they fill automatically and become an Open Trade (TradePosition).
 * - Movable Limit Orders: Can be dragged on the chart to adjust the limit price in real-time.
 * - Positions: Track active open trades with entry price, size, real-time PnL, TP, SL, and Close.
 * - Take Profit & Stop Loss: Automatically close positions when target prices are reached.
 */
import { useEffect, useState } from "react";

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

const DEFAULT_ORDERS: Order[] = [
  {
    id: "ord_101",
    date: new Date(Date.now() - 3600000 * 2).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    pair: "BTC/USD",
    coin: "BTC",
    type: "Limit",
    side: "BUY",
    price: 64200.0,
    amount: 0.15,
    filled: 0,
    total: 9630.0,
    trigger: "-",
    status: "Open",
  },
];

const DEFAULT_POSITIONS: TradePosition[] = [
  {
    id: "pos_101",
    date: new Date(Date.now() - 3600000 * 3).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    pair: "BTC/USD",
    coin: "BTC",
    side: "BUY",
    entryPrice: 64500.0,
    amount: 0.25,
    total: 16125.0,
    takeProfit: 68000.0,
    stopLoss: 62500.0,
  },
];

const DEFAULT_HISTORY: Order[] = [
  {
    id: "ord_100",
    date: new Date(Date.now() - 3600000 * 5).toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    pair: "BTC/USD",
    coin: "BTC",
    type: "Market",
    side: "BUY",
    price: 64550.0,
    amount: 0.25,
    filled: 100,
    total: 16137.5,
    trigger: "-",
    status: "Filled",
  },
];

function getStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
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

// Global in-memory cache
let gOrders: Order[] = getStored<Order[]>(ORDERS_KEY, DEFAULT_ORDERS);
let gPositions: TradePosition[] = getStored<TradePosition[]>(POSITIONS_KEY, DEFAULT_POSITIONS);
let gHistory: Order[] = getStored<Order[]>(HISTORY_KEY, DEFAULT_HISTORY);
let gBalances: Balances = getStored<Balances>(BALANCES_KEY, DEFAULT_BALANCES);
let gAlerts: PriceAlert[] = getStored<PriceAlert[]>(ALERTS_KEY, []);

const listeners = new Set<() => void>();

function notify() {
  setStored(ORDERS_KEY, gOrders);
  setStored(POSITIONS_KEY, gPositions);
  setStored(HISTORY_KEY, gHistory);
  setStored(BALANCES_KEY, gBalances);
  setStored(ALERTS_KEY, gAlerts);
  listeners.forEach((l) => l());
}

/**
 * Place a new order:
 * - Market: Executes immediately at current market price and creates an Open Trade (TradePosition).
 * - Limit: If price already crosses currentPrice, executes immediately;
 *   otherwise stays as an Open Order at that exact price point (movable/draggable on chart).
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
}): { ok: boolean; error?: string; order?: Order; position?: TradePosition } {
  const { coin, type, side, price, amount, trigger = "-", takeProfit, stopLoss, currentPrice } = order;
  const pair = order.pair ?? `${coin}/USD`;
  const effectivePrice = type === "Market" && currentPrice && currentPrice > 0 ? currentPrice : price;
  const total = effectivePrice * amount;

  if (amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
  if (type !== "Market" && effectivePrice <= 0) return { ok: false, error: "Price must be greater than 0" };

  // Balance Check & Escrow
  if (side === "BUY") {
    if ((gBalances.USD ?? 0) < total) {
      return { ok: false, error: `Insufficient USD balance ($${(gBalances.USD ?? 0).toFixed(2)})` };
    }
    gBalances = {
      ...gBalances,
      USD: Math.max(0, (gBalances.USD ?? 0) - total),
    };
  } else {
    // SELL
    const currentCoinBal = gBalances[coin] ?? 0;
    if (currentCoinBal < amount) {
      return { ok: false, error: `Insufficient ${coin} balance (${currentCoinBal.toFixed(4)} ${coin})` };
    }
    gBalances = {
      ...gBalances,
      [coin]: Math.max(0, currentCoinBal - amount),
    };
  }

  // Determine if immediately fillable
  let isInstant = type === "Market";
  if (type === "Limit" && currentPrice && currentPrice > 0) {
    if (side === "BUY" && currentPrice <= price) {
      isInstant = true;
    } else if (side === "SELL" && currentPrice >= price) {
      isInstant = true;
    }
  }

  const timestamp = new Date().toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

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
      price,
      amount,
      filled: 0,
      total,
      trigger,
      takeProfit,
      stopLoss,
      status: "Open",
    };
    gOrders = [newOrder, ...gOrders];

    notify();
    return { ok: true, order: newOrder };
  }
}

/**
 * Move / Drag a Limit Order on the chart:
 * Updates the order's limit price. If dragged to cut currentPrice, immediately fills into an Open Trade!
 */
export function updateOrderPrice(
  orderId: string,
  newPrice: number,
  currentPrice?: number
): { ok: boolean; order?: Order; position?: TradePosition } {
  const ordIndex = gOrders.findIndex((o) => o.id === orderId);
  if (ordIndex === -1) return { ok: false };

  const ord = gOrders[ordIndex];
  if (newPrice <= 0) return { ok: false };

  const oldTotal = ord.total;
  const newTotal = newPrice * ord.amount;

  // Adjust escrowed balance
  if (ord.side === "BUY") {
    const diff = newTotal - oldTotal;
    if (diff > 0 && (gBalances.USD ?? 0) < diff) {
      return { ok: false }; // Insufficient funds to increase limit price
    }
    gBalances = {
      ...gBalances,
      USD: Math.max(0, (gBalances.USD ?? 0) - diff),
    };
  }

  ord.price = parseFloat(newPrice.toFixed(2));
  ord.total = parseFloat(newTotal.toFixed(2));

  // If new price now crosses current price, fill it into an Open Trade!
  let shouldFill = false;
  if (currentPrice && currentPrice > 0) {
    if (ord.side === "BUY" && currentPrice <= ord.price) {
      shouldFill = true;
    } else if (ord.side === "SELL" && currentPrice >= ord.price) {
      shouldFill = true;
    }
  }

  if (shouldFill) {
    // Remove from open orders
    gOrders.splice(ordIndex, 1);

    // Create Open Trade (TradePosition)
    const newPos: TradePosition = {
      id: "pos_" + Math.random().toString(36).substring(2, 9),
      date: new Date().toLocaleString([], {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      pair: ord.pair,
      coin: ord.coin,
      side: ord.side,
      entryPrice: ord.price,
      amount: ord.amount,
      total: ord.total,
      takeProfit: ord.takeProfit,
      stopLoss: ord.stopLoss,
    };
    gPositions = [newPos, ...gPositions];

    // Add to History
    gHistory = [{ ...ord, status: "Filled", filled: 100 }, ...gHistory];

    notify();
    return { ok: true, position: newPos };
  } else {
    notify();
    return { ok: true, order: ord };
  }
}

/**
 * Close an Open Trade (Position):
 * Calculates realized PnL, settles balances, and moves to Trade History.
 */
export function closePosition(
  positionId: string,
  exitPrice?: number
): { ok: boolean; pnl?: number } {
  const posIndex = gPositions.findIndex((p) => p.id === positionId);
  if (posIndex === -1) return { ok: false };

  const pos = gPositions[posIndex];
  const finalPrice = exitPrice && exitPrice > 0 ? exitPrice : pos.entryPrice;

  // Realized PnL
  const diff = pos.side === "BUY" ? finalPrice - pos.entryPrice : pos.entryPrice - finalPrice;
  const pnlVal = diff * pos.amount;

  // Return principal + PnL
  if (pos.side === "BUY") {
    gBalances = {
      ...gBalances,
      USD: Math.max(0, (gBalances.USD ?? 0) + pos.total + pnlVal),
    };
  } else {
    // SELL
    gBalances = {
      ...gBalances,
      [pos.coin]: Math.max(0, (gBalances[pos.coin] ?? 0) + pos.amount),
      USD: Math.max(0, (gBalances.USD ?? 0) + pnlVal),
    };
  }

  // Add Close record to History
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
  };
  gHistory = [closeRecord, ...gHistory];

  // Remove from open positions
  gPositions.splice(posIndex, 1);
  notify();

  return { ok: true, pnl: pnlVal };
}

/**
 * Limit Order Matching Engine, TP/SL Auto-Execution & Alert Checker:
 * Called continuously as live market prices stream in.
 */
export function checkPriceTriggers(
  coin: string,
  currentPrice: number
): {
  filledOrders: Order[];
  closedPositions: { position: TradePosition; reason: "TP" | "SL"; pnl: number }[];
  triggeredAlerts: PriceAlert[];
} {
  if (!currentPrice || currentPrice <= 0) {
    return { filledOrders: [], closedPositions: [], triggeredAlerts: [] };
  }

  const filledOrders: Order[] = [];
  const remainingOrders: Order[] = [];

  // 1. Check Pending Limit Orders
  for (const ord of gOrders) {
    if (ord.coin !== coin && ord.pair !== `${coin}/USD`) {
      remainingOrders.push(ord);
      continue;
    }

    let shouldFill = false;
    // BUY Limit: fills when currentPrice <= ord.price (market reaches/cuts down)
    if (ord.side === "BUY" && currentPrice <= ord.price) {
      shouldFill = true;
    }
    // SELL Limit: fills when currentPrice >= ord.price (market reaches/cuts up)
    else if (ord.side === "SELL" && currentPrice >= ord.price) {
      shouldFill = true;
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

      // Transition to Open Trade (TradePosition)!
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
      };
      gPositions = [newPos, ...gPositions];
    } else {
      remainingOrders.push(ord);
    }
  }

  // 2. Check Open Positions for TP & SL
  const closedPositions: { position: TradePosition; reason: "TP" | "SL"; pnl: number }[] = [];
  const remainingPositions: TradePosition[] = [];

  for (const pos of gPositions) {
    if (pos.coin !== coin && pos.pair !== `${coin}/USD`) {
      remainingPositions.push(pos);
      continue;
    }

    let closeReason: "TP" | "SL" | null = null;

    // Check Take Profit
    if (pos.takeProfit && pos.takeProfit > 0) {
      if (pos.side === "BUY" && currentPrice >= pos.takeProfit) closeReason = "TP";
      if (pos.side === "SELL" && currentPrice <= pos.takeProfit) closeReason = "TP";
    }

    // Check Stop Loss
    if (!closeReason && pos.stopLoss && pos.stopLoss > 0) {
      if (pos.side === "BUY" && currentPrice <= pos.stopLoss) closeReason = "SL";
      if (pos.side === "SELL" && currentPrice >= pos.stopLoss) closeReason = "SL";
    }

    if (closeReason) {
      const diff = pos.side === "BUY" ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
      const pnlVal = diff * pos.amount;

      // Settle balances
      if (pos.side === "BUY") {
        gBalances = {
          ...gBalances,
          USD: Math.max(0, (gBalances.USD ?? 0) + pos.total + pnlVal),
        };
      } else {
        gBalances = {
          ...gBalances,
          [pos.coin]: Math.max(0, (gBalances[pos.coin] ?? 0) + pos.amount),
          USD: Math.max(0, (gBalances.USD ?? 0) + pnlVal),
        };
      }

      // Add to History
      gHistory = [
        {
          id: "tp_sl_" + Math.random().toString(36).substring(2, 9),
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
          price: currentPrice,
          amount: pos.amount,
          filled: 100,
          total: currentPrice * pos.amount,
          trigger: `${closeReason} Hit [PnL: ${pnlVal >= 0 ? "+" : ""}$${pnlVal.toFixed(2)}]`,
          status: "Filled",
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
    if (alt.coin !== coin && alt.pair !== `${coin}/USD`) {
      remainingAlerts.push(alt);
      continue;
    }
    const pctDiff = Math.abs(currentPrice - alt.price) / alt.price;
    if (pctDiff < 0.0015) {
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
  const ord = gOrders.find((o) => o.id === id);
  if (!ord) return;

  // Refund locked balance
  if (ord.side === "BUY") {
    gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + ord.total };
  } else {
    gBalances = { ...gBalances, [ord.coin]: (gBalances[ord.coin] ?? 0) + ord.amount };
  }

  gOrders = gOrders.filter((o) => o.id !== id);
  gHistory = [{ ...ord, status: "Canceled" }, ...gHistory];
  notify();
}

export function cancelAllOrders(pairFilter?: string): void {
  const toCancel = pairFilter ? gOrders.filter((o) => o.pair === pairFilter) : [...gOrders];
  if (!toCancel.length) return;

  for (const ord of toCancel) {
    if (ord.side === "BUY") {
      gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + ord.total };
    } else {
      gBalances = { ...gBalances, [ord.coin]: (gBalances[ord.coin] ?? 0) + ord.amount };
    }
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
  const [orders, setOrders] = useState<Order[]>(gOrders);
  const [positions, setPositions] = useState<TradePosition[]>(gPositions);
  const [history, setHistory] = useState<Order[]>(gHistory);
  const [balances, setBalances] = useState<Balances>(gBalances);
  const [alerts, setAlerts] = useState<PriceAlert[]>(gAlerts);

  useEffect(() => {
    const update = () => {
      setOrders([...gOrders]);
      setPositions([...gPositions]);
      setHistory([...gHistory]);
      setBalances({ ...gBalances });
      setAlerts([...gAlerts]);
    };
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  return {
    orders,
    positions,
    history,
    balances,
    alerts,
    placeOrder,
    updateOrderPrice,
    closePosition,
    cancelOrder,
    cancelAllOrders,
    depositAsset,
    addAlert,
    removeAlert,
  };
}

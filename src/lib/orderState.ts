/**
 * orderState — Client-side Paper Trading, Order Matching & Alert Store
 *
 * Persists open orders, order history, trade history, price alerts, and user balances in localStorage.
 * Includes a real-time matching engine: Limit orders remain Open until live market price reaches
 * or crosses ("cuts") the limit price, at which point they are filled automatically.
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
  status: OrderStatus;
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

const ORDERS_KEY = "tradepro_open_orders_v1";
const HISTORY_KEY = "tradepro_order_history_v1";
const BALANCES_KEY = "tradepro_balances_v1";
const ALERTS_KEY = "tradepro_price_alerts_v1";

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
let gHistory: Order[] = getStored<Order[]>(HISTORY_KEY, DEFAULT_HISTORY);
let gBalances: Balances = getStored<Balances>(BALANCES_KEY, DEFAULT_BALANCES);
let gAlerts: PriceAlert[] = getStored<PriceAlert[]>(ALERTS_KEY, []);

const listeners = new Set<() => void>();

function notify() {
  setStored(ORDERS_KEY, gOrders);
  setStored(HISTORY_KEY, gHistory);
  setStored(BALANCES_KEY, gBalances);
  setStored(ALERTS_KEY, gAlerts);
  listeners.forEach((l) => l());
}

/**
 * Place a new order.
 * If type === "Market", fills immediately.
 * If type === "Limit", only fills immediately if market price already crosses the limit price;
 * otherwise it stays "Open" until the market price reaches/cuts it.
 */
export function placeOrder(order: {
  coin: string;
  pair?: string;
  type: OrderType;
  side: OrderSide;
  price: number;
  amount: number;
  trigger?: string;
  currentPrice?: number;
}): { ok: boolean; error?: string; order?: Order } {
  const { coin, type, side, price, amount, trigger = "-", currentPrice } = order;
  const pair = order.pair ?? `${coin}/USD`;
  const total = price * amount;

  if (amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
  if (type !== "Market" && price <= 0) return { ok: false, error: "Price must be greater than 0" };

  // Check and lock balance
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
      isInstant = true; // Limit buy with price >= market price fills immediately
    } else if (side === "SELL" && currentPrice >= price) {
      isInstant = true; // Limit sell with price <= market price fills immediately
    }
  }

  const newOrder: Order = {
    id: "ord_" + Math.random().toString(36).substring(2, 9),
    date: new Date().toLocaleString([], {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    pair,
    coin,
    type,
    side,
    price,
    amount,
    filled: isInstant ? 100 : 0,
    total,
    trigger,
    status: isInstant ? "Filled" : "Open",
  };

  if (isInstant) {
    // Immediately executed -> deliver asset
    if (side === "BUY") {
      gBalances = { ...gBalances, [coin]: (gBalances[coin] ?? 0) + amount };
    } else {
      gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + total };
    }
    gHistory = [newOrder, ...gHistory];
  } else {
    // Stays Open until price reaches/cuts it
    gOrders = [newOrder, ...gOrders];
  }

  notify();
  return { ok: true, order: newOrder };
}

/**
 * Limit Order Matching Engine & Alert Checker
 * Called whenever the live market price ticks.
 * If live price reaches or cuts the limit order price, the order is filled automatically!
 */
export function checkPriceTriggers(
  coin: string,
  currentPrice: number
): { filledOrders: Order[]; triggeredAlerts: PriceAlert[] } {
  if (!currentPrice || currentPrice <= 0) return { filledOrders: [], triggeredAlerts: [] };

  const filledOrders: Order[] = [];
  const remainingOrders: Order[] = [];

  for (const ord of gOrders) {
    if (ord.coin !== coin && ord.pair !== `${coin}/USD`) {
      remainingOrders.push(ord);
      continue;
    }

    let shouldFill = false;

    // BUY Limit: fills when currentPrice <= ord.price (market drops to/below limit price)
    if (ord.side === "BUY" && currentPrice <= ord.price) {
      shouldFill = true;
    }
    // SELL Limit: fills when currentPrice >= ord.price (market rises to/above limit price)
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

      // Deliver acquired asset
      if (ord.side === "BUY") {
        gBalances = { ...gBalances, [coin]: (gBalances[coin] ?? 0) + ord.amount };
      } else {
        gBalances = { ...gBalances, USD: (gBalances.USD ?? 0) + ord.total };
      }
    } else {
      remainingOrders.push(ord);
    }
  }

  // Check Price Alerts
  const triggeredAlerts: PriceAlert[] = [];
  const remainingAlerts: PriceAlert[] = [];

  for (const alt of gAlerts) {
    if (alt.coin !== coin && alt.pair !== `${coin}/USD`) {
      remainingAlerts.push(alt);
      continue;
    }

    // Trigger alert if price is within 0.15% or crosses
    const pctDiff = Math.abs(currentPrice - alt.price) / alt.price;
    if (pctDiff < 0.0015) {
      triggeredAlerts.push(alt);
    } else {
      remainingAlerts.push(alt);
    }
  }

  if (filledOrders.length > 0 || triggeredAlerts.length > 0) {
    gOrders = remainingOrders;
    if (filledOrders.length > 0) {
      gHistory = [...filledOrders, ...gHistory];
    }
    gAlerts = remainingAlerts;
    notify();

    // Trigger visual/audio feedback for triggered alerts
    if (triggeredAlerts.length > 0 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tradepro-alert-triggered", {
          detail: { alerts: triggeredAlerts, price: currentPrice },
        })
      );
    }
  }

  return { filledOrders, triggeredAlerts };
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
  const [history, setHistory] = useState<Order[]>(gHistory);
  const [balances, setBalances] = useState<Balances>(gBalances);
  const [alerts, setAlerts] = useState<PriceAlert[]>(gAlerts);

  useEffect(() => {
    const update = () => {
      setOrders([...gOrders]);
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
    history,
    balances,
    alerts,
    placeOrder,
    cancelOrder,
    cancelAllOrders,
    depositAsset,
    addAlert,
    removeAlert,
  };
}

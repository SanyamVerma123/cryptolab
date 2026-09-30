/**
 * cloudSync.ts — Supabase Cloud Database Synchronization Service.
 *
 * Implements full cross-device synchronization:
 * - Syncs: Active trades, open orders, paper balance, Alpaca API keys,
 *   chart indicators (LuxAlgo & Pine) with their configurations, drawing tool settings & presets.
 * - EXCLUDES: Chart drawings! Drawings remain strictly in browser localStorage
 *   as a local persistent view, exactly per user requirement.
 */

import { supabase, getCurrentUser } from "./supabase";

export interface SyncPayload {
  alpaca_config: Record<string, any>;
  paper_trading: Record<string, any>;
  chart_indicators: Record<string, any>;
  drawing_settings: Record<string, any>;
  preferences: Record<string, any>;
}

export type SyncStatus = "idle" | "syncing" | "synced" | "error" | "unauthenticated";

let currentStatus: SyncStatus = "idle";
let lastSyncedTime: Date | null = null;
let lastError: string | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

const SYNC_LISTENERS = new Set<(status: SyncStatus, lastSynced: Date | null, err: string | null) => void>();

function notifyListeners() {
  SYNC_LISTENERS.forEach((fn) => {
    try {
      fn(currentStatus, lastSyncedTime, lastError);
    } catch {}
  });
}

/** Subscribe to sync status changes */
export function onSyncStatusChange(
  callback: (status: SyncStatus, lastSynced: Date | null, err: string | null) => void
): () => void {
  SYNC_LISTENERS.add(callback);
  callback(currentStatus, lastSyncedTime, lastError);
  return () => {
    SYNC_LISTENERS.delete(callback);
  };
}

/** Read a JSON item safely from localStorage */
function readJson(key: string, fallback: any = null): any {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Write an item safely to localStorage */
function writeJson(key: string, val: any): void {
  try {
    if (val === undefined || val === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, typeof val === "string" ? val : JSON.stringify(val));
    }
  } catch (e) {
    console.warn(`[cloudSync] Failed to write localStorage key ${key}:`, e);
  }
}

/**
 * Collect all data to sync to Supabase (EXCLUDING drawings!).
 */
export function collectSyncData(): SyncPayload {
  return {
    alpaca_config: {
      tradepro_alpaca_config_v1: readJson("tradepro_alpaca_config_v1", {}),
    },
    paper_trading: {
      tradepro_trading_mode_v2: localStorage.getItem("tradepro_trading_mode_v2") || "in_app",
      tradepro_open_orders_v2: readJson("tradepro_open_orders_v2", []),
      tradepro_open_positions_v2: readJson("tradepro_open_positions_v2", []),
      tradepro_order_history_v2: readJson("tradepro_order_history_v2", []),
      tradepro_balances_v2: readJson("tradepro_balances_v2", null),
      tradepro_price_alerts_v2: readJson("tradepro_price_alerts_v2", []),
    },
    chart_indicators: {
      "trade-pro:lux-applied": readJson("trade-pro:lux-applied", {}),
      "trade-pro:pine-applied": readJson("trade-pro:pine-applied", {}),
      "trade-pro:indicators": readJson("trade-pro:indicators", {}),
      "trade-pro:pine-library": readJson("trade-pro:pine-library", []),
      "trade-pro:pine-source": localStorage.getItem("trade-pro:pine-source") || "",
    },
    drawing_settings: {
      "trade-pro:tool-defaults": readJson("trade-pro:tool-defaults", {}),
      "trade-pro:presets": readJson("trade-pro:presets", []),
    },
    preferences: {
      tradepro_right_panel_width: localStorage.getItem("tradepro_right_panel_width"),
      tradepro_bottom_orders_height: localStorage.getItem("tradepro_bottom_orders_height"),
      "trade-pro:favs-pos": readJson("trade-pro:favs-pos", null),
    },
  };
}

/**
 * Apply cloud data downloaded from Supabase to local storage and dispatch events.
 * CRUCIAL: Drawings are untouched and remain intact in browser storage!
 */
export function applyCloudData(payload: Partial<SyncPayload>): void {
  let changed = false;

  // 1. Alpaca Config
  if (payload.alpaca_config?.tradepro_alpaca_config_v1) {
    writeJson("tradepro_alpaca_config_v1", payload.alpaca_config.tradepro_alpaca_config_v1);
    window.dispatchEvent(
      new CustomEvent("alpaca-config-changed", {
        detail: payload.alpaca_config.tradepro_alpaca_config_v1,
      })
    );
    changed = true;
  }

  // 2. Paper Trading (orders, positions, balances, history, alerts)
  if (payload.paper_trading) {
    const pt = payload.paper_trading;
    if (pt.tradepro_trading_mode_v2) writeJson("tradepro_trading_mode_v2", pt.tradepro_trading_mode_v2);
    if (pt.tradepro_open_orders_v2) writeJson("tradepro_open_orders_v2", pt.tradepro_open_orders_v2);
    if (pt.tradepro_open_positions_v2) writeJson("tradepro_open_positions_v2", pt.tradepro_open_positions_v2);
    if (pt.tradepro_order_history_v2) writeJson("tradepro_order_history_v2", pt.tradepro_order_history_v2);
    if (pt.tradepro_balances_v2) writeJson("tradepro_balances_v2", pt.tradepro_balances_v2);
    if (pt.tradepro_price_alerts_v2) writeJson("tradepro_price_alerts_v2", pt.tradepro_price_alerts_v2);
    window.dispatchEvent(new CustomEvent("order-state-changed"));
    changed = true;
  }

  // 3. Chart Indicators (LuxAlgo, Pine, visibility & inputs)
  if (payload.chart_indicators) {
    const ci = payload.chart_indicators;
    if (ci["trade-pro:lux-applied"]) writeJson("trade-pro:lux-applied", ci["trade-pro:lux-applied"]);
    if (ci["trade-pro:pine-applied"]) writeJson("trade-pro:pine-applied", ci["trade-pro:pine-applied"]);
    if (ci["trade-pro:indicators"]) writeJson("trade-pro:indicators", ci["trade-pro:indicators"]);
    if (ci["trade-pro:pine-library"]) {
      writeJson("trade-pro:pine-library", ci["trade-pro:pine-library"]);
      window.dispatchEvent(new CustomEvent("pine-lib-changed"));
    }
    if (ci["trade-pro:pine-source"]) writeJson("trade-pro:pine-source", ci["trade-pro:pine-source"]);
    changed = true;
  }

  // 4. Drawing Settings & Presets
  if (payload.drawing_settings) {
    const ds = payload.drawing_settings;
    if (ds["trade-pro:tool-defaults"]) writeJson("trade-pro:tool-defaults", ds["trade-pro:tool-defaults"]);
    if (ds["trade-pro:presets"]) writeJson("trade-pro:presets", ds["trade-pro:presets"]);
    changed = true;
  }

  // 5. Preferences
  if (payload.preferences) {
    const p = payload.preferences;
    if (p.tradepro_right_panel_width) writeJson("tradepro_right_panel_width", p.tradepro_right_panel_width);
    if (p.tradepro_bottom_orders_height) writeJson("tradepro_bottom_orders_height", p.tradepro_bottom_orders_height);
    if (p["trade-pro:favs-pos"]) writeJson("trade-pro:favs-pos", p["trade-pro:favs-pos"]);
    changed = true;
  }

  if (changed) {
    window.dispatchEvent(new CustomEvent("tradepro-cloud-data-applied"));
  }
}

/**
 * Upload current settings & trades to Supabase user_sync table.
 */
export async function pushToCloud(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) {
    currentStatus = "unauthenticated";
    notifyListeners();
    return false;
  }

  currentStatus = "syncing";
  lastError = null;
  notifyListeners();

  try {
    const data = collectSyncData();

    const { error } = await supabase.from("user_sync").upsert(
      {
        user_id: user.id,
        email: user.email,
        alpaca_config: data.alpaca_config,
        paper_trading: data.paper_trading,
        chart_indicators: data.chart_indicators,
        drawing_settings: data.drawing_settings,
        preferences: data.preferences,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (error) throw error;

    // Also sync order history entries to public.trades table
    const history: any[] = data.paper_trading.tradepro_order_history_v2 || [];
    if (history.length > 0) {
      const tradesToUpsert = history.slice(0, 50).map((t) => ({
        id: t.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        user_id: user.id,
        symbol: t.pair || t.coin || "BTC/USD",
        side: t.side || "BUY",
        type: t.type || "Market",
        size: Number(t.amount || t.size || 0),
        price: Number(t.price || 0),
        status: t.status || "Filled",
        created_at: t.date ? new Date(t.date).toISOString() : new Date().toISOString(),
        realized_pnl: Number(t.realizedPnl || 0),
        raw: t,
      }));

      await supabase.from("trades").upsert(tradesToUpsert, { onConflict: "id" });
    }

    currentStatus = "synced";
    lastSyncedTime = new Date();
    lastError = null;
    notifyListeners();
    return true;
  } catch (err: any) {
    console.error("[cloudSync] pushToCloud error:", err);
    currentStatus = "error";
    lastError = err?.message || "Sync failed";
    notifyListeners();
    return false;
  }
}

/**
 * Pull cloud data from Supabase user_sync table.
 */
export async function pullFromCloud(): Promise<boolean> {
  const user = await getCurrentUser();
  if (!user) {
    currentStatus = "unauthenticated";
    notifyListeners();
    return false;
  }

  currentStatus = "syncing";
  lastError = null;
  notifyListeners();

  try {
    const { data, error } = await supabase
      .from("user_sync")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      // First login on this account: push local data to create cloud record
      return await pushToCloud();
    }

    applyCloudData(data);

    currentStatus = "synced";
    lastSyncedTime = new Date();
    lastError = null;
    notifyListeners();
    return true;
  } catch (err: any) {
    console.error("[cloudSync] pullFromCloud error:", err);
    currentStatus = "error";
    lastError = err?.message || "Sync pull failed";
    notifyListeners();
    return false;
  }
}

/**
 * Schedule a debounced push to cloud whenever local settings or trades change.
 */
export function scheduleCloudPush(delayMs = 1500): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushToCloud();
  }, delayMs);
}

/**
 * Initialize cloud sync event listeners across the application.
 */
let initialized = false;
export function initCloudSync(): () => void {
  if (initialized) return () => {};
  initialized = true;

  // Initial pull if already logged in
  void pullFromCloud();

  // Listen to local application events that modify state
  const handleLocalChange = () => {
    scheduleCloudPush();
  };

  window.addEventListener("alpaca-config-changed", handleLocalChange);
  window.addEventListener("order-state-changed", handleLocalChange);
  window.addEventListener("pine-lib-changed", handleLocalChange);
  window.addEventListener("storage", (e) => {
    if (e.key && e.key.startsWith("trade-pro:drawings")) return; // EXCLUDE drawings!
    scheduleCloudPush();
  });

  return () => {
    window.removeEventListener("alpaca-config-changed", handleLocalChange);
    window.removeEventListener("order-state-changed", handleLocalChange);
    window.removeEventListener("pine-lib-changed", handleLocalChange);
  };
}

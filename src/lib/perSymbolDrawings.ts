/**
 * perSymbolDrawings — keep each coin's chart drawings strictly separate.
 *
 * Requirements:
 * 1. Drawings made on BTC must STAY on BTC and NEVER appear on ETH or any other coin.
 * 2. When shifting tabs (e.g. BTC tab -> ETH tab), drawings from the prior coin are
 *    atomically saved, the chart is cleared, and the destination coin's drawings are loaded.
 * 3. If a coin has no saved drawings, the chart is clean and empty.
 * 4. Tool styles (colors, line widths, etc.) remain persistent across tools.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveChart } from "./workspaceSafe";

const KEY = "trade-pro:drawings";

type Store = Record<string, unknown[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Store) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

/**
 * Strip provider prefixes ("hyperliquid:BTC" -> "BTC") and trading pair suffixes
 * ("BTCUSDT", "BTC/USD", "BTC-PERP" -> "BTC") to get the canonical coin identifier.
 */
export function bareSymbol(sym: string | undefined): string | undefined {
  if (!sym) return undefined;
  const i = sym.indexOf(":");
  const raw = i === -1 ? sym : sym.slice(i + 1);
  return raw
    .toUpperCase()
    .replace(/\/(USD|USDT)$/i, "")
    .replace(/(USDT|USD|PERP)$/i, "")
    .trim();
}

/**
 * Set while a load/clear is in flight so that drawing:removed events do not
 * overwrite the coin's saved drawings with an empty set.
 */
let suppressSave = false;

/**
 * Snapshot the current chart's drawings under `symbol`, overwriting whatever
 * was previously saved for that coin.
 */
export function saveDrawings(
  ws: VelaWorkspace,
  sym: string | undefined,
  chart?: any,
): void {
  const coin = bareSymbol(sym);
  if (!coin) return;
  const c = chart || getSafeActiveChart(ws);
  if (!c?.drawings) return;
  if (suppressSave) return;
  try {
    const doc = c.drawings.toJSON();
    const store = load();
    store[coin] = doc?.drawings || [];
    save(store);
  } catch {
    /* chart not ready */
  }
}

/**
 * Restore `symbol`'s saved drawings onto the chart, actively clearing the chart
 * first so drawings from another coin NEVER bleed through.
 */
export function loadDrawings(
  ws: VelaWorkspace,
  sym: string | undefined,
  chart?: any,
  isInitialMount?: boolean,
): void {
  const coin = bareSymbol(sym);
  if (!coin) return;
  const c = chart || getSafeActiveChart(ws);
  if (!c?.drawings) return;

  try {
    const store = load();
    const saved = store[coin];

    // If on the very first mount of the app we have no store record,
    // adopt the chart's current drawings (e.g. from Vela's initial restore)
    // as the initial coin's drawings.
    if (saved === undefined && isInitialMount) {
      const curDoc = c.drawings.toJSON();
      store[coin] = curDoc?.drawings || [];
      save(store);
      return;
    }

    // When shifting coins or tabs:
    // ALWAYS remove all drawings from the chart first!
    suppressSave = true;
    try {
      const cur = c.drawings.all();
      if (cur && cur.length) {
        c.drawings.removeMany(cur.map((d: any) => d.id));
      }

      if (saved && Array.isArray(saved) && saved.length > 0) {
        // fromJSON validates and sanitizes each drawing entry
        c.drawings.fromJSON({ version: 1, drawings: saved } as never);
      } else {
        // If unrecorded or empty, record as empty so it stays isolated
        if (saved === undefined) {
          store[coin] = [];
          save(store);
        }
      }
    } finally {
      setTimeout(() => {
        suppressSave = false;
      }, 0);
    }
  } catch (err) {
    console.warn("[drawings] loadDrawings failed:", err);
  }
}

/**
 * Explicitly switch drawings from one coin to another (e.g. when shifting tabs).
 */
export function switchSymbolDrawings(
  ws: VelaWorkspace,
  fromSym: string | undefined,
  toSym: string | undefined,
): void {
  const fromCoin = bareSymbol(fromSym);
  const toCoin = bareSymbol(toSym);
  if (!toCoin || fromCoin === toCoin) return;
  const chart = getSafeActiveChart(ws);
  if (!chart?.drawings) return;

  if (fromCoin) {
    saveDrawings(ws, fromCoin, chart);
  }
  loadDrawings(ws, toCoin, chart, false);
}

/**
 * Install the per-symbol drawings manager on a workspace. Returns a disposer.
 */
export function installPerSymbolDrawings(ws: VelaWorkspace): () => void {
  if (!ws || (ws as any).destroyed) return () => {};
  const offs: (() => void)[] = [];
  const chart = getSafeActiveChart(ws);
  if (!chart) return () => {};

  let lastSymbol = bareSymbol(chart.market?.symbol);
  try {
    loadDrawings(ws, lastSymbol, chart, true);
  } catch {
    /* chart not ready */
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const currentCoin = bareSymbol(chart.market?.symbol) || lastSymbol;
      saveDrawings(ws, currentCoin, chart);
    }, 300);
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    const currentCoin = bareSymbol(chart.market?.symbol) || lastSymbol;
    saveDrawings(ws, currentCoin, chart);
  };

  const onMarketChanged = (e: { symbol?: string }) => {
    try {
      const next = bareSymbol(e.symbol);
      if (!next || next === lastSymbol) return;
      flush();
      const prev = lastSymbol;
      lastSymbol = next;
      // Switch from prev to next
      switchSymbolDrawings(ws, prev, next);
    } catch {
      /* chart torn down */
    }
  };

  try {
    offs.push(chart.on("drawing:created", persist) as () => void);
    offs.push(chart.on("drawing:edited", persist) as () => void);
    offs.push(chart.on("drawing:removed", persist) as () => void);
    offs.push(chart.on("market:changed", onMarketChanged) as () => void);
  } catch {
    /* chart not ready */
  }

  if (typeof window !== "undefined") window.addEventListener("pagehide", flush);

  return () => {
    flush();
    if (typeof window !== "undefined") window.removeEventListener("pagehide", flush);
    for (const off of offs) {
      try {
        off();
      } catch {}
    }
  };
}

/**
 * VelaChart — mounts the @luxalgo/vela WORKSPACE into a div.
 *
 * Vela owns its own DOM (it renders the whole shell — topbar, drawing toolbar,
 * status line, bottom bar — into the container). There are no React bindings,
 * so this is deliberately a thin imperative wrapper: one ref, mount on effect,
 * destroy on unmount.
 *
 * Native Vela Features:
 *   - Layout picker: Built-in LayoutPicker with multi-chart layouts (1 to 8 cells).
 *   - Drawings: 84 drawing tools with full settings popups, persistence across symbols.
 *   - Replay: First-class WorkspaceReplay registered via Vela's native topbar widget action.
 *   - Radial Menu: Alt-key drawing wheel.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  VelaWorkspace,
  registerLayout,
  registerBuiltinLayouts,
  ensureLayout,
} from "@luxalgo/vela/workspace";
import { registerIcon, registerWidgetAction, unregisterWidgetAction } from "@luxalgo/vela/plugin";
import { SafeHyperliquidProvider } from "../lib/safeHyperliquidProvider";
import { BinanceProvider } from "@luxalgo/vela/providers/binance";
import { CoinbaseProvider } from "@luxalgo/vela/providers/coinbase";
import { PineWorkerEngine } from "@luxalgo/vela-pinets";
import { preloadLuxLibrary, syncCustomLibrary } from "./PineEditor";
import { installToolDefaults } from "../lib/toolDefaults";
import { installPerSymbolDrawings } from "../lib/perSymbolDrawings";
import { installIndicatorState } from "../lib/indicatorState";
import { installCrosshairPlacement } from "../lib/crosshairPlacement";
import { restoreLuxIndicators } from "../lib/luxPersist";
import { restorePineIndicators } from "../lib/pinePersist";
import { suppressEthForecasterAutoRestore } from "../lib/indicatorRestoreSafety";
import { trackSelection } from "../lib/drawingPresets";
import { mountMarket } from "../lib/marketData";
import { installDrawingIsolation } from "../lib/drawingInteractions";
import { AlpacaProvider } from "../lib/alpacaProvider";
import { TwelveDataProvider } from "../lib/twelveDataProvider";
import { AlphaVantageProvider } from "../lib/alphaVantageProvider";
import { ChartBarReplay } from "./ChartBarReplay";
import { ChartRadialMenu } from "./ChartRadialMenu";
import { ChangeIntervalModal } from "./ChangeIntervalModal";
import { FavoritesBar } from "./FavoritesBar";
import { ErrorBoundary } from "./ErrorBoundary";
import { getSafeActiveChart, getSafeActiveCell, getSafeAllCharts } from "../lib/workspaceSafe";
import { seedTimelineMarks } from "../lib/timelineMarks";
import { toVelaTf } from "./ChartTabsBar";

// Register Vela's built-in presets ('1', '2h', '2v', '4', '8')
try {
  registerBuiltinLayouts();
} catch {
  // already registered
}

// Register custom layout presets (up to 8 charts max)
try {
  registerLayout({
    id: "3h",
    label: "3 side-by-side",
    cols: [1, 1, 1],
    rows: [1],
    cells: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
  });
  registerLayout({
    id: "3v",
    label: "3 stacked",
    cols: [1],
    rows: [1, 1, 1],
    cells: [{ id: "c1" }, { id: "c2" }, { id: "c3" }],
  });
  registerLayout({
    id: "6h",
    label: "6 grid (2×3)",
    cols: [1, 1, 1],
    rows: [1, 1],
    cells: Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}` })),
  });
  registerLayout({
    id: "6v",
    label: "6 grid (3×2)",
    cols: [1, 1],
    rows: [1, 1, 1],
    cells: Array.from({ length: 6 }, (_, i) => ({ id: `c${i + 1}` })),
  });
  registerLayout({
    id: "8v",
    label: "8 grid (4×2)",
    cols: [1, 1],
    rows: [1, 1, 1, 1],
    cells: Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}` })),
  });
} catch {
  // layouts already registered
}

// Register layout icon so Vela's native topbar renders the 4-box layout icon
try {
  registerIcon(
    "layout",
    `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>`
  );
} catch {
  // icon already registered
}

// Register replay icon in Vela icon registry
try {
  registerIcon(
    "replay",
    `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M7 4.5v7l-5-3.5 5-3.5zm7 0v7l-5-3.5 5-3.5z"/></svg>`
  );
} catch {
  // icon already registered
}

try {
  registerIcon("tradepro-script", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5.5 3.5-4 4.5 4 4.5M10.5 3.5l4 4.5-4 4.5"/></svg>`);
  registerIcon("tradepro-market", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 13.5h12M3 11V7m3 4V3m3 8V5m3 6V2"/></svg>`);
  registerIcon("tradepro-settings", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="m8 1.5.8 1.3 1.5.3 1.1-.7 1.2 1.2-.7 1.2.3 1.5 1.3.8v1.8l-1.3.8-.3 1.5.7 1.2-1.2 1.2-1.1-.7-1.5.3L8 14.5H6.2l-.8-1.3-1.5-.3-1.2.7-1.2-1.2.7-1.2-.3-1.5-1.3-.8V7.1l1.3-.8.3-1.5-.7-1.2 1.2-1.2 1.2.7 1.5-.3.8-1.3z" transform="translate(1 0) scale(.875)"/></svg>`);
  registerIcon("tradepro-tools", `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="m8 1.5 2 4.1 4.5.65-3.25 3.17.77 4.48L8 11.78l-4.02 2.12.77-4.48-3.25-3.17 4.5-.65L8 1.5z"/></svg>`);
  registerIcon("tradepro-account", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="5" r="2.5"/><path d="M2.5 14c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5"/></svg>`);
  registerIcon("tradepro-trading", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 5h9l-2-2"></path><path d="M11.5 11h-9l2 2"></path></svg>`);
  registerIcon("tradepro-journal", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2.5h8.5a2 2 0 0 1 2 2v9a.5.5 0 0 1-.5.5H4a2 2 0 0 1-2-2V4a1.5 1.5 0 0 1 1-1.5z"></path><path d="M2 12a2 2 0 0 1 2-2h9.5"></path></svg>`);
  registerIcon("tradepro-install", `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M8 1.5v9m-3-3 3 3 3-3M2 11.5v3h12v-3"/></svg>`);
} catch {
  // icons already registered
}

// Remove this retired action from Vela's module-global registry as well. During
// HMR the old descriptor can survive even after its registration source is gone.
unregisterWidgetAction("tradepro-chart-settings");
if (typeof document !== "undefined") {
  document
    .querySelectorAll<HTMLElement>('.vela-widget-topbar [aria-label="Chart settings"]')
    .forEach((button) => button.remove());
}

// Put scripting and workspace actions into Vela's shared chart topbar.
try {
  registerWidgetAction({
    id: "indicators",
    target: "topbar",
    align: "left",
    order: 7,
    icon: "indicators",
    label: "Indicators",
    iconOnly: false,
    run: () => window.dispatchEvent(new CustomEvent("tradepro:open-indicators")),
  });
  registerWidgetAction({
    id: "tradepro-scripts",
    target: "topbar",
    align: "left",
    order: 8,
    icon: "tradepro-script",
    label: "Pine Script",
    iconOnly: true,
    run: () => window.dispatchEvent(new CustomEvent("tradepro:toggle-pine")),
  });
  registerWidgetAction({ id: "tradepro-tools", target: "topbar", align: "left", order: 11, icon: "tradepro-tools", iconOnly: true, label: "Favorite drawing tools", run: () => window.dispatchEvent(new CustomEvent("tradepro:toggle-favorites")) });
  registerWidgetAction({ id: "tradepro-market", target: "topbar", align: "right", order: 1, icon: "tradepro-market", iconOnly: true, label: "Market panel", run: () => window.dispatchEvent(new CustomEvent("tradepro:toggle-market")) });
  registerWidgetAction({ id: "tradepro-settings", target: "topbar", align: "right", order: 2, icon: "tradepro-settings", iconOnly: true, label: "Trading settings", run: () => window.dispatchEvent(new CustomEvent("tradepro:open-settings")) });
  registerWidgetAction({ id: "tradepro-account", target: "topbar", align: "right", order: 3, icon: "tradepro-account", iconOnly: true, label: "Account and cloud sync", run: () => window.dispatchEvent(new CustomEvent("tradepro:open-account")) });
} catch {
  // actions are refreshed for new workspaces on registration
}

// Register native Replay topbar action into Vela's left cluster
try {
  registerWidgetAction({
    id: "tradepro-trading", target: "topbar", align: "left", order: 9, icon: "tradepro-trading", label: "Trading", iconOnly: true,
    run: () => window.dispatchEvent(new CustomEvent("tradepro:toggle-trading")),
  });
  registerWidgetAction({
    id: "tradepro-journal", target: "topbar", align: "left", order: 10, icon: "tradepro-journal", label: "Journal", iconOnly: true,
    run: () => window.dispatchEvent(new CustomEvent("tradepro:toggle-journal")),
  });
  registerWidgetAction({
    id: "replay", target: "topbar", align: "left", order: 11,
    icon: "replay",
    label: "Replay",
    iconOnly: true,
    run: () => {
      window.dispatchEvent(new CustomEvent("tradepro:toggle-replay"));
    },
  });
} catch {
  // action already registered
}

interface Props {
  coin: string;
  /** Vela timeframe id ('1','5','15','30','60','240','D','W'…). */
  timeframe: string;
  onReady?: (ws: VelaWorkspace) => void;
}

const TF_BARS: Record<string, number> = {
  "1": 3000, "3": 3000, "5": 3000, "15": 3000, "30": 3000,
  "45": 3000, "60": 3000, "120": 2500, "180": 2500, "240": 2000,
  "360": 2000, "480": 1500, "720": 1500,
  D: 2500, W: 1200, M: 600,
};

const HYPERLIQUID_HISTORY_PAGE = 1_000;
const HYPERLIQUID_HISTORY_LIMIT = 30_000;
const HYPERLIQUID_PREFETCH_VIEWPORTS = 6;

function barsForTf(tf: string): number {
  const norm = toVelaTf(tf);
  return TF_BARS[norm] ?? 2500;
}

function canonicalSymbol(symbol: string | undefined): string {
  if (!symbol) return "";
  const separator = symbol.indexOf(":");
  return (separator >= 0 ? symbol.slice(separator + 1) : symbol).toUpperCase();
}

const autoBackfillBindings = new WeakSet<object>();
const historyLoadingNodes = new WeakMap<object, HTMLElement>();

/** Show the backfill affordance inside this chart's plot (separate from Vela's
 * centered first-load indicator). The renderer is shared by all data providers,
 * so the same affordance works for every market source. */
function setHistoryBackfillLoading(chart: any, loading: boolean): void {
  if (!chart || (typeof chart !== "object" && typeof chart !== "function")) return;

  const renderer = chart.orchestrator?.renderer;
  const wrapper = renderer?.wrapper as HTMLElement | undefined;
  if (!wrapper) return;

  let node = historyLoadingNodes.get(chart);
  if (!loading) {
    node?.remove();
    historyLoadingNodes.delete(chart);
    return;
  }

  if (node?.isConnected && node.parentElement === wrapper) return;

  node = wrapper.ownerDocument.createElement("div");
  node.className = "tradepro-history-loading";
  node.setAttribute("role", "status");
  node.setAttribute("aria-label", "Loading older chart history");
  node.setAttribute("aria-live", "polite");
  for (let i = 0; i < 3; i += 1) {
    const dot = wrapper.ownerDocument.createElement("span");
    dot.className = "tradepro-history-loading-dot";
    dot.style.animationDelay = `${-i * 180}ms`;
    node.appendChild(dot);
  }
  wrapper.appendChild(node);
  historyLoadingNodes.set(chart, node);
}

function wireAutoBackfill(chart: any, cell?: any): () => void {
  if (!chart || typeof chart.on !== "function") return () => {};
  // Workspace events can announce the same cell through ready, cell:created,
  // and layout:changed. Bind once per chart or repeated pan handlers race their
  // own setMarket calls and can make the history edge appear stuck.
  if (autoBackfillBindings.has(chart)) return () => {};
  autoBackfillBindings.add(chart);

  let loading = false;
  const maxHistoryForMarket = () => {
    const market = chart.market;
    const provider = String(market?.provider ?? "").toLowerCase();
    const symbol = String(market?.symbol ?? "").toLowerCase();
    // SafeHyperliquidProvider pages the exchange's candleSnapshot windows, so
    // history can grow past one response while remaining bounded in memory.
    return provider === "hyperliquid" || symbol.startsWith("hyperliquid:") ? HYPERLIQUID_HISTORY_LIMIT : 30000;
  };
  const prefetchLead = () => maxHistoryForMarket() === HYPERLIQUID_HISTORY_LIMIT
    ? HYPERLIQUID_PREFETCH_VIEWPORTS
    : 1.25;
  let requestedBars = Math.min(
    Number(chart.market?.bars) || Number(cell?.state?.bars) || 2500,
    maxHistoryForMarket(),
  );
  let reachedGenesis = false;

  const onHistoryComplete = (evt: any) => {
    if (evt?.reason === "genesis") {
      reachedGenesis = true;
    }
  };

  const onMarketChanged = () => {
    reachedGenesis = false;
    loading = false;
    requestedBars = Math.min(
      Number(chart.market?.bars) || Number(cell?.state?.bars) || 2500,
      maxHistoryForMarket(),
    );
  };

  const onViewport = (vp: { from: number; to: number }) => {
    if (loading || reachedGenesis || !vp || typeof vp.from !== "number" || typeof vp.to !== "number") return;

    // CRITICAL: Never trigger market backfill while Replay is active!
    // Calling chart.setMarket({ bars }) during replay reloads live server data up to today,
    // destroying the user's replay cut point and resetting playback to live current time.
    if (chart.replay?.state?.active || (chart as any).workspace?.replay?.state?.active || cell?.workspace?.replay?.state?.active) return;

    try {
      // Replay bounds describe the complete in-memory history, including bars
      // hidden by replay. Use them as the history edge, not the separate AI
      // market-data cache (which intentionally only keeps a small recent slice).
      const bounds = chart.replay?.bounds;
      let oldestTime = bounds?.first;
      if (typeof oldestTime !== "number" || oldestTime <= 0) return;

      const span = vp.to - vp.from;
      if (span <= 0) return;

      // Request another page before the oldest loaded bar reaches the left
      // edge. This check is time-based, so it works for every timeframe.
      const historyCap = maxHistoryForMarket();
      // Start Hyperliquid backfill several screens before the loaded edge so
      // fast pans don't expose a blank/loading region before the next page lands.
      if (vp.from > oldestTime + span * prefetchLead() || requestedBars >= historyCap) return;

      loading = true;
      const pageSize = maxHistoryForMarket() === HYPERLIQUID_HISTORY_LIMIT
        ? HYPERLIQUID_HISTORY_PAGE
        : 5000;
      const nextBars = Math.min(historyCap, requestedBars + pageSize);
      if (nextBars <= requestedBars) {
        loading = false;
        return;
      }
      requestedBars = nextBars;
      if (cell?.state) cell.state.bars = nextBars;
      setHistoryBackfillLoading(chart, true);

      void (async () => {
        try {
          // `setMarket` resolves before the detached prepend finishes;
          // `historyComplete()` keeps this lock until Vela finishes the page so
          // repeated viewport events cannot start overlapping history loads.
          await chart.setMarket({ bars: nextBars });
          await chart.historyComplete?.();
        } catch (err) {
          requestedBars = Math.max(2500, nextBars - pageSize);
          console.warn("[trade-pro] backfill setMarket failed:", err);
        } finally {
          loading = false;
          setHistoryBackfillLoading(chart, false);
        }
      })();
    } catch {
      loading = false;
      setHistoryBackfillLoading(chart, false);
    }
  };

  try {
    const unsubs: (() => void)[] = [];
    unsubs.push(chart.on("viewport:changed", onViewport));
    unsubs.push(chart.on("market:changed", onMarketChanged));
    unsubs.push(chart.on("history:complete", onHistoryComplete));
    return () => {
      setHistoryBackfillLoading(chart, false);
      unsubs.forEach((u) => {
        try { u(); } catch {}
      });
    };
  } catch {
    return () => {};
  }
}

const VALID_TIMEFRAMES = new Set([
  "1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"
]);

function installTimeframeInteractionFix(ws: VelaWorkspace, container: HTMLElement): () => void {
  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    // Check if clicked item is inside a menu item
    const menuItem = target.closest(".vela-menu-item") as HTMLElement | null;
    if (menuItem && !target.closest(".vela-menu-star") && !target.closest(".vela-fav")) {
      const rawVal = menuItem.dataset.value || menuItem.dataset.veiId || menuItem.id?.split("/")?.pop();
      if (rawVal) {
        const canonical = toVelaTf(rawVal);
        if (VALID_TIMEFRAMES.has(canonical)) {
          try {
            const activeCell = getSafeActiveCell(ws);
            if (activeCell) {
              activeCell.setTimeframe?.(canonical);
            } else {
              getSafeActiveChart(ws)?.setMarket?.({ timeframe: canonical, bars: barsForTf(canonical) });
            }
            window.dispatchEvent(new CustomEvent("tradepro:change-timeframe", { detail: { timeframe: canonical } }));
          } catch {
            try {
              getSafeActiveChart(ws)?.setMarket?.({ timeframe: canonical, bars: barsForTf(canonical) });
            } catch {}
          }
          return;
        }
      }
    }

    // Check topbar timeframe buttons / chips
    const btn = target.closest("button") as HTMLElement | null;
    if (btn && container.contains(btn)) {
      const txt = btn.textContent?.trim() || "";
      const val = btn.dataset.value || btn.dataset.tf || txt;
      if (val) {
        const canonical = toVelaTf(val);
        if (VALID_TIMEFRAMES.has(canonical)) {
          window.dispatchEvent(new CustomEvent("tradepro:change-timeframe", { detail: { timeframe: canonical } }));
        }
      }
    }
  };

  // Run in bubble phase, NOT capture, so native Zag handlers run first
  document.addEventListener("click", onClick, false);
  return () => {
    document.removeEventListener("click", onClick, false);
  };
}

export function VelaChart({ coin, timeframe, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<VelaWorkspace | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const coinRef = useRef(coin);
  coinRef.current = coin;

  const [wsInstance, setWsInstance] = useState<VelaWorkspace | null>(null);
  const [replayActive, setReplayActive] = useState<boolean>(false);
  const replayActiveRef = useRef(false);
  replayActiveRef.current = replayActive;

  const closeReplay = useCallback(() => {
    replayActiveRef.current = false;
    try {
      wsRef.current?.replay.stop();
    } catch {}
    setReplayActive(false);
  }, []);

  // Mount once. React 19 Strict Mode double-invokes effects in dev, so guard.
  useEffect(() => {
    const el = ref.current;
    if (!el || wsRef.current) return;

    // This saved ETH forecaster has been causing a startup lockup. Clear only
    // its chart auto-restore pointers before Vela mounts; keep the library copy.
    suppressEthForecasterAutoRestore(coin);

    const ws = new VelaWorkspace(el, {
      layout: "1", // Single chart initial, native layout picker & sync engine active!
      engines: {
        pine: () => new PineWorkerEngine(),
      },
      symbol: coin,
      timeframe,
      bars: barsForTf(timeframe),
      live: true,
      theme: "dark",
      autofocus: true,
      // Persist market, style, timezone, drawings and indicators to localStorage.
      persist: true,
      statusline: true,
      watermark: true,
      bottombar: true,
      // Multi-provider feed: all providers provided by Vela + Alpaca + TwelveData + AlphaVantage
      providers: {
        hyperliquid: () => new SafeHyperliquidProvider(),
        binance: () => new BinanceProvider(),
        coinbase: () => new CoinbaseProvider(),
        alpaca: () => new AlpacaProvider(),
        twelvedata: () => new TwelveDataProvider(),
        alphavantage: () => new AlphaVantageProvider(),
      },
      drawings: true, // the full 84-tool surface with the shared toolbar
      drawingToolbar: true, // shared toolbar for the workspace
      maxWebglCells: 16, // budget policy
      alertCap: 50, // aggregate alerts in topbar bell
      sync: {
        crosshair: true,
        viewport: true,
        drawings: true,
        style: true,
        symbol: false,
        timeframe: false,
      },
    });
    // If a prior hot-loaded build left the retired control in the current DOM,
    // remove just that topbar button. Fresh Vela renders no longer include it.
    ws.root
      .querySelectorAll<HTMLElement>('.vela-widget-topbar [aria-label="Chart settings"]')
      .forEach((button) => button.remove());
    wsRef.current = ws;
    setWsInstance(ws);
    if (typeof window !== "undefined") {
      (window as any).__ws = ws;
    }

    // Enforce strict cap: max 8 charts in setLayout
    const origSetLayout = ws.setLayout.bind(ws);
    ws.setLayout = (layout: unknown) => {
      let def = typeof layout === "string" ? ensureLayout(layout) : layout as { cells?: unknown[] };
      if (def && def.cells && def.cells.length > 16) {
        console.warn("[trade-pro] layout exceeds max 16 charts, capping at 16");
        return origSetLayout("16");
      }
      return origSetLayout(layout as any);
    };

    // Hook ws.setActiveTimeframe so any topbar timeframe click notifies the app & tabs bar
    const origSetActiveTimeframe = (ws as any).setActiveTimeframe?.bind(ws);
    if (origSetActiveTimeframe) {
      (ws as any).setActiveTimeframe = (tf: string) => {
        try {
          origSetActiveTimeframe(tf);
        } catch {}
        window.dispatchEvent(new CustomEvent("tradepro:change-timeframe", { detail: { timeframe: tf } }));
      };
    }

    ws.on("cell:created", () => {
      try {
        installDrawingIsolation(ws);
        for (const c of ws.cells()) {
          wireAutoBackfill(c.chart, c);
        }
      } catch (e) {
        console.warn("[trade-pro] cell isolation install failed:", e);
      }
      initCell();
    });

    ws.on("layout:changed", () => {
      try {
        for (const c of ws.cells()) {
          wireAutoBackfill(c.chart, c);
        }
      } catch {}
      initCell();
    });

    let readyReported = false;
    const initCell = () => {
      if (!wsRef.current || (ws as any).destroyed || wsRef.current !== ws) return;
      try {
        const chart = getSafeActiveChart(ws);
        if (!chart) return;
        chart
          .ready()
          .then(() => {
            if (!wsRef.current || (ws as any).destroyed || wsRef.current !== ws) return;
            try {
              syncCustomLibrary(ws);
              void preloadLuxLibrary(ws);
            } catch (e) {
              console.warn("[trade-pro] custom library sync failed:", e);
            }
            try {
              installToolDefaults(ws);
            } catch (e) {
              console.warn("[trade-pro] tool defaults install failed:", e);
            }
            try {
              installPerSymbolDrawings(ws);
            } catch (e) {
              console.warn("[trade-pro] per-symbol drawings install failed:", e);
            }
            try {
              installDrawingIsolation(ws);
            } catch (e) {
              console.warn("[trade-pro] drawing isolation install failed:", e);
            }
            try {
              if (chart?.drawings?.setToolShortcuts) {
                chart.drawings.setToolShortcuts({
                  trendline: "Alt+T",
                  hline: "Alt+H",
                  vline: "Alt+V",
                  fibretracement: "Alt+F",
                  parallelchannel: "Alt+J",
                  box: "Alt+B",
                });
              }
            } catch (e) {
              console.warn("[trade-pro] drawing shortcuts setup failed:", e);
            }
            try {
              const activeCell = getSafeActiveCell(ws);
              wireAutoBackfill(chart, activeCell);
              chart.on?.("market:changed", () => {
                const tf = chart.market?.timeframe || activeCell?.state?.timeframe;
                if (tf) {
                  window.dispatchEvent(new CustomEvent("tradepro:change-timeframe", { detail: { timeframe: toVelaTf(tf) } }));
                }
              });

              // Seed native Vela timeline marks (News, Macro, Protocol releases & Journal trades)
              const sym = chart.market?.symbol || activeCell?.state?.symbol || coinRef.current || "BTCUSDT";
              seedTimelineMarks(chart, sym);
              chart.on?.("market:changed", (ev?: any) => {
                const nextSym = ev?.symbol || chart.market?.symbol || sym;
                seedTimelineMarks(chart, nextSym);
              });
            } catch {}

            if (!readyReported) {
              readyReported = true;
              onReadyRef.current?.(ws);
            }
          })
          .catch((e: any) => console.error("[trade-pro] vela ready failed", e));
      } catch (e) {
        console.warn("[trade-pro] initCell error:", e);
      }
    };

    initCell();
    ws.on("cell:active", initCell);

    const handleOpenChartSettings = () => {
      try {
        const ws = wsRef.current;
        if (!ws) return;
        const chart = getSafeActiveChart(ws);
        if (chart) {
          if (typeof chart.openSettings === "function") {
            chart.openSettings();
          } else if (chart.renderer?.openSettingsDialog) {
            chart.renderer.openSettingsDialog();
          }
        }
      } catch (e) {
        console.warn("[trade-pro] error opening chart settings:", e);
      }
    };
    window.addEventListener("tradepro:open-chart-settings", handleOpenChartSettings);

    const handleJournalUpdated = () => {
      try {
        const ws = wsRef.current;
        if (!ws) return;
        const chart = getSafeActiveChart(ws);
        const sym = chart?.market?.symbol || coinRef.current || "BTCUSDT";
        if (chart) seedTimelineMarks(chart, sym);
      } catch {}
    };
    window.addEventListener("tradepro:journal-updated", handleJournalUpdated);

    const stopTf = installTimeframeInteractionFix(ws, el);

    return () => {
      window.removeEventListener("tradepro:open-chart-settings", handleOpenChartSettings);
      window.removeEventListener("tradepro:journal-updated", handleJournalUpdated);
      try {
        stopTf();
      } catch {}
      try {
        ws.destroy();
      } catch {
        /* already gone */
      }
      if (wsRef.current === ws) {
        wsRef.current = null;
        setWsInstance(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Symbol / timeframe switches route through the workspace's own API
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    let stopMarket: (() => void) | undefined;
    let stopDefaults: (() => void) | undefined;
    let stopSymbols: (() => void) | undefined;
    let stopIndicators: (() => void) | undefined;
    let stopCrosshair: (() => void) | undefined;
    let stopIsolation: (() => void) | undefined;

    const restoreLux = async () => {
      try {
        const chart = getSafeActiveChart(ws);
        const sym = chart?.market?.symbol;
        if (!sym) return;
        const r = await restoreLuxIndicators(ws, sym);
        if (r.failed.length) {
          console.warn("[trade-pro] some library indicators could not be restored:", r.failed);
        }
      } catch (e) {
        console.warn("[trade-pro] lux restore failed:", e);
      }
    };

    const restorePine = async () => {
      try {
        const chart = getSafeActiveChart(ws);
        const sym = chart?.market?.symbol;
        if (!sym) return;
        const r = await restorePineIndicators(ws, sym);
        if (r.failed.length) {
          console.warn("[trade-pro] some custom indicators could not be restored:", r.failed);
        }
      } catch (e) {
        console.warn("[trade-pro] pine restore failed:", e);
      }
    };

    // Restore indicator families one at a time. LuxAlgo and custom Pine
    // scripts both prepare workers and render state; starting both restore
    // loops together can starve the main thread on busy markets like ETH.
    const restoreIndicators = async () => {
      const chart = getSafeActiveChart(ws);
      const sym = chart?.market?.symbol;
      suppressEthForecasterAutoRestore(sym ?? coin);
      await restoreLux();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      await restorePine();
    };

    const setupMarket = () => {
      let switchPromise: Promise<void> | null = null;
      try {
        const chart = getSafeActiveChart(ws);
        if (chart) {
          const market = chart.market;
          const canonicalTf = toVelaTf(timeframe);
          const sameIdentity = canonicalSymbol(market?.symbol) === canonicalSymbol(coin)
            && toVelaTf(market?.timeframe) === canonicalTf;
          if (!sameIdentity) {
            switchPromise = chart.setMarket({ symbol: coin, timeframe: canonicalTf, bars: barsForTf(canonicalTf) });
          } else if (!ws.replay.state.active && market?.bars !== barsForTf(canonicalTf)) {
            // The native topbar already applied this timeframe. A depth-only
            // setMarket during replay ends the cell's replay but emits no
            // market:changed event for WorkspaceReplay to rejoin on.
            switchPromise = chart.setMarket({ bars: barsForTf(canonicalTf) });
          }
        }
      } catch (e) {
        console.error("[trade-pro] setMarket failed", e);
      }

      if (switchPromise) {
        switchPromise
          .then(() => {
            void restoreIndicators();
          })
          .catch(() => {
            void restoreIndicators();
          });
      } else {
        void restoreIndicators();
      }

      stopMarket = mountMarket(ws, { symbol: coin, timeframe: toVelaTf(timeframe) });

      try {
        stopDefaults = installToolDefaults(ws);
      } catch (e) {
        console.warn("[trade-pro] tool defaults re-install failed:", e);
      }

      try {
        stopIndicators = installIndicatorState(ws);
      } catch (e) {
        console.warn("[trade-pro] indicator state failed:", e);
      }

      try {
        stopCrosshair = installCrosshairPlacement(ws);
      } catch (e) {
        console.warn("[trade-pro] crosshair placement failed:", e);
      }

      try {
        const chart = getSafeActiveChart(ws);
        chart?.renderer?.set?.({ currentPriceLine: true });
      } catch (e) {
        console.warn("[trade-pro] could not enable price line on panes:", e);
      }

      try {
        trackSelection(ws);
      } catch {
        /* chart not ready */
      }

      try {
        stopIsolation = installDrawingIsolation(ws);
      } catch (e) {
        console.warn("[trade-pro] drawing isolation re-install failed:", e);
      }
    };

    setupMarket();

    return () => {
      stopMarket?.();
      stopDefaults?.();
      stopSymbols?.();
      stopIndicators?.();
      stopCrosshair?.();
      stopIsolation?.();
    };
  }, [coin, timeframe]);

  // Synchronize the custom replay dock with Vela's native topbar action.
  useEffect(() => {
    const handleToggle = () => {
      if (replayActiveRef.current) {
        replayActiveRef.current = false;
        try { wsRef.current?.replay.stop(); } catch {}
        setReplayActive(false);
      } else {
        replayActiveRef.current = true;
        setReplayActive(true);
      }
    };
    window.addEventListener("tradepro:toggle-replay", handleToggle);
    return () => window.removeEventListener("tradepro:toggle-replay", handleToggle);
  }, []);

  // Keep the native toolbar and mobile bar selected treatment in sync with the dock.
  useEffect(() => {
    try {
      const btns = document.querySelectorAll<HTMLElement>(
        "[data-action-id='replay'], button[aria-label*='Replay'], .vela-mb-item[aria-label*='Replay']"
      );
      btns.forEach((btn) => {
        btn.classList.toggle("active", replayActive);
        btn.classList.toggle("vela-mb-on", replayActive);
        if (replayActive) btn.setAttribute("data-active", "true");
        else btn.removeAttribute("data-active");
      });
    } catch { /* Vela may be remounting its topbar */ }
  }, [replayActive]);

  // Synchronize Favorite Drawing Tools toolbar state with topbar button and storage
  const [favoritesOpen, setFavoritesOpen] = useState(() => {
    try {
      const saved = localStorage.getItem("trade-pro:favs-open");
      return saved !== null ? saved === "1" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handleToggle = () => setFavoritesOpen((v) => !v);
    window.addEventListener("tradepro:toggle-favorites", handleToggle);
    return () => window.removeEventListener("tradepro:toggle-favorites", handleToggle);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("trade-pro:favs-open", favoritesOpen ? "1" : "0");
    } catch {}

    const updateTopbarActiveState = () => {
      const btns = document.querySelectorAll<HTMLElement>(
        "[data-action-id='tradepro-tools'], button[aria-label*='Favorite']"
      );
      btns.forEach((btn) => {
        btn.classList.toggle("active", favoritesOpen);
        btn.classList.toggle("is-active", favoritesOpen);
        if (favoritesOpen) {
          btn.setAttribute("data-active", "true");
          btn.style.color = "#2962ff";
        } else {
          btn.removeAttribute("data-active");
          btn.style.color = "";
        }
      });
    };
    updateTopbarActiveState();
    const t = setTimeout(updateTopbarActiveState, 200);
    return () => clearTimeout(t);
  }, [favoritesOpen]);

  // TradingView-Style Chart Hotkeys:
  // - Shift+R: Toggle Bar Replay
  // - Alt+T: Trend Line, Alt+H: Horizontal Line, Alt+V: Vertical Line, Alt+F: Fib Retracement, Alt+J: Channel, Alt+B: Box
  // - Alt+M: Measure Ruler, Alt+R: Reset/Auto Scale, Alt+L: Lock Drawings, Alt+C: Hide Drawings
  // - Ctrl+Z / Ctrl+Y: Undo/Redo drawing
  // - Delete / Backspace: Remove selected drawing
  // - Digits / d,w,m / comma: Change interval modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is currently typing in an input, textarea, select, or editable element
      const active = document.activeElement;
      if (active) {
        const tag = active.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        if (active.getAttribute("contenteditable") === "true") return;
        if (active.getAttribute("role") === "textbox" || active.getAttribute("role") === "combobox") return;
      }

      // Ignore if any full-screen modal or dialog is already open
      const hasOpenModal = document.querySelector(
        ".indicators-modal-overlay, .settings-modal-overlay, .auth-modal-overlay, .pine-editor-overlay, [data-scope='dialog'][data-part='content'], .change-interval-modal-overlay"
      );
      if (hasOpenModal) return;

      const ws = wsRef.current;
      const chart = getSafeActiveChart(ws);

      // Shift+R: Toggle Bar Replay
      if (e.shiftKey && (e.code === "KeyR" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("tradepro:toggle-replay"));
        return;
      }

      // Alt+T: Trendline
      if (e.altKey && (e.code === "KeyT" || e.key?.toLowerCase() === "t")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("trendline");
        return;
      }

      // Alt+H: Horizontal Line
      if (e.altKey && (e.code === "KeyH" || e.key?.toLowerCase() === "h")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("hline");
        return;
      }

      // Alt+V: Vertical Line
      if (e.altKey && (e.code === "KeyV" || e.key?.toLowerCase() === "v")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("vline");
        return;
      }

      // Alt+F: Fib Retracement
      if (e.altKey && (e.code === "KeyF" || e.key?.toLowerCase() === "f")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("fibretracement");
        return;
      }

      // Alt+J: Parallel Channel
      if (e.altKey && (e.code === "KeyJ" || e.key?.toLowerCase() === "j")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("parallelchannel");
        return;
      }

      // Alt+B: Box / Rectangle
      if (e.altKey && (e.code === "KeyB" || e.key?.toLowerCase() === "b")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.drawings?.setTool?.("box");
        return;
      }

      // Alt+M: Measure Tool (Ruler)
      if (e.altKey && (e.code === "KeyM" || e.key?.toLowerCase() === "m")) {
        e.preventDefault();
        e.stopPropagation();
        const curMode = chart?.drawings?.getMode?.();
        chart?.drawings?.setMode?.(curMode === "measure" ? null : "measure");
        return;
      }

      // Alt+R: Auto Scale / Fit View
      if (e.altKey && (e.code === "KeyR" || e.key?.toLowerCase() === "r")) {
        e.preventDefault();
        e.stopPropagation();
        chart?.renderer?.resetScale?.();
        chart?.renderer?.fitContent?.();
        return;
      }

      // Alt+L: Lock / Unlock all drawings
      if (e.altKey && (e.code === "KeyL" || e.key?.toLowerCase() === "l")) {
        e.preventDefault();
        e.stopPropagation();
        const all = chart?.drawings?.all?.() || [];
        const anyUnlocked = all.some((d: any) => !d.locked);
        all.forEach((d: any) => {
          if (typeof chart.drawings.setLocked === "function") {
            chart.drawings.setLocked(d.id, anyUnlocked);
          } else if (typeof chart.drawings.lock === "function") {
            chart.drawings.lock(d.id, anyUnlocked);
          }
        });
        return;
      }

      // Alt+C: Hide / Show all drawings
      if (e.altKey && (e.code === "KeyC" || e.key?.toLowerCase() === "c")) {
        e.preventDefault();
        e.stopPropagation();
        const all = chart?.drawings?.all?.() || [];
        const anyVisible = all.some((d: any) => d.visible !== false);
        all.forEach((d: any) => {
          if (typeof chart.drawings.setVisible === "function") {
            chart.drawings.setVisible(d.id, !anyVisible);
          } else if (typeof chart.drawings.show === "function") {
            chart.drawings.show(d.id, !anyVisible);
          }
        });
        return;
      }

      // Ctrl+Z: Undo drawing
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyZ" || e.key?.toLowerCase() === "z") && !e.shiftKey) {
        if (chart?.drawings?.canUndo?.() || typeof chart?.drawings?.undo === "function") {
          e.preventDefault();
          e.stopPropagation();
          chart.drawings.undo();
          return;
        }
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo drawing
      if (
        ((e.ctrlKey || e.metaKey) && (e.code === "KeyY" || e.key?.toLowerCase() === "y")) ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyZ" || e.key?.toLowerCase() === "z"))
      ) {
        if (chart?.drawings?.canRedo?.() || typeof chart?.drawings?.redo === "function") {
          e.preventDefault();
          e.stopPropagation();
          chart.drawings.redo();
          return;
        }
      }

      // Delete or Backspace: Remove selected drawing
      if (e.key === "Delete" || e.key === "Backspace") {
        const sel = chart?.drawings?.selected?.() || [];
        if (sel.length) {
          e.preventDefault();
          e.stopPropagation();
          chart.drawings.removeMany(sel.map((d: any) => d.id || d));
          return;
        }
      }

      // Ignore if modifier keys are pressed for interval jump
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;
      const isDigit = /^[0-9]$/.test(key);
      const isTimeframeLetter = /^[dwmDWM]$/.test(key);
      const isComma = key === ",";

      if (isDigit || isTimeframeLetter || isComma) {
        e.preventDefault();
        e.stopPropagation();
        const initialVal = isComma ? "" : key;
        window.dispatchEvent(
          new CustomEvent("tradepro:open-change-interval", {
            detail: { initialValue: initialVal },
          })
        );
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      className="vela-chart-container"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <div ref={ref} className="vela-host" />
      {/** Favorites toolbar mounted directly inside chart canvas for full flexibility and responsiveness */}
      {favoritesOpen && (
        <ErrorBoundary>
          <FavoritesBar ws={wsInstance} />
        </ErrorBoundary>
      )}
      {/** Workspace-native bar actions toggle custom tool palettes and app dialogs. */}
      <ErrorBoundary>
        <ChartBarReplay
          ws={wsInstance}
          coin={coin}
          timeframe={timeframe}
          active={replayActive}
          onClose={closeReplay}
        />
      </ErrorBoundary>
      <ErrorBoundary>
        <ChartRadialMenu ws={wsInstance} />
      </ErrorBoundary>
      <ErrorBoundary>
        <ChangeIntervalModal ws={wsInstance} currentTf={timeframe} />
      </ErrorBoundary>
          </div>
  );
}

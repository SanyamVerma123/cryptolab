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
import { useEffect, useRef, useState } from "react";
import {
  VelaWorkspace,
  registerLayout,
  registerBuiltinLayouts,
  ensureLayout,
} from "@luxalgo/vela/workspace";
import { registerIcon, registerWidgetAction } from "@luxalgo/vela/plugin";
import { HyperliquidProvider } from "@luxalgo/vela/providers/hyperliquid";
import { BinanceProvider } from "@luxalgo/vela/providers/binance";
import { CoinbaseProvider } from "@luxalgo/vela/providers/coinbase";
import { PineEngine } from "@luxalgo/vela-pinets";
import { syncCustomLibrary } from "./PineEditor";
import { installToolDefaults } from "../lib/toolDefaults";
import { installPerSymbolDrawings } from "../lib/perSymbolDrawings";
import { installIndicatorState } from "../lib/indicatorState";
import { installCrosshairPlacement } from "../lib/crosshairPlacement";
import { restoreLuxIndicators } from "../lib/luxPersist";
import { restorePineIndicators } from "../lib/pinePersist";
import { trackSelection } from "../lib/drawingPresets";
import { mountMarket } from "../lib/marketData";
import { installDrawingIsolation } from "../lib/drawingInteractions";
import { AlpacaProvider } from "../lib/alpacaProvider";
import { TwelveDataProvider } from "../lib/twelveDataProvider";
import { AlphaVantageProvider } from "../lib/alphaVantageProvider";
import { ChartBarReplay } from "./ChartBarReplay";
import { ChartRadialMenu } from "./ChartRadialMenu";
import { ErrorBoundary } from "./ErrorBoundary";

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

// Register native Replay topbar action into Vela's left cluster
try {
  registerWidgetAction({
    id: "replay",
    target: "topbar",
    align: "left",
    order: 10,
    icon: "replay",
    label: "Replay",
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
  "1": 1200, "3": 1200, "5": 1200, "15": 1200, "30": 1200,
  "45": 1000, "60": 1000, "120": 800, "180": 800, "240": 700,
  "360": 600, "480": 500, "720": 400,
  D: 365, W: 260, M: 120,
};

function barsForTf(tf: string): number {
  return TF_BARS[tf] ?? 500;
}

export function VelaChart({ coin, timeframe, onReady }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<VelaWorkspace | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const [wsInstance, setWsInstance] = useState<VelaWorkspace | null>(null);
  const [replayActive, setReplayActive] = useState<boolean>(false);

  // Mount once. React 19 Strict Mode double-invokes effects in dev, so guard.
  useEffect(() => {
    const el = ref.current;
    if (!el || wsRef.current) return;

    const ws = new VelaWorkspace(el, {
      layout: "1", // Single chart initial, native layout picker & sync engine active!
      engines: {
        pine: () => new PineEngine(),
      },
      symbol: coin,
      timeframe,
      bars: barsForTf(timeframe),
      live: true,
      theme: "dark",
      autofocus: true,
      // Persist market, style, timezone, drawings and indicators to localStorage.
      persist: true,
      // Multi-provider feed: all providers provided by Vela + Alpaca + TwelveData + AlphaVantage
      providers: {
        hyperliquid: () => new HyperliquidProvider(),
        binance: () => new BinanceProvider(),
        coinbase: () => new CoinbaseProvider(),
        alpaca: () => new AlpacaProvider(),
        twelvedata: () => new TwelveDataProvider(),
        alphavantage: () => new AlphaVantageProvider(),
      },
      drawings: true, // the full 84-tool surface with the shared toolbar
      drawingToolbar: true, // shared toolbar for the workspace
      maxWebglCells: 8, // budget policy
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
    wsRef.current = ws;
    setWsInstance(ws);

    // Enforce strict cap: max 8 charts in setLayout
    const origSetLayout = ws.setLayout.bind(ws);
    ws.setLayout = (layout: unknown) => {
      let def = typeof layout === "string" ? ensureLayout(layout) : layout as { cells?: unknown[] };
      if (def && def.cells && def.cells.length > 8) {
        console.warn("[trade-pro] layout exceeds max 8 charts, capping at 8");
        return origSetLayout("8");
      }
      return origSetLayout(layout as any);
    };

    ws.on("cell:created", () => {
      try {
        installDrawingIsolation(ws);
      } catch (e) {
        console.warn("[trade-pro] cell isolation install failed:", e);
      }
    });

    const initCell = () => {
      if (!wsRef.current) return;
      try {
        const chart = (ws as any).active ? ws.chart : null;
        if (!chart) return;
        chart
          .ready()
          .then(() => {
            if (!wsRef.current) return;
            try {
              syncCustomLibrary(ws);
            } catch (e) {
              console.warn("[trade-pro] custom library sync failed:", e);
            }
            try {
              installToolDefaults(ws);
            } catch (e) {
              console.warn("[trade-pro] tool defaults install failed:", e);
            }
            try {
              installDrawingIsolation(ws);
            } catch (e) {
              console.warn("[trade-pro] drawing isolation install failed:", e);
            }

            onReadyRef.current?.(ws);
          })
          .catch((e) => console.error("[trade-pro] vela ready failed", e));
      } catch (e) {
        console.warn("[trade-pro] initCell error:", e);
      }
    };

    initCell();
    ws.on("cell:active", initCell);

    return () => {
      try {
        ws.destroy();
      } catch {
        /* already gone */
      }
      wsRef.current = null;
      setWsInstance(null);
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

    const restoreLux = () => {
      try {
        const sym = (ws as any).active ? ws.chart?.market?.symbol : undefined;
        if (!sym) return;
        void restoreLuxIndicators(ws, sym).then((r) => {
          if (r.failed.length) {
            console.warn(
              "[trade-pro] some library indicators could not be restored:",
              r.failed
            );
          }
        });
      } catch (e) {
        console.warn("[trade-pro] lux restore failed:", e);
      }
    };

    const restorePine = () => {
      try {
        const sym = (ws as any).active ? ws.chart?.market?.symbol : undefined;
        if (!sym) return;
        void restorePineIndicators(ws, sym).then((r) => {
          if (r.failed.length) {
            console.warn(
              "[trade-pro] some custom indicators could not be restored:",
              r.failed
            );
          }
        });
      } catch (e) {
        console.warn("[trade-pro] pine restore failed:", e);
      }
    };

    const setupMarket = () => {
      try {
        const chart = (ws as any).active ? ws.chart : null;
        if (chart) {
          chart.setMarket({ symbol: coin, timeframe, bars: barsForTf(timeframe) });
        }
      } catch (e) {
        console.error("[trade-pro] setMarket failed", e);
      }

      restoreLux();
      restorePine();
      stopMarket = mountMarket(ws, { symbol: coin, timeframe });

      try {
        stopDefaults = installToolDefaults(ws);
      } catch (e) {
        console.warn("[trade-pro] tool defaults re-install failed:", e);
      }

      try {
        stopSymbols = installPerSymbolDrawings(ws);
      } catch (e) {
        console.warn("[trade-pro] per-symbol drawings failed:", e);
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
        const chart = (ws as any).active ? ws.chart : null;
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

  // Synchronize Replay toggle event from native topbar action
  useEffect(() => {
    const handleToggle = () => setReplayActive((prev) => !prev);
    window.addEventListener("tradepro:toggle-replay", handleToggle);

    // Sync active attribute on topbar button
    try {
      const btn = document.querySelector<HTMLElement>("[data-action-id='replay'], button[aria-label*='Replay']");
      if (btn) {
        if (replayActive) {
          btn.classList.add("active");
          btn.setAttribute("data-active", "true");
        } else {
          btn.classList.remove("active");
          btn.removeAttribute("data-active");
        }
      }
    } catch {}

    return () => {
      window.removeEventListener("tradepro:toggle-replay", handleToggle);
    };
  }, [replayActive]);

  return (
    <div
      className="vela-chart-container"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <div ref={ref} className="vela-host" />
      <ErrorBoundary>
        <ChartBarReplay
          ws={wsInstance}
          coin={coin}
          timeframe={timeframe}
          active={replayActive}
          onClose={() => setReplayActive(false)}
        />
      </ErrorBoundary>
      <ErrorBoundary>
        <ChartRadialMenu ws={wsInstance} />
      </ErrorBoundary>
    </div>
  );
}

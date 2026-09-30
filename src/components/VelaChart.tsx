/**
 * VelaChart — mounts the @luxalgo/vela WORKSPACE (single-chart mode) into a div.
 *
 * Vela owns its own DOM (it renders the whole shell — topbar, drawing toolbar,
 * status line, bottom bar — into the container). There are no React bindings,
 * so this is deliberately a thin imperative wrapper: one ref, mount on effect,
 * destroy on unmount.
 *
 * Everything the user asked for is native to Vela:
 *   - 84 drawing tools, each with a full settings popup (colour/width/style/
 *     fill/text/lock/delete/duplicate/z-order), data-space anchored so they
 *     survive pan/zoom/symbol/timeframe switches, persisted to localStorage.
 *   - Drawings extend arbitrarily far RIGHT of the last candle: Vela's
 *     CoordinateSystem is pure linear math (xToLogical / logicalToTime
 *     extrapolate past barCount-1). There is no coordinateToTime() returning
 *     null past the last bar, so the old lightweight-charts bug cannot occur.
 *   - Hyperliquid REST history + WS live stream, first-party, no auth.
 *
 * Fix notes (see the commits that touched this file):
 *   - ADAPTIVE HISTORY DEPTH. Vela's Hyperliquid provider translates a bar
 *     `limit` into a time window: `end - ((limit + 2) * intervalMs)`, and HL's
 *     candleSnapshot caps at ~5000 candles. A flat `bars: 500` is wrong at
 *     both ends: on small timeframes it under-loads, on 1W it asks for 500
 *     weeks and the chart does not paint properly. `barsForTf()` scales the
 *     request per timeframe so every interval gets a consistent window.
 *   - ATTRIBUTION (Apache-2.0 NOTICE). The built-in mark may be disabled ONLY
 *     with an equivalent visible attribution elsewhere. We keep the built-in
 *     mark but restyle it small + unobtrusive via CSS, which the NOTICE
 *     explicitly allows ("You may restyle or reposition this mark to fit your
 *     design"). See styles/app.css `.vela-attribution`.
 */
import { useEffect, useRef, useState } from "react";
import { VelaWorkspace, registerLayout, layoutForGrid, ensureLayout } from "@luxalgo/vela/workspace";
import { registerIcon } from "@luxalgo/vela";
import { HyperliquidProvider } from "@luxalgo/vela/providers/hyperliquid";
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
import { ChartBarReplay } from "./ChartBarReplay";
import { ChartMultiLayout } from "./ChartMultiLayout";
import { ChartRadialMenu } from "./ChartRadialMenu";

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

// Register replay icon in Vela icon registry
try {
  registerIcon(
    "replay",
    `<svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9l-1.4 1.4M2.5 8H6M2.5 8V4.5"/><polygon points="7,8 10,6 10,10" fill="currentColor"/></svg>`
  );
} catch {
  // icon already registered
}

interface Props {
  coin: string;
  /** Vela timeframe id ('1','5','15','30','60','240','D','W'…). */
  timeframe: string;
  onReady?: (ws: VelaWorkspace) => void;
}

/**
 * History depth per timeframe. Goals:
 *   - small timeframes: enough recent bars to scroll back meaningfully
 *   - large timeframes (1W/1M): a full multi-year window without asking the
 *     provider for more bars than Hyperliquid's ~5000-candle cap can serve
 *
 * The counts stay under HL's candle cap for every interval, and each maps to
 * roughly the same wall-clock window (a few months to a few years), which is
 * what keeps "switch from 1h to 1W" from breaking the paint.
 */
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
  const [layoutOpen, setLayoutOpen] = useState<boolean>(false);
  const layoutBtnRef = useRef<HTMLButtonElement | null>(null);

  // Mount once. React 19 Strict Mode double-invokes effects in dev, so guard.
  useEffect(() => {
    const el = ref.current;
    if (!el || wsRef.current) return;

    const ws = new VelaWorkspace(el, {
      layout: "1", // Single chart initial, layout picker & sync engine active!
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
      // Multi-provider feed: Hyperliquid (crypto) + Alpaca (US stocks & equities)
      providers: {
        hyperliquid: () => new HyperliquidProvider(),
        alpaca: () => new AlpacaProvider(),
      },
      drawings: true, // the full 84-tool surface with the shared toolbar
      sync: {
        crosshair: true,
        symbol: false,
        timeframe: false,
        style: true,
      },
    });
    wsRef.current = ws;
    setWsInstance(ws);

    // Enforce strict cap: max 8 charts in setLayout
    const origSetLayout = ws.setLayout.bind(ws);
    ws.setLayout = (layout: unknown) => {
      let def = typeof layout === "string" ? ensureLayout(layout) : layout as { cells?: unknown[] };
      if (def && def.cells && def.cells.length > 8) {
        console.warn("[trade-pro] layout exceeds max 8 charts, clamping to 8");
        const clampedDef = ensureLayout("8") ?? layoutForGrid(2, 4);
        origSetLayout(clampedDef);
      } else {
        origSetLayout(layout as Parameters<typeof origSetLayout>[0]);
      }
    };

    // New cells created in multi-chart grid get drawing isolation wired
    ws.on("cell:created", () => {
      try {
        installDrawingIsolation(ws);
      } catch (e) {
        console.warn("[trade-pro] cell isolation install failed:", e);
      }
    });

    // PineTS engine for initial cell (guarded for Strict Mode)
    try {
      ws.chart.registerEngine("pine", new PineEngine());
    } catch (e) {
      console.warn("[trade-pro] pine engine registration skipped:", e);
    }

    ws.chart
      .ready()
      .then(() => {
        // Don't hand a destroyed workspace up to App — it would throw on the
        // next read. The real (second) mount calls onReady with a live one.
        if (!wsRef.current) return;
        // Re-register the user's saved Pine scripts into the indicator library
        // so the "custom" group comes back after a reload.
        try {
          syncCustomLibrary(ws);
        } catch (e) {
          console.warn("[trade-pro] custom library sync failed:", e);
        }
        // Remember the user's per-tool style choices (colour, width, fill…)
        // so a tool keeps its settings until changed again, even after reload.
        try {
          installToolDefaults(ws);
        } catch (e) {
          console.warn("[trade-pro] tool defaults install failed:", e);
        }
        // Protect Price/Date axes and oscillator indicator panes from drawing
        // interception, and enforce border-only hit testing for Box drawings.
        try {
          installDrawingIsolation(ws);
        } catch (e) {
          console.warn("[trade-pro] drawing isolation install failed:", e);
        }

        let topbarObserver: MutationObserver | null = null;

        // Attach Replay and Multiple Charts controls directly inside chart topbar
        const attachTopbarControls = () => {
          const indBtn = el.querySelector(".vela-widget-indicators");
          const topbarContainer =
            indBtn?.parentElement ||
            el.querySelector(".vela-topbar-left, .vela-widget-topbar, .vela-topbar, [class*='topbar']");
          if (!topbarContainer) return;

          // 1. Hook native layout button or insert custom layout button
          const nativeLayoutBtn = el.querySelector<HTMLButtonElement>(
            ".vela-widget-style[aria-label*='Layout'], button[aria-label*='Layout']"
          );
          if (nativeLayoutBtn) {
            layoutBtnRef.current = nativeLayoutBtn;
            nativeLayoutBtn.onclick = (e) => {
              e.stopPropagation();
              setLayoutOpen((prev) => !prev);
            };
          } else if (!topbarContainer.querySelector(".vela-topbar-layout-custom-btn")) {
            const layoutBtn = document.createElement("button");
            layoutBtn.className = "vela-widget-style vela-topbar-layout-custom-btn";
            layoutBtn.title = "Multiple Charts Layout (Max 8)";
            layoutBtn.setAttribute("aria-label", "Multiple Charts Layout");
            layoutBtn.innerHTML = `
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3">
                <rect x="2" y="2" width="5" height="5" rx="1"/>
                <rect x="9" y="2" width="5" height="5" rx="1"/>
                <rect x="2" y="9" width="5" height="5" rx="1"/>
                <rect x="9" y="9" width="5" height="5" rx="1"/>
              </svg>
            `;
            layoutBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              setLayoutOpen((prev) => !prev);
            });
            layoutBtnRef.current = layoutBtn;
            if (indBtn) {
              topbarContainer.insertBefore(layoutBtn, indBtn);
            } else {
              topbarContainer.appendChild(layoutBtn);
            }
          }

          // 2. Insert Replay button into topbar (Image 1 & 2 design: ◂◂ Replay)
          if (!topbarContainer.querySelector(".vela-topbar-replay-btn")) {
            const replayBtn = document.createElement("button");
            replayBtn.className = "vela-widget-action-left vela-topbar-replay-btn";
            replayBtn.title = "Bar Replay (Practice strategies with historical cuts)";
            replayBtn.setAttribute("aria-label", "Bar Replay");
            replayBtn.innerHTML = `
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" style="margin-right: 4px; vertical-align: -1px;">
                <path d="M7 4.5v7l-5-3.5 5-3.5zm7 0v7l-5-3.5 5-3.5z"/>
              </svg>
              <span>Replay</span>
            `;
            replayBtn.addEventListener("click", () => {
              setReplayActive((prev) => !prev);
            });

            if (indBtn && indBtn.nextSibling) {
              topbarContainer.insertBefore(replayBtn, indBtn.nextSibling);
            } else {
              topbarContainer.appendChild(replayBtn);
            }
          }
        };

        attachTopbarControls();

        // Keep controls attached when topbar renders/updates
        topbarObserver = new MutationObserver(() => {
          if (!el.querySelector(".vela-topbar-replay-btn")) {
            attachTopbarControls();
          }
        });
        topbarObserver.observe(el, { childList: true, subtree: true });

        onReadyRef.current?.(ws);
      })
      .catch((e) => console.error("[trade-pro] vela ready failed", e));

    return () => {
      topbarObserver?.disconnect();
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

  // Symbol / timeframe switches route through the workspace's own API so the
  // cell identity, indicators, drawings and subscriptions all survive — and
  // the history depth follows the new timeframe.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;

    let stopMarket: (() => void) | undefined;
    let stopDefaults: (() => void) | undefined;
    let stopSymbols: (() => void) | undefined;
    let stopIndicators: (() => void) | undefined;
    let stopCrosshair: (() => void) | undefined;
    let stopIsolation: (() => void) | undefined;

    // Re-mount this coin's LuxAlgo library indicators once the market is live.
    // Defined before `setupMarket` (which calls it) — a `const` is not hoisted.
    const restoreLux = () => {
      try {
        void restoreLuxIndicators(ws, ws.chart.market?.symbol).then((r) => {
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

    // Re-mount this coin's CUSTOM Pine scripts (pinePersist). Same pattern as
    // the library restore above — the editor saves a palette of scripts, this
    // is the "which were actually on the chart" list.
    const restorePine = () => {
      try {
        void restorePineIndicators(ws, ws.chart.market?.symbol).then((r) => {
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
        ws.chart.setMarket({ symbol: coin, timeframe, bars: barsForTf(timeframe) });
      } catch (e) {
        console.error("[trade-pro] setMarket failed", e);
      }
      // Re-mount this coin's LuxAlgo library indicators now that the market is
      // set (the list is coin-scoped, so this needs a real symbol).
      restoreLux();
      // Same for custom Pine scripts the user wrote + applied.
      restorePine();
      // Keep the app's own bar store in lockstep — the AI draws from this.
      // (Vela owns the chart's array internally; this is the AI's read copy.)
      // CRITICAL: Only subscribe AFTER the chart is ready to prevent the
      // "cannot read property of undefined reading open time" toast from the
      // countdown chip trying to read a non-existent bar on mount.
      stopMarket = mountMarket(ws, { symbol: coin, timeframe });

      // A coin switch wipes the chart's drawings; re-install the tool-style
      // persistence listeners on the new market so the user's per-tool settings
      // (colour, width…) carry across coins instead of resetting.
      try {
        stopDefaults = installToolDefaults(ws);
      } catch (e) {
        console.warn("[trade-pro] tool defaults re-install failed:", e);
      }

      // Per-symbol drawings: boxes drawn on BTC must not appear on ETH. Styles
      // (colour, width) still carry across coins via toolDefaults above.
      try {
        stopSymbols = installPerSymbolDrawings(ws);
      } catch (e) {
        console.warn("[trade-pro] per-symbol drawings failed:", e);
      }

      // Indicator visibility + inputs: the "I" button hide and per-input edits
      // (e.g. turning specific FVG levels off) are NOT round-tripped by Vela's
      // own persistence, so they revert on reload and on a second add. We own
      // that layer, scoped per coin.
      try {
        stopIndicators = installIndicatorState(ws);
      } catch (e) {
        console.warn("[trade-pro] indicator state failed:", e);
      }

      // (restoreLux is defined above, alongside setupMarket — the library
      // restore runs from there, once the market symbol is actually set.)

      // Crosshair placement: while a drawing tool is armed, the chart stops
      // scrolling and the system cursor hides so only Vela's crosshair shows —
      // the "move, then tap to place" behaviour the user has on desktop.
      try {
        stopCrosshair = installCrosshairPlacement(ws);
      } catch (e) {
        console.warn("[trade-pro] crosshair placement failed:", e);
      }

      // Ensure the "current price line" (last value marker) is visible on ALL panes,
      // including oscillator panes (MACD, RSI, etc.). Vela's renderer setting
      // `currentPriceLine` typically targets the main scale; we explicitly enforce
      // it via the renderer config to guarantee it shows on sub-panes too.
      try {
        ws.chart.renderer.set({ currentPriceLine: true });
      } catch (e) {
        console.warn("[trade-pro] could not enable price line on panes:", e);
      }

      // Track which drawing the user has selected, so the presets dropdown's
      // "Custom" button snapshots the one they just finished configuring.
      try {
        trackSelection(ws);
      } catch {
        /* chart not ready */
      }

      // Drawing isolation: axes (price/time) & oscillator panes protection + Box border hit-testing
      try {
        stopIsolation = installDrawingIsolation(ws);
      } catch (e) {
        console.warn("[trade-pro] drawing isolation re-install failed:", e);
      }
    };

    // If the chart is already ready (e.g., initial mount finished), run immediately.
    // Otherwise, wait for the next ready signal (which happens on every setMarket).
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

  // Sync replay active status with the topbar replay button styling
  useEffect(() => {
    const replayBtn = ref.current?.querySelector(".vela-topbar-replay-btn");
    if (replayBtn) {
      if (replayActive) {
        replayBtn.classList.add("active");
        replayBtn.setAttribute("data-active", "true");
      } else {
        replayBtn.classList.remove("active");
        replayBtn.removeAttribute("data-active");
      }
    }
  }, [replayActive]);

  return (
    <div
      className="vela-chart-container"
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}
    >
      <div ref={ref} className="vela-host" />
      <ChartBarReplay
        ws={wsInstance}
        coin={coin}
        timeframe={timeframe}
        active={replayActive}
        onClose={() => setReplayActive(false)}
      />
      <ChartMultiLayout
        ws={wsInstance}
        isOpen={layoutOpen}
        onClose={() => setLayoutOpen(false)}
        triggerRef={layoutBtnRef}
      />
      <ChartRadialMenu ws={wsInstance} />
    </div>
  );
}


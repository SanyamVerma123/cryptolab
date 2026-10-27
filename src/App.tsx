/**
 * trade-pro — App shell, v3.0 (Vela).
 *
 * The chart is now @luxalgo/vela/workspace. Vela renders
 * its own complete shell — topbar (symbol/timeframe/style/indicators), the
 * 84-tool drawing toolbar, status line, bottom bar — into its container, and
 * everything the user asked for is native to it:
 *   - drawing customization UI (colour/width/style/fill/text/lock/delete),
 *   - drawings extending arbitrarily far right of the last candle,
 *   - persistence across symbol/timeframe switches,
 *   - first-party Hyperliquid feed, no auth.
 *
 * Vela owns the shared chart shell and topbar. Trade Pro adds chart actions
 * through Vela's widget API and keeps order entry and market data in panels.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { ArrowLeftRight, BarChart2, Sparkles, BookOpen, X } from "lucide-react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MarketPanel } from "./components/MarketPanel";
import { AiPanel } from "./components/AiPanel";
import { ChartTradingOverlay } from "./components/ChartTradingOverlay";
import { OrderPlacementPanel } from "./components/OrderPlacementPanel";
import { BottomOrdersDrawer } from "./components/BottomOrdersDrawer";
import { UserMenu } from "./components/UserMenu";
import { initCloudSync } from "./lib/cloudSync";
import { HyperliquidSocket } from "./lib/hyperliquid";
import { useLiveData } from "./lib/useLiveData";
import { downloadChartSnapshot } from "./lib/chartSnapshot";
import { getSafeActiveChart, getSafeActiveCell } from "./lib/workspaceSafe";
import "./styles/app.css";
import "./styles/journal.css";
import { JournalPanel } from "./components/JournalPanel";
import { JournalDashboard } from "./components/JournalDashboard";
import { ChartTabsBar, formatTf, toVelaTf } from "./components/ChartTabsBar";

const VelaChart = lazy(() => import("./components/VelaChart").then((module) => ({ default: module.VelaChart })));
const PineEditor = lazy(() => import("./components/PineEditor").then((module) => ({ default: module.PineEditor })));
const IndicatorsModal = lazy(() => import("./components/IndicatorsModal").then((module) => ({ default: module.IndicatorsModal })));
const SettingsModal = lazy(() => import("./components/SettingsModal").then((module) => ({ default: module.SettingsModal })));
const AuthModal = lazy(() => import("./components/AuthModal").then((module) => ({ default: module.AuthModal })));

export default function App() {
  const [coin, setCoin] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("tradepro_active_coin");
      if (saved && saved.trim()) return saved.trim().toUpperCase();
      const savedTabs = localStorage.getItem("tradepro_chart_tabs_v2");
      const activeTabId = localStorage.getItem("tradepro_active_tab_id_v2");
      if (savedTabs && activeTabId) {
        const tabs = JSON.parse(savedTabs);
        const active = tabs.find((t: any) => t.id === activeTabId);
        if (active?.coin) return active.coin.toUpperCase();
      }
    } catch {}
    return "BTC";
  });

  const [tf, setTf] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("tradepro_active_timeframe");
      if (saved && saved.trim()) return toVelaTf(saved.trim());
      const savedTabs = localStorage.getItem("tradepro_chart_tabs_v2");
      const activeTabId = localStorage.getItem("tradepro_active_tab_id_v2");
      if (savedTabs && activeTabId) {
        const tabs = JSON.parse(savedTabs);
        const active = tabs.find((t: any) => t.id === activeTabId);
        if (active?.timeframe) return toVelaTf(active.timeframe);
      }
    } catch {}
    return "60";
  });

  const [ws, setWs] = useState<VelaWorkspace | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelMode, setPanelMode] = useState<"data" | "order" | "ai" | "journal">("order");
  const [bottomOrdersOpen, setBottomOrdersOpen] = useState(false);
  const [ordersFocusTab, setOrdersFocusTab] = useState<"positions" | "orders" | "strategy_tester">("positions");
  const [ordersFocusRequest, setOrdersFocusRequest] = useState(0);
  const [pineOpen, setPineOpen] = useState(false);
  const [indicatorsOpen, setIndicatorsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [journalFullOpen, setJournalFullOpen] = useState(false);

  useEffect(() => {
    const cleanup = initCloudSync();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (coin) {
      try {
        localStorage.setItem("tradepro_active_coin", coin);
      } catch {}
    }
  }, [coin]);

  useEffect(() => {
    if (tf) {
      try {
        localStorage.setItem("tradepro_active_timeframe", tf);
      } catch {}
    }
  }, [tf]);

  // Chart-owned toolbar actions open these host React panels. Keeping the
  // controls in Vela's chart chrome makes them feel like chart tools rather
  // than unrelated app-level buttons.
  useEffect(() => {
    const openPine = () => setPineOpen((v) => !v);
    window.addEventListener("tradepro:toggle-pine", openPine);
    return () => {
      window.removeEventListener("tradepro:toggle-pine", openPine);
    };
  }, []);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("tradepro_right_panel_width");
      const maxW = Math.round(window.innerWidth * 0.4);
      return saved ? Math.min(maxW, Math.max(240, parseInt(saved, 10))) : 340;
    } catch {
      return 340;
    }
  });

  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    });

    if (window.matchMedia("(display-mode: standalone)").matches) {
      setIsInstalled(true);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
    };
  }, []);

  const handleInstallApp = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === "accepted") {
        setIsInstalled(true);
      }
      setInstallPrompt(null);
    } else {
      alert(
        "To install Trade Pro from Chrome:\n\n1. In Chrome, click the Install icon in the address bar (or Menu ⋮ -> 'Save and share' -> 'Install Trade Pro')\n2. Click 'Install' to add Trade Pro to your desktop or mobile home screen as a standalone app!\n3. Launch Trade Pro directly anytime with 1 click."
      );
    }
  };

  useEffect(() => {
    const toggles: [string, (e?: any) => void][] = [
      ["tradepro:toggle-trading", () => {
        setBottomOrdersOpen((v) => !v);
        setTimeout(() => { try { ws?.resize?.(); } catch {} }, 120);
      }],
      ["tradepro:toggle-journal", () => {
        setPanelOpen((open) => {
          if (open && panelMode === "journal") return false;
          setPanelMode("journal");
          return true;
        });
        setTimeout(() => { try { ws?.resize?.(); } catch {} }, 120);
      }],
      ["tradepro:open-journal", () => {
        setPanelMode("journal");
        setPanelOpen(true);
        setTimeout(() => { try { ws?.resize?.(); } catch {} }, 120);
      }],
      ["tradepro:open-journal-full", () => {
        setJournalFullOpen(true);
      }],
      ["tradepro:toggle-market", () => setPanelOpen((v) => !v)],
      ["tradepro:open-settings", () => setSettingsOpen(true)],
      ["tradepro:open-account", () => setAccountOpen((v) => !v)],
      ["tradepro:open-indicators", () => setIndicatorsOpen(true)],
      ["tradepro:install", () => void handleInstallApp()],
      [
        "tradepro:open-strategy-tester",
        () => {
          setOrdersFocusTab("strategy_tester");
          setOrdersFocusRequest((v) => v + 1);
          setBottomOrdersOpen(true);
          setTimeout(() => {
            try {
              ws?.resize?.();
            } catch {}
          }, 120);
        },
      ],
      ["tradepro:open-pine-editor", () => setPineOpen(true)],
      [
        "tradepro:snapshot",
        () => {
          void downloadChartSnapshot(ws, coin, tf);
        },
      ],
    ];
    toggles.forEach(([name, fn]) => window.addEventListener(name, fn));
    return () => toggles.forEach(([name, fn]) => window.removeEventListener(name, fn));
  }, [installPrompt, isInstalled, ws, coin, tf]);

  const handlePanelResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const handleEl = e.currentTarget;
    const startX = e.clientX;
    const startW = panelWidth;
    try {
      handleEl.setPointerCapture(e.pointerId);
    } catch {}
    document.body.classList.add("resizing-col");

    const onPointerMove = (ev: PointerEvent) => {
      ev.preventDefault();
      // Right-docked panel: dragging left (ev.clientX < startX) increases panel width
      const dx = startX - ev.clientX;
      const maxW = Math.round(window.innerWidth * 0.4); // max 2:5 ratio (40%)
      const minW = 240;
      const nextW = Math.max(minW, Math.min(maxW, startW + dx));
      setPanelWidth(nextW);
      try {
        localStorage.setItem("tradepro_right_panel_width", String(nextW));
      } catch {}
      try {
        ws?.resize?.();
      } catch {}
    };

    const onPointerUp = (ev: PointerEvent) => {
      try {
        handleEl.releasePointerCapture(ev.pointerId);
      } catch {}
      document.body.classList.remove("resizing-col");
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      try {
        ws?.resize?.();
      } catch {}
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
  };

  // One shared socket for the market panel (the chart uses Vela's own
  // Hyperliquid provider). Open it once and keep it for the session.
  const socket = useMemo(() => {
    const s = new HyperliquidSocket();
    // CONNECT: without this the socket is never opened — subscribe() would
    // only queue, and the trades tape + CVD would stay empty forever. The
    // panel subscribes on coin change; the socket replays queued subs on open.
    void s.connect();
    return s;
  }, []);
  const live = useLiveData(socket, panelOpen ? coin : "");

  // Keep the shell's symbol in sync when changed INSIDE Vela itself
  // (typed symbol search, digit entry, topbar dropdowns).
  // Guarded: in React 19 Strict Mode the FIRST Vela instance is destroyed and
  // a second mounted, but this state may briefly hold the destroyed one —
  // reading ws.chart on it throws "no active cell" and kills the render.
  //
  // NOTE on events: `cell:active` fires on FOCUS changes only. A symbol change
  /**
   * Vela prefixes the symbol with the provider when the market has a provider
   * (e.g. `hyperliquid:BTC`). Hyperliquid's REST/WS APIs want the BARE coin
   * (`BTC`), so strip any `provider:` prefix before handing it to the data
   * panel or the market store.
   */
  function bareSymbol(sym: string | undefined): string | undefined {
    if (!sym) return undefined;
    const i = sym.indexOf(":");
    return i === -1 ? sym : sym.slice(i + 1);
  }

  useEffect(() => {
    const onTfChange = (e: any) => {
      const nextTf = e?.detail?.timeframe;
      if (nextTf) {
        setTf(toVelaTf(nextTf));
      }
    };
    window.addEventListener("tradepro:change-timeframe", onTfChange);
    return () => window.removeEventListener("tradepro:change-timeframe", onTfChange);
  }, []);

  // emits `market:changed` on the CHART (not the workspace), so without that
  // listener the right-hand data panel would stay stuck on the old coin.
  useEffect(() => {
    if (!ws || (ws as any).destroyed) return;
    let dead = false;

    const readSym = () => {
      if (dead) return;
      try {
        const activeChart = getSafeActiveChart(ws);
        if (!activeChart) return;
        const fullSym = activeChart.market?.symbol;
        const sym = bareSymbol(fullSym)?.replace(/USDT$/i, "");
        if (sym) setCoin(sym);
        const tfVal = activeChart.market?.timeframe;
        if (tfVal) setTf(toVelaTf(tfVal));
      } catch {
        /* workspace torn down — ignore */
      }
    };

    const offActive = ws.on("cell:active", readSym);
    const offLayout = ws.on("layout:changed", readSym);

    // Wire market:changed across every live cell in the workspace
    const wiredCells = new Set<string>();
    const offsMarket: (() => void)[] = [];

    const wireCell = (cell: any) => {
      if (!cell || wiredCells.has(cell.id)) return;
      wiredCells.add(cell.id);
      try {
        const off = cell.chart?.on("market:changed", () => {
          if (getSafeActiveCell(ws)?.id === cell.id) {
            readSym();
          }
        });
        if (off) offsMarket.push(off);
      } catch {}
    };

    try {
      (ws.cells?.() ?? []).forEach(wireCell);
    } catch {}

    const offCreated = ws.on("cell:created", ({ id }: any) => {
      try {
        const cell = ws.cell(id);
        if (cell) wireCell(cell);
      } catch {}
    });

    return () => {
      dead = true;
      offActive?.();
      offLayout?.();
      offCreated?.();
      offsMarket.forEach((off) => off());
    };
  }, [ws]);

  return (
    <div className="app">
      <main className={"chart-area" + (panelOpen ? "" : " panel-closed")}>
        <div className="chart-main-column">
          {/* Top Multi-Chart Tabs Bar matching Image 1 */}
          <ChartTabsBar
            ws={ws}
            activeCoin={coin}
            activeTimeframe={tf}
            onSelect={(newCoin, newTf) => {
              const canonicalCoin = newCoin.toUpperCase().replace(/USDT$/i, "");
              const canonicalTf = toVelaTf(newTf);
              setCoin(canonicalCoin);
              setTf(canonicalTf);
            }}
          />

          <div className="chart-host">
            {accountOpen && <div className="workspace-account-overlay">
              <UserMenu externalOpen onOpenAuth={() => { setAuthOpen(true); setAccountOpen(false); }} />
            </div>}
            <ErrorBoundary fallback={<div className="chart-module-loading chart-module-error" role="alert">Chart workspace failed to load. Refresh the page to try again.</div>}>
              <Suspense fallback={<div className="chart-module-loading" role="status">Loading chart workspace…</div>}>
                <VelaChart coin={coin} timeframe={tf} onReady={(w) => {
                  // Expose for in-page diagnostics; harmless in production.
                  (window as unknown as { __ws?: VelaWorkspace }).__ws = w;
                  setWs(w);
                }} />
              </Suspense>
            </ErrorBoundary>
            {/* Live Chart Trading Overlay: TradingView style Entry, TP, SL Lines */}
            <ErrorBoundary>
              <ChartTradingOverlay ws={ws} coin={coin} data={live} />
            </ErrorBoundary>
            {/* Pine Script editor (PineTS engine registered in VelaChart). */}
            {pineOpen && <ErrorBoundary>
              <Suspense fallback={null}>
                <PineEditor ws={ws} open onOpenChange={setPineOpen} />
              </Suspense>
            </ErrorBoundary>}
            {/* Indicators modal matching screenshot */}
            {indicatorsOpen && <ErrorBoundary>
              <Suspense fallback={null}>
                <IndicatorsModal open onClose={() => setIndicatorsOpen(false)} ws={ws} />
              </Suspense>
            </ErrorBoundary>}
            {settingsOpen && <ErrorBoundary>
              <Suspense fallback={null}>
                <SettingsModal open onClose={() => setSettingsOpen(false)} onInstallApp={() => void handleInstallApp()} />
              </Suspense>
            </ErrorBoundary>}
            {authOpen && <ErrorBoundary>
              <Suspense fallback={null}>
                <AuthModal open onClose={() => setAuthOpen(false)} />
              </Suspense>
            </ErrorBoundary>}
            {journalFullOpen && (
              <ErrorBoundary>
                <JournalDashboard
                  mode="full"
                  onClose={() => setJournalFullOpen(false)}
                />
              </ErrorBoundary>
            )}
          </div>

          {/* Bottom Orders Drawer with '^' toggle icon at bottom-right corner */}
          <BottomOrdersDrawer
            ws={ws}
            currentCoin={coin}
            currentPrice={live.livePrice || live.trades?.[0]?.price || live.book?.mid || live.ctx?.markPx || live.ctx?.midPx || 0}
            isOpen={bottomOrdersOpen}
            focusTab={ordersFocusTab}
            focusRequest={ordersFocusRequest}
            onResize={() => {
              try {
                ws?.resize?.();
              } catch {}
            }}
            onToggle={() => {
              setBottomOrdersOpen((v) => !v);
              setTimeout(() => {
                try {
                  ws?.resize?.();
                } catch {}
              }, 120);
            }}
          />
        </div>

        {panelOpen && (
          <div
            className="panel-resizer-handle"
            onPointerDown={handlePanelResizeStart}
            title="Drag left or right to resize panel"
          >
            <div className="panel-resizer-line" />
          </div>
        )}

        {panelOpen && (
          <aside
            className="market-panel"
            style={{
              width: `${panelMode === "journal" ? Math.max(panelWidth, 540) : panelWidth}px`,
              flex: `0 0 ${panelMode === "journal" ? Math.max(panelWidth, 540) : panelWidth}px`,
              minWidth: panelMode === "journal" ? 380 : 240,
              maxWidth: `${panelMode === "journal" ? Math.max(640, Math.round(window.innerWidth * 0.6)) : Math.round(window.innerWidth * 0.4)}px`,
            }}
          >
            <div className="mp-head">
              <div className="mp-tabs" role="tablist" aria-label="Side panel tabs">
                <button
                  type="button"
                  role="tab"
                  className={"mp-tab" + (panelMode === "order" ? " on" : "")}
                  title="Trade & Order Placement"
                  aria-label="Order Placement"
                  onClick={() => setPanelMode("order")}
                >
                  <ArrowLeftRight size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  role="tab"
                  className={"mp-tab" + (panelMode === "data" ? " on" : "")}
                  title="Market Data & Order Book"
                  aria-label="Market Data"
                  onClick={() => setPanelMode("data")}
                >
                  <BarChart2 size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  role="tab"
                  className={"mp-tab" + (panelMode === "ai" ? " on" : "")}
                  title="AI Trading Assistant"
                  aria-label="AI Assistant"
                  onClick={() => setPanelMode("ai")}
                >
                  <Sparkles size={15} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  role="tab"
                  className={"mp-tab" + (panelMode === "journal" ? " on" : "")}
                  title="Trading Journal & Analytics"
                  aria-label="Trading Journal"
                  onClick={() => setPanelMode("journal")}
                >
                  <BookOpen size={15} strokeWidth={2} />
                </button>
              </div>
              <div className="mp-head-title">
                {panelMode === "order" && "Order Entry"}
                {panelMode === "data" && "Market Data"}
                {panelMode === "ai" && "AI Assistant"}
                {panelMode === "journal" && "Trading Journal"}
              </div>
              <button
                type="button"
                className="mp-close"
                title="Close panel"
                aria-label="Close panel"
                onClick={() => setPanelOpen(false)}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            {panelMode === "journal" ? (
              <div className="mp-body" style={{ height: "100%", overflow: "hidden" }}>
                <JournalPanel onClose={() => setPanelOpen(false)} />
              </div>
            ) : panelMode === "data" ? (
              <MarketPanel coin={coin} data={live} />
            ) : panelMode === "ai" ? (
              <div className="mp-body mp-ai-body">
                <AiPanel ws={ws} inline onPineOpen={() => setPineOpen(true)} />
              </div>
            ) : (
              <div className="mp-body">
                <OrderPlacementPanel
                  coin={coin}
                  data={live}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onOrderPlaced={(kind) => {
                    setOrdersFocusTab(kind === "order" ? "orders" : "positions");
                    setOrdersFocusRequest((v) => v + 1);
                    setBottomOrdersOpen(true);
                    setTimeout(() => {
                      try {
                        ws?.chart?.resize();
                      } catch {}
                    }, 120);
                  }}
                />
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

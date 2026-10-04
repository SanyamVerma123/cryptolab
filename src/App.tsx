/**
 * trade-pro — App shell, v3.0 (Vela).
 *
 * The chart is now @luxalgo/vela (workspace, single-chart mode). Vela renders
 * its own complete shell — topbar (symbol/timeframe/style/indicators), the
 * 84-tool drawing toolbar, status line, bottom bar — into its container, and
 * everything the user asked for is native to it:
 *   - drawing customization UI (colour/width/style/fill/text/lock/delete),
 *   - drawings extending arbitrarily far right of the last candle,
 *   - persistence across symbol/timeframe switches,
 *   - first-party Hyperliquid feed, no auth.
 *
 * What this shell still owns (per the user's call): the app top bar (symbol +
 * timeframe pickers, AI button, panel toggles) and the market panel
 * (stats / order book) docked beside the chart — closeable, so the chart can
 * go full width.
 */
import { useEffect, useMemo, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { VelaChart } from "./components/VelaChart";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MarketPanel } from "./components/MarketPanel";
import { AiPanel } from "./components/AiPanel";
import { FavoritesBar } from "./components/FavoritesBar";
import { PineEditor } from "./components/PineEditor";
import { IndicatorToggles } from "./components/IndicatorToggles";
import { SettingsModal } from "./components/SettingsModal";
import { ChartTradingOverlay } from "./components/ChartTradingOverlay";
import { LuxAlgoPanel } from "./components/LuxAlgoPanel";
import { OrderPlacementPanel } from "./components/OrderPlacementPanel";
import { BottomOrdersDrawer } from "./components/BottomOrdersDrawer";
import { UserMenu } from "./components/UserMenu";
import { AuthModal } from "./components/AuthModal";
import { initCloudSync } from "./lib/cloudSync";
import { HyperliquidSocket } from "./lib/hyperliquid";
import { useLiveData } from "./lib/useLiveData";
import "./styles/app.css";

const TIMEFRAMES: { label: string; vela: string }[] = [
  { label: "1m", vela: "1" },
  { label: "5m", vela: "5" },
  { label: "15m", vela: "15" },
  { label: "1h", vela: "60" },
  { label: "4h", vela: "240" },
  { label: "1D", vela: "D" },
  { label: "1W", vela: "W" },
];

export default function App() {
  const [coin, setCoin] = useState("BTC");
  const [tf, setTf] = useState("60");
  const [ws, setWs] = useState<VelaWorkspace | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelMode, setPanelMode] = useState<"data" | "order" | "ai">("order");
  const [bottomOrdersOpen, setBottomOrdersOpen] = useState(false);
  const [pineOpen, setPineOpen] = useState(false);
  const [indOpen, setIndOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [luxOpen, setLuxOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const cleanup = initCloudSync();
    return () => cleanup();
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

  // emits `market:changed` on the CHART (not the workspace), so without that
  // listener the right-hand data panel would stay stuck on the old coin.
  useEffect(() => {
    if (!ws) return;
    let dead = false;

    const readSym = () => {
      if (dead) return;
      try {
        const activeChart = (ws as any).active ? ws.chart : null;
        if (!activeChart) return;
        const fullSym = activeChart.market?.symbol;
        const sym = bareSymbol(fullSym);
        if (sym) setCoin(sym);
        const tfVal = activeChart.market?.timeframe;
        if (tfVal) setTf(tfVal);
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
        const off = cell.chart.on("market:changed", () => {
          if (ws.active?.id === cell.id) {
            readSym();
          }
        });
        offsMarket.push(off);
      } catch {}
    };

    try {
      ws.cells().forEach(wireCell);
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

  // Track when Vela's own indicator dialog is open (the toggle injector
  // re-factors its rows into switches while it is).
  // SCOPED + DEBOUNCED: observing the whole body subtree fires on every Vela
  // render tick and made the app hang while the indicator dialog was open.
  // The host element is created once by VelaChart; observe only it, and
  // collapse rapid mutations into one check.
  useEffect(() => {
    const host = document.querySelector(".vela-host") as HTMLElement | null;
    if (!host) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      setIndOpen(!!host.querySelector(".vela-ip-list"));
    };
    const mo = new MutationObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(check, 120);
    });
    mo.observe(host, { childList: true, subtree: true });
    check();
    return () => {
      if (t) clearTimeout(t);
      mo.disconnect();
    };
  }, [ws]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Trade&nbsp;Pro</div>

        {/* The user's starred drawing tools live OUT of the chart now — in the
            topbar, so they never cover candles. Vela's own tool icons; the
            strip is draggable by its title if it gets in the way. */}
        <FavoritesBar ws={ws} />

        {/* No coin picker here — Vela's own topbar has symbol search (type a
            letter), timeframe, style and the indicator dialog built in. */}

        <span className="topbar-spacer" />

        <div className="controls">
          <button
            className={"series-select icon-only-btn" + (pineOpen ? " on" : "")}
            title="Pine Script Editor"
            onClick={() => setPineOpen((v) => !v)}
            aria-label="Pine Script Editor"
          >
            <span className="ctl-ico" aria-hidden="true">
              {/* The real Pine Script mark, matching the Pine branding. */}
              <img
                src="/pine-logo.svg"
                alt="Pine"
                width={16}
                height={16}
                style={{ verticalAlign: "-2px", borderRadius: 3 }}
              />
            </span>
          </button>
          <button
            className={"series-select icon-only-btn" + (luxOpen ? " on" : "")}
            title="LuxAlgo Indicator Library"
            onClick={() => setLuxOpen((v) => !v)}
            aria-label="LuxAlgo Indicator Library"
          >
            <span className="ctl-ico" aria-hidden="true">✥</span>
          </button>
          <button
            className={"series-select icon-only-btn" + (panelOpen ? " on" : "")}
            title={panelOpen ? "Hide Market Panel" : "Show Market Panel"}
            onClick={() => setPanelOpen((v) => !v)}
            aria-label={panelOpen ? "Hide Market Panel" : "Show Market Panel"}
          >
            <span className="ctl-ico" aria-hidden="true">{panelOpen ? "◧" : "▦"}</span>
          </button>

          {/* Settings modal (Alpaca API Keys & Trading Preferences) */}
          <button
            className={"series-select icon-only-btn" + (settingsOpen ? " on" : "")}
            title="Alpaca Trading & App Settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            <span className="ctl-ico" aria-hidden="true">⚙</span>
          </button>

          {/* User Account & Supabase Cloud Sync */}
          <UserMenu onOpenAuth={() => setAuthOpen(true)} />

          {/* PWA Install / Download App button */}
          {!isInstalled && (
            <button
              className="series-select icon-only-btn pwa-install-btn"
              title="Install Trade Pro App"
              onClick={handleInstallApp}
              aria-label="Install Trade Pro App"
            >
              <span className="ctl-ico" aria-hidden="true">📥</span>
            </button>
          )}
        </div>
      </header>

      <main className={"chart-area" + (panelOpen ? "" : " panel-closed")}>
        <div className="chart-main-column">
          <div className="chart-host">
            <VelaChart coin={coin} timeframe={tf} onReady={(w) => {
              // Expose for in-page diagnostics; harmless in production.
              (window as unknown as { __ws?: VelaWorkspace }).__ws = w;
              setWs(w);
            }} />
            {/* Live Chart Trading Overlay: TradingView style Entry, TP, SL Lines */}
            <ErrorBoundary>
              <ChartTradingOverlay ws={ws} coin={coin} data={live} />
            </ErrorBoundary>
            {/* Pine Script editor (PineTS engine registered in VelaChart). */}
            <ErrorBoundary>
              <PineEditor ws={ws} open={pineOpen} onOpenChange={setPineOpen} />
            </ErrorBoundary>
            {/* The official LuxAlgo indicator library */}
            <ErrorBoundary>
              <LuxAlgoPanel ws={ws} open={luxOpen} onOpenChange={setLuxOpen} />
            </ErrorBoundary>
            {/* Indicator toggles */}
            <ErrorBoundary>
              <IndicatorToggles ws={ws} open={indOpen} />
            </ErrorBoundary>
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
          </div>

          {/* Bottom Orders Drawer with '^' toggle icon at bottom-right corner */}
          <BottomOrdersDrawer
            currentCoin={coin}
            currentPrice={live.livePrice || live.trades?.[0]?.price || live.book?.mid || live.ctx?.markPx || live.ctx?.midPx || 0}
            isOpen={bottomOrdersOpen}
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
              width: `${panelWidth}px`,
              flex: `0 0 ${panelWidth}px`,
              minWidth: 240,
              maxWidth: `${Math.round(window.innerWidth * 0.4)}px`,
            }}
          >
            <div className="mp-head">
              <div className="mp-tabs">
                <button
                  className={"mp-tab" + (panelMode === "order" ? " on" : "")}
                  title="Place Limit, Market, or Stop-Limit orders"
                  onClick={() => setPanelMode("order")}
                >
                  Order
                </button>
                <button
                  className={"mp-tab" + (panelMode === "data" ? " on" : "")}
                  title="Market data, order book, and trades"
                  onClick={() => setPanelMode("data")}
                >
                  Data
                </button>
                <button
                  className={"mp-tab" + (panelMode === "ai" ? " on" : "")}
                  title="AI Trading Assistant"
                  onClick={() => setPanelMode("ai")}
                >
                  ✦ AI
                </button>
              </div>
              <button
                className="mp-close"
                title="Close panel"
                onClick={() => setPanelOpen(false)}
              >
                ✕
              </button>
            </div>
            {panelMode === "data" ? (
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
                  onOrderPlaced={() => {
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

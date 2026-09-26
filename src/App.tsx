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
import { MarketPanel } from "./components/MarketPanel";
import { AiPanel } from "./components/AiPanel";
import { FavoritesBar } from "./components/FavoritesBar";
import { PineEditor } from "./components/PineEditor";
import { IndicatorToggles } from "./components/IndicatorToggles";
import { UpdateModal } from "./components/UpdateModal";
import { LuxAlgoPanel } from "./components/LuxAlgoPanel";
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
  const [aiOpen, setAiOpen] = useState(false);
  const [pineOpen, setPineOpen] = useState(false);
  const [indOpen, setIndOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [luxOpen, setLuxOpen] = useState(false);

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
        // `market.symbol` is provider-prefixed (e.g. "hyperliquid:BTC"); the
        // panel and the market store need the bare coin.
        const sym = bareSymbol(ws.chart.market?.symbol);
        if (sym) setCoin(sym);
      } catch {
        /* workspace torn down — ignore */
      }
    };

    // Focus/active-cell change (single-chart app: fires on chart activation).
    const offActive = ws.on("cell:active", readSym);
    // Symbol/timeframe change inside Vela — the one that actually matters for
    // keeping the data panel in sync with the chart.
    let offMarket: (() => void) | undefined;
    try {
      offMarket = ws.chart.on("market:changed", readSym);
    } catch {
      /* chart not ready yet (Strict Mode destroyed instance) */
    }

    return () => {
      dead = true;
      offActive?.();
      offMarket?.();
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
            className={"series-select ai-toggle" + (aiOpen ? " on" : "")}
            title="Show AI chat panel"
            onClick={() => setAiOpen((v) => !v)}
          >
            <span className="ctl-ico" aria-hidden="true">✦</span>
            <span className="ctl-text">AI</span>
          </button>
          <button
            className={"series-select" + (pineOpen ? " on" : "")}
            title="Open the Pine Script editor"
            onClick={() => setPineOpen((v) => !v)}
          >
            <span className="ctl-ico" aria-hidden="true">
              {/* The real Pine Script mark, matching the Pine branding. */}
              <img
                src="/pine-logo.svg"
                alt=""
                width={15}
                height={15}
                style={{ verticalAlign: "-2px", borderRadius: 3 }}
              />
            </span>
            <span className="ctl-text">Pine</span>
          </button>
          <button
            className={"series-select" + (luxOpen ? " on" : "")}
            title="Browse the LuxAlgo indicator library and add one to the chart"
            onClick={() => setLuxOpen((v) => !v)}
          >
            <span className="ctl-ico" aria-hidden="true">✥</span>
            <span className="ctl-text">LuxAlgo</span>
          </button>
          <button
            className={"series-select" + (panelOpen ? " on" : "")}
            title="Toggle market panel"
            onClick={() => setPanelOpen((v) => !v)}
          >
            <span className="ctl-ico" aria-hidden="true">{panelOpen ? "◧" : "▦"}</span>
            <span className="ctl-text">{panelOpen ? "Hide panel" : "Show panel"}</span>
          </button>

          {/* The full Update flow: a changelog pop-up (grouped "what's new",
              Cancel / Update), then a blank loading screen with a grouped
              checklist and progress bar that animates each step as it lands,
              then a reload with the refreshed modules. */}
          <button
            className={"series-select" + (updateOpen ? " on" : "")}
            title="See what's new and update all modules"
            onClick={() => setUpdateOpen(true)}
          >
            <span className="ctl-ico" aria-hidden="true">⟳</span>
            <span className="ctl-text">Update</span>
          </button>
        </div>
      </header>

      <main className={"chart-area" + (panelOpen ? "" : " panel-closed")}>
        <div className="chart-host">
          <VelaChart coin={coin} timeframe={tf} onReady={(w) => {
            // Expose for in-page diagnostics; harmless in production.
            (window as unknown as { __ws?: VelaWorkspace }).__ws = w;
            setWs(w);
          }} />
          {/* AI floating chat — opens from the topbar "✦ AI" button or the
              "Show AI chat" tab in the right panel. No button on the left
              side of the chart: it collided with the favorites bar. */}
          <AiPanel
            ws={ws}
            open={aiOpen}
            onOpenChange={setAiOpen}
            onPineOpen={() => setPineOpen(true)}
          />
          {/* Pine Script editor (PineTS engine registered in VelaChart). */}
          <PineEditor ws={ws} open={pineOpen} onOpenChange={setPineOpen} />
          {/* The official LuxAlgo indicator library: fetch a list, click a row,
              its Pine source is pulled and compiled onto the chart. */}
          <LuxAlgoPanel ws={ws} open={luxOpen} onOpenChange={setLuxOpen} />
          {/* Re-factors Vela's indicator dialog rows into front-of-row toggles
              while that dialog is open. */}
          <IndicatorToggles ws={ws} open={indOpen} />
          <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} />
        </div>
        {panelOpen && (
          <aside className="market-panel">
            <div className="mp-head">
              <div className="mp-tabs">
                <button
                  className={"mp-tab on"}
                  title="Market data for the current symbol"
                >
                  Show data
                </button>
                <button
                  className={"mp-tab" + (aiOpen ? " on" : "")}
                  title="Show AI chat panel"
                  onClick={() => setAiOpen((v) => !v)}
                >
                  Show AI chat
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
            <MarketPanel coin={coin} data={live} />
          </aside>
        )}
      </main>
    </div>
  );
}

/**
 * PineEditor — an in-chart Pine Script editor, opened from Vela's tool row.
 *
 * Vela ships NO scripting engine; PineTS (`@luxalgo/vela-pinets`) is registered
 * in VelaChart.tsx, so `chart.addIndicator(source)` compiles and runs real
 * Pine. This panel is the editor for it: type a script, Run it, read the
 * compile error inline if it fails.
 *
 * SAVED SCRIPTS: when a script runs successfully it is added to the chart's
 * indicator LIBRARY under a "custom" group via `addExternalIndicator`, so the
 * user's own indicators appear in the picker alongside the built-ins, by name,
 * and can be re-added after a reload. The library persists to localStorage.
 *
 * The panel docks over the chart like Vela's script editor.
 */
import { useEffect, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import {
  rememberPineIndicator,
  loadPineLibrary,
  savePineLibrary,
} from "../lib/pinePersist";
import { getIndicatorSource, listIndicators } from "../lib/luxAlgoClient";

interface Props {
  ws: VelaWorkspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STORE_KEY = "trade-pro:pine-source";
const LUX_LIBRARY_KEY = "trade-pro:lux-library-cache";
const LUX_COMPLETE_KEY = "trade-pro:lux-library-complete";
const luxPreloadByWorkspace = new WeakMap<VelaWorkspace, Promise<void>>();

const SAMPLE = `//@version=6
indicator("EMA + RSI bands", overlay=true)
emaLen = input.int(20, "EMA length")
rsiLen = input.int(14, "RSI length")
e = ta.ema(close, emaLen)
plot(e, "EMA", color=color.blue)
hline(70), hline(30)
plot(ta.rsi(close, rsiLen), "RSI", color=color.purple)`;

/** Extract a script's declared name: `indicator("My Indicator")` / `strategy(...)`. */
function scriptName(src: string): string | null {
  const m = src.match(/(?:indicator|strategy)\s*\(\s*(?:"([^"]*)"|'([^']*)')/);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * Register saved scripts with the chart's indicator catalog manifest without
 * auto-mounting them on the active chart. `cell.setManifest(..., false)` ensures
 * they appear in the library picker dialog, while on-chart persistence is handled
 * exclusively by `restorePineIndicators`.
 */
export function syncCustomLibrary(ws: VelaWorkspace): void {
  const lib = loadPineLibrary();
  try {
    let lux: Array<{ name: string; script: string }> = [];
    try {
      const raw = localStorage.getItem(LUX_LIBRARY_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      if (Array.isArray(saved)) lux = saved.filter((item) => item?.name && item?.script);
    } catch { /* an invalid cache must not block the chart */ }
    const manifest = [
        ...lib.map((s) => ({
          name: s.name,
          script: s.script,
          language: "pine",
          category: "My Scripts",
          enabled: false,
        })),
        ...lux.map((s) => ({ ...s, language: "pine", category: "LuxAlgo", enabled: false })),
      ];
    // Every chart cell gets the same picker catalog, including cells created by
    // a later grid change. Vela keeps each cell's applied instances separate.
    for (const cell of ws.cells()) {
      (cell as unknown as { setManifest?: (list: unknown[], seedEnabled: boolean) => void })
        .setManifest?.(manifest, false);
    }
  } catch {
    /* cell not ready */
  }
}

/** Populate Vela's native Indicators picker with the public LuxAlgo library. */
export function preloadLuxLibrary(ws: VelaWorkspace): Promise<void> {
  const existing = luxPreloadByWorkspace.get(ws);
  if (existing) return existing;
  const task = (async () => {
    const readCache = (): Array<{ slug: string; name: string; script: string }> => {
      try {
        const raw = localStorage.getItem(LUX_LIBRARY_KEY);
        const items = raw ? JSON.parse(raw) : [];
        return Array.isArray(items) ? items.filter((x) => x?.slug && x?.name && x?.script) : [];
      } catch { return []; }
    };
    let cached = readCache();
    syncCustomLibrary(ws);
    if (localStorage.getItem(LUX_COMPLETE_KEY) === "1") return;

    try {
      const first = await listIndicators("", 0, 100);
      const catalog = [...first.indicators];
      for (let page = 1; page * first.pageSize < first.total; page += 1) {
        const next = await listIndicators("", page, first.pageSize);
        catalog.push(...next.indicators);
      }
      const uniqueCatalog = [...new Map(catalog.filter((x) => x.slug).map((item) => [item.slug, item])).values()];
      const known = new Set(cached.map((x) => x.slug));
      const pending = uniqueCatalog.filter((x) => !known.has(x.slug));
      let cursor = 0;
      let dirtyCount = 0;
      let transientFailure = false;
      const workers = Array.from({ length: 3 }, async () => {
        while (cursor < pending.length) {
          const item = pending[cursor++];
          try {
            const result = await getIndicatorSource(item.slug);
            if (result.available && result.source) {
              cached.push({ slug: item.slug, name: item.name, script: result.source });
              known.add(item.slug);
              dirtyCount += 1;
            }
          } catch (error) {
            const reason = (error as Error).message || "";
            if (!reason.includes("not publicly available")) transientFailure = true;
          }
          if (dirtyCount >= 5) {
            try { localStorage.setItem(LUX_LIBRARY_KEY, JSON.stringify(cached)); } catch { /* cache is optional */ }
            syncCustomLibrary(ws);
            dirtyCount = 0;
          }
        }
      });
      await Promise.all(workers);
      try {
        localStorage.setItem(LUX_LIBRARY_KEY, JSON.stringify(cached));
        if (!transientFailure) localStorage.setItem(LUX_COMPLETE_KEY, "1");
      } catch { /* the current session catalog still works */ }
      syncCustomLibrary(ws);
      if (transientFailure) luxPreloadByWorkspace.delete(ws);
    } catch (error) {
      console.warn("[trade-pro] LuxAlgo catalog preload failed:", error);
      luxPreloadByWorkspace.delete(ws);
    }
  })();
  luxPreloadByWorkspace.set(ws, task);
  return task;
}

export function PineEditor({ ws, open, onOpenChange }: Props) {
  const [src, setSrc] = useState(() => {
    try {
      return localStorage.getItem(STORE_KEY) ?? SAMPLE;
    } catch {
      return SAMPLE;
    }
  });
  const [status, setStatus] = useState<string>("");
  const [ok, setOk] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(() => loadPineLibrary());
  const [history, setHistory] = useState<string[]>([src]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // Persist the draft so a reload doesn't lose work.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, src);
    } catch {
      /* ignore */
    }
  }, [src]);

  if (!open) return null;

  const run = () => {
    if (!ws) {
      setStatus("Chart not ready yet.");
      setOk(false);
      return;
    }
    setStatus("Compiling…");
    setOk(null);
    try {
      const handle = ws.chart.addIndicator(src);

      // The handle is usable synchronously (per Vela's IndicatorHandle docs),
      // so record the script for THIS coin immediately — do NOT wait for
      // `ready`. The engine can take many seconds to compile, and if `ready`
      // is late or never fires the script would still be on the chart but
      // forgotten by persistence, silently vanishing on the next reload.
      rememberPineIndicator(ws.chart.market?.symbol, src, handle.title, handle.id);

      const t = setTimeout(() => {
        setStatus("Timed out waiting for the engine.");
        setOk(false);
      }, 15_000);
      handle.on("ready", () => {
        clearTimeout(t);
        setStatus(`Running on the chart — ${handle.title}.`);
        setOk(true);

        // Save into the indicator library's "custom" group so it appears in the
        // picker by name and can be re-added after a reload.
        const name = scriptName(src) ?? handle.title ?? "Custom indicator";
        const lib = loadPineLibrary().filter((s) => s.name !== name);
        lib.push({ name, script: src });
        savePineLibrary(lib);
        // Re-record now that the compiled title is final (it can differ from
        // the pre-compile placeholder), keeping the same id → name mapping.
        rememberPineIndicator(ws.chart.market?.symbol, src, handle.title, handle.id);
        syncCustomLibrary(ws);
      });
      handle.on("error", (e: { error: Error }) => {
        clearTimeout(t);
        setStatus(e.error?.message ?? "Script failed.");
        setOk(false);
      });
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to run.");
      setOk(false);
    }
  };

  const saveDraft = () => {
    const name = scriptName(src) ?? "My script";
    const next = loadPineLibrary().filter((item) => item.name !== name);
    next.push({ name, script: src });
    savePineLibrary(next);
    setSaved(next);
    if (ws) syncCustomLibrary(ws);
    setStatus(`Saved “${name}” to My Scripts.`);
    setOk(true);
  };

  const editSource = (value: string) => {
    const next = [...history.slice(0, historyIndex + 1), value].slice(-80);
    setHistory(next);
    setHistoryIndex(next.length - 1);
    setSrc(value);
  };

  const stepHistory = (direction: -1 | 1) => {
    if (direction < 0) {
      const prior = history[historyIndex - 1];
      if (prior !== undefined) {
        setSrc(prior);
        setHistoryIndex(Math.max(0, historyIndex - 1));
      }
    } else if (historyIndex < history.length - 1) {
      const next = history[historyIndex + 1];
      setSrc(next);
      setHistoryIndex(historyIndex + 1);
    }
  };

  return (
    <div className="pine-panel" role="dialog" aria-label="Pine Script editor">
      <div className="pine-head">
        <div className="pine-action-box">
          <select className="pine-title-select" value={saved.some((item) => item.name === scriptName(src)) ? scriptName(src)! : "__draft"} onChange={(e) => {
            const item = saved.find((entry) => entry.name === e.target.value);
            if (item) setSrc(item.script);
          }} aria-label="Saved scripts">
            <option value="__draft">{scriptName(src) ?? "My script"}</option>
            {saved.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
          <button className="pine-run" onClick={run} title="Compile and run on chart">▶ <span>Run</span></button>
          <button className="pine-toolbar-icon" onClick={() => {
            const duplicate = src.replace(/((?:indicator|strategy)\s*\(\s*["'])([^"']+)(["'])/i, "$1$2 copy$3");
            editSource(duplicate);
            setStatus("Draft duplicated. Save it to My Scripts when ready.");
            setOk(null);
          }} title="Duplicate draft">▢</button>
          <button className="pine-toolbar-icon" onClick={saveDraft} title="Save to My Scripts">▣</button>
          <button className="pine-toolbar-icon" onClick={() => stepHistory(-1)} disabled={historyIndex <= 0} title="Undo">↶</button>
          <button className="pine-toolbar-icon" onClick={() => stepHistory(1)} disabled={historyIndex >= history.length - 1} title="Redo">↷</button>
        </div>
        <span className="pine-head-spacer" />
        <span className="pine-version">Pine v6</span>
        <button
          className="pine-x"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <div className="pine-code-area">
        <div className="pine-gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: Math.max(1, src.split("\n").length) }, (_, i) => <span key={i}>{i + 1}</span>)}
        </div>
        <textarea
          ref={editorRef}
          className="pine-editor"
          spellCheck={false}
          value={src}
          onChange={(e) => editSource(e.target.value)}
          onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
          placeholder={'//@version=6\nindicator("My indicator")\nplot(ta.ema(close, 20))'}
        />
      </div>
      {status && (
        <div className={"pine-status" + (ok === null ? "" : ok ? " ok" : " err")}>
          {status}
        </div>
      )}
    </div>
  );
}

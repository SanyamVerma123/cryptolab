/**
 * PineEditor — a floating Pine Script editor, opened from the "Pine" button.
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
 * The panel is draggable by its header, like the AI panel.
 */
import { useEffect, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws: VelaWorkspace | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STORE_KEY = "trade-pro:pine-source";
/** Saved custom scripts — the "custom" group in the indicator picker. */
const LIB_KEY = "trade-pro:pine-library";

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

interface SavedScript {
  name: string;
  script: string;
}

/** Load + save the custom library (survives reloads). */
function loadLibrary(): SavedScript[] {
  try {
    const raw = localStorage.getItem(LIB_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedScript[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveLibrary(lib: SavedScript[]): void {
  try {
    localStorage.setItem(LIB_KEY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}

/**
 * Register every saved script with the chart's indicator library. Vela exposes
 * `addExternalIndicator({name, script, language})` for exactly this — the
 * entries show in the picker after the natives, in our own order. Calling it
 * for an id/name already present is a safe no-op-ish update.
 */
export function syncCustomLibrary(ws: VelaWorkspace): void {
  const lib = loadLibrary();
  if (!lib.length) return;
  try {
    const cell = ws.active;
    for (const s of lib) {
      try {
        cell.addExternalIndicator({
          name: s.name,
          script: s.script,
          language: "pine",
        });
      } catch {
        /* already present or unsupported — skip */
      }
    }
  } catch {
    /* cell not ready */
  }
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
  const panelRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // Persist the draft so a reload doesn't lose work.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, src);
    } catch {
      /* ignore */
    }
  }, [src]);

  // Park bottom-left of the chart host on open.
  useEffect(() => {
    if (!open || !panelRef.current) return;
    panelRef.current.style.left = "16px";
    panelRef.current.style.top = "56px";
  }, [open]);

  const onHeadDown = (e: React.PointerEvent) => {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, px: e.clientX - r.left, py: e.clientY - r.top };
  };
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = panelRef.current;
      if (!d || !el) return;
      const host = el.closest(".chart-host") as HTMLElement | null;
      const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
      el.style.right = "auto";
      el.style.left = e.clientX - hr.left - d.px + "px";
      el.style.top = e.clientY - hr.top - d.py + "px";
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

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
        const lib = loadLibrary().filter((s) => s.name !== name);
        lib.push({ name, script: src });
        saveLibrary(lib);
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

  return (
    <div className="pine-panel" ref={panelRef} role="dialog" aria-label="Pine Script editor">
      <div className="pine-head" onPointerDown={onHeadDown}>
        <span className="pine-dot" />
        <span className="pine-title">Pine Script</span>
        <button
          className="pine-run"
          onClick={run}
          title="Compile and run on the chart"
        >
          Run ▶
        </button>
        <button
          className="pine-x"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
        >
          ✕
        </button>
      </div>
      <textarea
        className="pine-editor"
        spellCheck={false}
        value={src}
        onChange={(e) => setSrc(e.target.value)}
        placeholder="//@version=6&#10;indicator(&quot;My indicator&quot;)&#10;plot(ta.ema(close, 20))"
      />
      {status && (
        <div className={"pine-status" + (ok === null ? "" : ok ? " ok" : " err")}>
          {status}
        </div>
      )}
    </div>
  );
}

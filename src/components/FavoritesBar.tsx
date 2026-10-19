/**
 * FavoritesBar — 1:1 TradingView Favorite Drawing Tools Floating Toolbar
 *
 * Implements exact TradingView features, dimensions, colors, and layout:
 *   - Height: 38px (horizontal) / Width: 38px (vertical)
 *   - Dark surface: #1e222d with backdrop-filter: blur(8px), 1px solid #2a2e39 border, 6px border-radius
 *   - Light surface: rgba(255, 255, 255, 0.98), 1px solid #e0e3eb border
 *   - Button size: 30px × 30px with 4px border-radius, 18px × 18px crisp icons
 *   - Active tool state: #2962ff background, #ffffff icon
 *   - Drag handle: 8-dot matrix (2x4 or 4x2) with grab/grabbing cursor
 *   - Dual orientation: Seamless Horizontal <-> Vertical layout toggle (double-click grip, button, or context menu)
 *   - Right-click TradingView context menu (layout switch, tool management, reset position, hide toolbar)
 *   - Dedicated close button (✕) to dismiss toolbar
 *   - Tooltips with official TradingView hotkeys (Alt+T, Alt+H, Alt+F, Alt+J, Alt+B, etc.)
 *   - Utilities: Magnet snap (off/weak/strong), Stay in mode, Measure ruler, Lock all, Hide all, Clear all
 */
import { useEffect, useRef, useState, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { VELA_TOOLS, VELA_TOOL_MAP } from "../lib/velaToolIcons";
import {
  listPresets,
  savePreset,
  deletePreset,
  applyPreset,
  type DrawingPreset,
} from "../lib/drawingPresets";

interface Props {
  ws: VelaWorkspace | null;
}

/** Default starred tools matching TradingView popular defaults */
const DEFAULT_FAVS = [
  "trendline", "hline", "ray", "extendedline",
  "box", "circle", "arrow", "parallelchannel",
  "fibretracement", "fibextension", "pitchfork",
  "text", "note", "callout", "freehand", "anchoredvwap",
];

const POS_KEY = "trade-pro:favs-pos";
const ORIENTATION_KEY = "trade-pro:favs-orientation";

const TOOL_SHORTCUTS: Record<string, string> = {
  trendline: "Alt+T",
  hline: "Alt+H",
  vline: "Alt+V",
  fibretracement: "Alt+F",
  parallelchannel: "Alt+J",
  box: "Alt+B",
  measure: "Alt+M",
  text: "Alt+X",
};

function getToolTitle(t: string, metaLabel?: string): string {
  const label = metaLabel || t;
  const shortcut = TOOL_SHORTCUTS[t];
  return shortcut ? `${label} (${shortcut})` : label;
}

/**
 * Wrap Vela's svg24 inner markup in a real <svg> element.
 */
function velaIcon(inner: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</svg>"
  );
}

/** Group order, mirroring Vela's toolbar sections */
const GROUP_ORDER = [
  "lines", "shapes", "channels", "fib", "gann", "pitchfork",
  "annotations", "marks", "freehand", "measure", "patterns",
];

function groupLabel(g: string): string {
  return g.charAt(0).toUpperCase() + g.slice(1);
}

export function FavoritesBar({ ws }: Props) {
  const [favs, setFavs] = useState<string[]>([]);
  const [armed, setArmed] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [presets, setPresets] = useState<DrawingPreset[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetMsg, setPresetMsg] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Orientation: Horizontal (default) vs Vertical
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">(() => {
    try {
      const saved = localStorage.getItem(ORIENTATION_KEY);
      return saved === "vertical" ? "vertical" : "horizontal";
    } catch {
      return "horizontal";
    }
  });

  // Right-click context menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const barRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; dx: number; dy: number } | null>(null);
  const moved = useRef(false);

  // Toggle layout orientation
  const toggleOrientation = useCallback(() => {
    setOrientation((prev) => {
      const next = prev === "horizontal" ? "vertical" : "horizontal";
      try {
        localStorage.setItem(ORIENTATION_KEY, next);
      } catch {}
      return next;
    });
    setContextMenu(null);
  }, []);

  // Presets management
  const refreshPresets = () => setPresets(listPresets());
  useEffect(() => {
    refreshPresets();
  }, []);

  useEffect(() => {
    if (presetOpen) refreshPresets();
  }, [presetOpen]);

  const doSavePreset = () => {
    if (!ws) return;
    const p = savePreset(ws, presetName);
    if (p) {
      setPresetMsg(`Saved "${p.name}"`);
      setPresetName("");
      setNaming(false);
    } else {
      setPresetMsg("Nothing on chart to save — draw and configure first.");
    }
    refreshPresets();
    window.setTimeout(() => setPresetMsg(""), 2600);
  };

  const doApplyPreset = (p: DrawingPreset) => {
    if (!ws) return;
    const name = applyPreset(ws, p.id);
    if (name) setPresetMsg(`Applied "${name}"`);
    else setPresetMsg("Draw a matching shape first, then pick preset.");
    window.setTimeout(() => setPresetMsg(""), 2600);
  };

  const doDeletePreset = (id: string) => {
    deletePreset(id);
    refreshPresets();
  };

  // Dragging by the dotted grip handle
  const onGripDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
    moved.current = false;
    setIsDragging(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = barRef.current;
      if (!d || !el) return;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) {
        moved.current = true;
      }
      if (!moved.current) return;
      const host = el.closest(".chart-host") as HTMLElement | null;
      const hr = host?.getBoundingClientRect() ?? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const x = Math.max(8, Math.min(hr.width - el.offsetWidth - 8, e.clientX - hr.left - d.dx));
      const y = Math.max(8, Math.min(hr.height - el.offsetHeight - 8, e.clientY - hr.top - d.dy));
      el.style.position = "absolute";
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.right = "auto";
      el.style.bottom = "auto";
    };

    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      setIsDragging(false);
      const el = barRef.current;
      if (el && moved.current) {
        const host = el.closest(".chart-host") as HTMLElement | null;
        const r = el.getBoundingClientRect();
        const hr = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left - hr.left, y: r.top - hr.top }));
        } catch {}
      }
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  // Restore saved floating position
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (p && barRef.current) {
        barRef.current.style.position = "absolute";
        barRef.current.style.left = `${Math.max(8, p.x)}px`;
        barRef.current.style.top = `${Math.max(8, p.y)}px`;
        barRef.current.style.right = "auto";
        barRef.current.style.bottom = "auto";
      }
    } catch {}
  }, []);

  const resetPosition = () => {
    if (barRef.current) {
      barRef.current.style.position = "absolute";
      barRef.current.style.left = "24px";
      barRef.current.style.top = "auto";
      barRef.current.style.bottom = "76px";
      barRef.current.style.right = "auto";
      try {
        localStorage.removeItem(POS_KEY);
      } catch {}
    }
    setContextMenu(null);
  };

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  // Starred tools + armed tool sync from Vela
  useEffect(() => {
    if (!ws) return;
    let c: any = null;
    try {
      c = (ws as any).active ? ws.chart : null;
    } catch {
      return;
    }
    if (!c) return;

    const SEED = "trade-pro:favs-seeded";
    const read = () => {
      let list: string[];
      try {
        list = c.drawings.favorites() as string[];
      } catch {
        return;
      }
      if (!list.length && !localStorage.getItem(SEED)) {
        c.drawings.setFavorites(DEFAULT_FAVS as unknown as never[]);
        localStorage.setItem(SEED, "1");
        setFavs(DEFAULT_FAVS);
      } else {
        setFavs(list);
      }
      try {
        setArmed(c.drawings.getTool());
      } catch {}
    };
    void read();

    const offFav = c.on("drawing:favorites", read);
    const offTool = c.on("drawing:tool", () => {
      try {
        setArmed(c.drawings.getTool());
      } catch {}
    });
    return () => {
      offFav?.();
      offTool?.();
    };
  }, [ws]);

  const [snapMode, setSnapMode] = useState<"off" | "weak" | "strong">("off");
  const [stayMode, setStayMode] = useState(false);
  const [drawingMode, setDrawingMode] = useState<string | null>(null);
  const [allHidden, setAllHidden] = useState(false);
  const [allLocked, setAllLocked] = useState(false);

  useEffect(() => {
    if (!ws) return;
    let c: any = null;
    try {
      c = (ws as any).active ? ws.chart : null;
    } catch {
      return;
    }
    if (!c?.drawings) return;

    try {
      setSnapMode(c.drawings.getSnapMode?.() ?? "off");
      setStayMode(c.drawings.getStayMode?.() ?? false);
      setDrawingMode(c.drawings.getMode?.() ?? null);
    } catch {}

    const offSnap = c.on?.("drawing:snap", () => {
      try { setSnapMode(c.drawings.getSnapMode?.() ?? "off"); } catch {}
    });
    const offStay = c.on?.("drawing:stay", () => {
      try { setStayMode(c.drawings.getStayMode?.() ?? false); } catch {}
    });
    const offMode = c.on?.("drawing:mode", () => {
      try { setDrawingMode(c.drawings.getMode?.() ?? null); } catch {}
    });

    return () => {
      offSnap?.();
      offStay?.();
      offMode?.();
    };
  }, [ws]);

  const toggleSnap = () => {
    if (!ws) return;
    try {
      const next = snapMode === "off" ? "weak" : snapMode === "weak" ? "strong" : "off";
      ws.chart.drawings.setSnapMode(next as never);
      setSnapMode(next);
    } catch {}
  };

  const toggleStay = () => {
    if (!ws) return;
    try {
      const next = !stayMode;
      ws.chart.drawings.setStayMode(next);
      setStayMode(next);
    } catch {}
  };

  const toggleMeasure = () => {
    if (!ws) return;
    try {
      const next = drawingMode === "measure" ? null : "measure";
      ws.chart.drawings.setMode(next as never);
      setDrawingMode(next);
    } catch {}
  };

  const toggleHideAll = () => {
    if (!ws) return;
    try {
      const chart = (ws as any).active?.chart || ws.chart;
      if (!chart?.drawings) return;
      const next = !allHidden;
      const all = chart.drawings.all?.() || [];
      all.forEach((d: any) => {
        if (typeof chart.drawings.setVisible === "function") {
          chart.drawings.setVisible(d.id, !next);
        } else if (typeof chart.drawings.show === "function") {
          chart.drawings.show(d.id, !next);
        }
      });
      setAllHidden(next);
    } catch {}
  };

  const toggleLockAll = () => {
    if (!ws) return;
    try {
      const chart = (ws as any).active?.chart || ws.chart;
      if (!chart?.drawings) return;
      const next = !allLocked;
      const all = chart.drawings.all?.() || [];
      all.forEach((d: any) => {
        if (typeof chart.drawings.setLocked === "function") {
          chart.drawings.setLocked(d.id, next);
        } else if (typeof chart.drawings.lock === "function") {
          chart.drawings.lock(d.id, next);
        }
      });
      setAllLocked(next);
    } catch {}
  };

  const removeAll = () => {
    if (!ws) return;
    try {
      const all = ws.chart.drawings.all();
      if (!all.length) return;
      if (window.confirm("Remove all drawings on the chart?")) {
        ws.chart.drawings.removeMany(all.map((d: any) => d.id));
      }
    } catch {}
  };

  const arm = (type: string) => {
    if (!ws) return;
    try {
      const cur = ws.chart.drawings.getTool();
      ws.chart.drawings.setTool((cur === type ? null : type) as never);
    } catch (e) {
      console.warn("[favs] setTool failed:", e);
    }
  };

  const closeToolbar = () => {
    window.dispatchEvent(new CustomEvent("tradepro:toggle-favorites"));
  };

  const tool = (t: string) => VELA_TOOL_MAP[t];

  // Theme observer
  const [isLight, setIsLight] = useState(false);
  useEffect(() => {
    const checkTheme = () => {
      const isL =
        document.documentElement.classList.contains("light") ||
        document.body.classList.contains("theme-light") ||
        document.querySelector(".vela-host")?.getAttribute("data-theme") === "light" ||
        (ws as any)?.theme === "light";
      setIsLight(!!isL);
    };
    checkTheme();
    const mo = new MutationObserver(checkTheme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, [ws]);

  return (
    <>
      <div
        className={`favs tv-fav-toolbar is-${orientation}${isDragging ? " is-dragging" : ""}${isLight ? " light" : " dark"}`}
        ref={barRef}
        role="toolbar"
        aria-label="Favorite drawing tools"
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* TradingView 8-dot Grip Handle */}
        <button
          type="button"
          className="favs-grip"
          title="Drag to move · Double-click to switch orientation"
          aria-label="Drag favorite tools toolbar"
          onPointerDown={onGripDown}
          onDoubleClick={toggleOrientation}
        >
          {orientation === "horizontal" ? (
            <svg viewBox="0 0 10 22" aria-hidden="true" className="favs-grip-svg">
              <circle cx="3" cy="3" r="1.25" />
              <circle cx="7" cy="3" r="1.25" />
              <circle cx="3" cy="8.5" r="1.25" />
              <circle cx="7" cy="8.5" r="1.25" />
              <circle cx="3" cy="14" r="1.25" />
              <circle cx="7" cy="14" r="1.25" />
              <circle cx="3" cy="19.5" r="1.25" />
              <circle cx="7" cy="19.5" r="1.25" />
            </svg>
          ) : (
            <svg viewBox="0 0 22 10" aria-hidden="true" className="favs-grip-svg">
              <circle cx="3" cy="3" r="1.25" />
              <circle cx="3" cy="7" r="1.25" />
              <circle cx="8.5" cy="3" r="1.25" />
              <circle cx="8.5" cy="7" r="1.25" />
              <circle cx="14" cy="3" r="1.25" />
              <circle cx="14" cy="7" r="1.25" />
              <circle cx="19.5" cy="3" r="1.25" />
              <circle cx="19.5" cy="7" r="1.25" />
            </svg>
          )}
        </button>

        {/* Favorite Tool Buttons */}
        <div className="favs-tools">
          {favs.map((t) => {
            const meta = tool(t);
            const title = getToolTitle(t, meta?.label);
            return (
              <button
                key={t}
                className={"fav-btn" + (armed === t ? " on" : "")}
                title={title}
                aria-label={title}
                aria-pressed={armed === t}
                onClick={() => arm(t)}
                dangerouslySetInnerHTML={
                  meta
                    ? { __html: velaIcon(meta.svg) }
                    : { __html: "<span>✦</span>" }
                }
              />
            );
          })}

          {/* Add / Remove Tools Flyout Trigger */}
          <button
            className={"fav-btn fav-add" + (picking ? " on" : "")}
            title="Add or remove tools from favorites"
            aria-label="Add or remove tools from favorites"
            aria-expanded={picking}
            onClick={() => setPicking((v) => !v)}
          >
            +
          </button>

          {/* Custom Drawing Format Presets */}
          <button
            className={"fav-btn fav-preset-btn" + (presetOpen ? " on" : "")}
            title="Saved drawing styles & formats"
            aria-label="Drawing format presets"
            aria-expanded={presetOpen}
            onClick={() => {
              setPresetOpen((v) => !v);
              setNaming(false);
            }}
          >
            ✥
          </button>

          <span className="favs-util-sep" />

          {/* Magnet Snap Mode */}
          <button
            className={"fav-btn fav-util-btn" + (snapMode !== "off" ? " on" : "")}
            title={`Magnet snap: ${snapMode.toUpperCase()} (snaps drawings to OHLC bars)`}
            aria-label={`Magnet mode ${snapMode}`}
            onClick={toggleSnap}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3v7a6 6 0 0 0 12 0V3M6 7h4M14 7h4M6 3h4M14 3h4" />
            </svg>
            {snapMode !== "off" && <span className="fav-util-badge">{snapMode === "strong" ? "S" : "W"}</span>}
          </button>

          {/* Stay in Drawing Mode */}
          <button
            className={"fav-btn fav-util-btn" + (stayMode ? " on" : "")}
            title={stayMode ? "Stay in drawing mode: ON" : "Stay in drawing mode: OFF"}
            aria-label="Stay in drawing mode"
            aria-pressed={stayMode}
            onClick={toggleStay}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
          </button>

          {/* Measure Tool (Ruler) */}
          <button
            className={"fav-btn fav-util-btn" + (drawingMode === "measure" ? " on" : "")}
            title="Measure Ruler (Shift+Click or Alt+M)"
            aria-label="Measure tool"
            aria-pressed={drawingMode === "measure"}
            onClick={toggleMeasure}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4z" />
              <path d="m14.5 5.5-2.5 2.5m-1-1-2 2m5 1-2.5 2.5m-1-1-2 2" />
            </svg>
          </button>

          {/* Hide / Show All Drawings */}
          <button
            className={"fav-btn fav-util-btn" + (allHidden ? " on" : "")}
            title={allHidden ? "Show all drawings (Alt+C)" : "Hide all drawings (Alt+C)"}
            aria-label="Hide or show all drawings"
            onClick={toggleHideAll}
          >
            {allHidden ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                <line x1="1" y1="1" x2="23" y2="23" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>

          {/* Lock All Drawings */}
          <button
            className={"fav-btn fav-util-btn" + (allLocked ? " on" : "")}
            title={allLocked ? "Unlock all drawings (Alt+L)" : "Lock all drawings (Alt+L)"}
            aria-label="Lock or unlock all drawings"
            onClick={toggleLockAll}
          >
            {allLocked ? (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 9.9-1" />
              </svg>
            )}
          </button>

          {/* Remove All Drawings */}
          <button
            className="fav-btn fav-util-btn fav-clear-btn"
            title="Remove all drawings on chart"
            aria-label="Remove all drawings on chart"
            onClick={removeAll}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </button>

          <span className="favs-util-sep" />

          {/* Orientation Toggle Button */}
          <button
            className="fav-btn fav-orientation-btn"
            title={orientation === "horizontal" ? "Switch to Vertical layout" : "Switch to Horizontal layout"}
            aria-label="Switch layout orientation"
            onClick={toggleOrientation}
          >
            {orientation === "horizontal" ? (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="3" x2="12" y2="21" />
                <polyline points="8 7 12 3 16 7" />
                <polyline points="8 17 12 21 16 17" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <polyline points="7 8 3 12 7 16" />
                <polyline points="17 8 21 12 17 16" />
              </svg>
            )}
          </button>

          {/* TradingView Close Toolbar Button */}
          <button
            className="fav-btn fav-close-btn"
            title="Hide Favorite Drawing Tools Toolbar"
            aria-label="Hide Favorite Drawing Tools Toolbar"
            onClick={closeToolbar}
          >
            ✕
          </button>
        </div>

        {/* Saved Format Presets Dropdown */}
        {presetOpen && (
          <div className="preset-picker" role="dialog" aria-label="Drawing format presets">
            <div className="preset-head">
              <span>Saved formats</span>
              <button
                className="preset-custom-btn"
                onClick={() => setNaming((v) => !v)}
                title="Save selected drawing format under a name"
              >
                {naming ? "Cancel" : "Custom"}
              </button>
            </div>

            {naming && (
              <div className="preset-name-row">
                <input
                  className="preset-name-input"
                  placeholder="Name it, e.g. FVG"
                  value={presetName}
                  autoFocus
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doSavePreset();
                    if (e.key === "Escape") setNaming(false);
                  }}
                />
                <button className="preset-save-btn" onClick={doSavePreset}>
                  Save
                </button>
              </div>
            )}

            {presets.length ? (
              <div className="preset-list">
                {presets.map((p) => (
                  <div className="preset-row" key={p.id}>
                    <button
                      className="preset-item"
                      title={`Apply format to selected ${p.tool} drawing`}
                      onClick={() => doApplyPreset(p)}
                    >
                      <span className="preset-swatch" aria-hidden="true">
                        {String(p.style.fillColor || p.style.lineColor || "#4cc2ff")
                          .replace("#", "")
                          .slice(0, 6)
                          .padEnd(6, "0")}
                      </span>
                      <span className="preset-item-name">{p.name}</span>
                      <span className="preset-item-tool">{p.tool}</span>
                    </button>
                    <button
                      className="preset-del"
                      title={`Delete "${p.name}"`}
                      onClick={() => doDeletePreset(p.id)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="preset-empty">
                No saved formats yet. Configure a drawing on chart, then press <b>Custom</b> to save its format.
              </div>
            )}

            {presetMsg && <div className="preset-msg">{presetMsg}</div>}
          </div>
        )}

        {/* Tool Picker Flyout */}
        {picking && (
          <div className="fav-picker" role="dialog" aria-label="Choose tools">
            {GROUP_ORDER.filter((g) => VELA_TOOLS.some((t) => t.group === g)).map((g) => (
              <div className="fav-group" key={g}>
                <div className="fav-group-label">{groupLabel(g)}</div>
                <div className="fav-group-tools">
                  {VELA_TOOLS.filter((t) => t.group === g).map((t) => (
                    <button
                      key={t.type}
                      className={"fav-pick" + (favs.includes(t.type) ? " on" : "")}
                      title={getToolTitle(t.type, t.label)}
                      aria-pressed={favs.includes(t.type)}
                      onClick={() =>
                        ws?.chart.drawings.setFavorite(
                          t.type as never,
                          !favs.includes(t.type)
                        )
                      }
                    >
                      <span
                        className="fav-pick-icon"
                        dangerouslySetInnerHTML={{ __html: velaIcon(t.svg) }}
                      />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* TradingView Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="favs-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <div
            className="favs-menu-item"
            role="menuitem"
            onClick={toggleOrientation}
          >
            <span>{orientation === "horizontal" ? "⬍ Switch to Vertical Layout" : "⬌ Switch to Horizontal Layout"}</span>
          </div>
          <div
            className="favs-menu-item"
            role="menuitem"
            onClick={() => {
              setPicking(true);
              setContextMenu(null);
            }}
          >
            <span>+ Add or Remove Tools...</span>
          </div>
          <div className="favs-menu-sep" />
          <div
            className="favs-menu-item"
            role="menuitem"
            onClick={() => {
              toggleLockAll();
              setContextMenu(null);
            }}
          >
            <span>{allLocked ? "🔓 Unlock All Drawings" : "🔒 Lock All Drawings (Alt+L)"}</span>
          </div>
          <div
            className="favs-menu-item"
            role="menuitem"
            onClick={() => {
              toggleHideAll();
              setContextMenu(null);
            }}
          >
            <span>{allHidden ? "👁 Show All Drawings" : "👁 Hide All Drawings (Alt+C)"}</span>
          </div>
          <div className="favs-menu-sep" />
          <div
            className="favs-menu-item"
            role="menuitem"
            onClick={resetPosition}
          >
            <span>↺ Reset Toolbar Position</span>
          </div>
          <div
            className="favs-menu-item danger"
            role="menuitem"
            onClick={closeToolbar}
          >
            <span>✕ Hide Favorite Toolbar</span>
          </div>
        </div>
      )}
    </>
  );
}

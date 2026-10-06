/**
 * FavoritesBar — the user's starred drawing tools, in the TOP BAR (out of the
 * chart so it never covers candles), draggable by its title like Vela's own
 * drawing settings popup, using Vela's OWN icons (identical to the toolbar's).
 *
 * What changed and why (user reports):
 *   - "favourite panel is not moving / shows inches-down jump": the bar was
 *     absolutely positioned INSIDE .chart-host and its drag handler wrote
 *     `left/top` from getBoundingClientRect() while a parent had transforms.
 *     It now lives in .topbar, and drag is pure clientX/Y deltas with NO
 *     rect reads — so the panel never teleports on grab.
 *   - "same symbol as the drawing tool": glyphs are Vela's own svg24 tool
 *     icons, extracted from its toolbar registry (see
 *     scripts/extract-vela-icons.cjs) — no more hand-picked unicode.
 *   - "not showing the correct tools": tool ids are Vela's DrawingTypeKey
 *     union; the bar seeds sensible defaults so it's never empty, and a "+"
 *     flyout lists all 70 tools grouped exactly as Vela's toolbar groups them.
 *   - "make it movable so I can select and test different indicators":
 *     dragging the title detaches it into a floating palette; the position
 *     persists to localStorage.
 */
import { useEffect, useRef, useState } from "react";
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

/** Default starred tools so the bar is useful on first run. */
const DEFAULT_FAVS = [
  "trendline", "hline", "ray", "extendedline",
  "box", "circle", "arrow", "parallelchannel",
  "fibretracement", "fibextension", "pitchfork",
  "text", "note", "callout", "freehand", "anchoredvwap",
];

const POS_KEY = "trade-pro:favs-pos";

/**
 * Wrap Vela's svg24 inner markup in a real <svg> element. Vela's own helper is
 * `svg24(body)` → `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none"
 * stroke="currentColor" stroke-width="1.8" stroke-linecap="round"
 * stroke-linejoin="round">body</svg>`; this mirrors it exactly so the glyphs
 * match the toolbar's. CSS sizes the result with width/height.
 */
function velaIcon(inner: string): string {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    inner +
    "</svg>"
  );
}

/** Group order, mirroring Vela's own toolbar sections. */
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
  const [floating, setFloating] = useState(false);
  const [presets, setPresets] = useState<DrawingPreset[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [presetMsg, setPresetMsg] = useState("");
  const barRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; dx: number; dy: number } | null>(null);
  const moved = useRef(false);

  // --- Named drawing presets ("custom" button) ---
  // The user's flow: finish configuring a drawing (colour, text "fvg", levels
  // toggled off…), then hit the ✥ button next to the text tool → "Custom" →
  // type a name → it joins this dropdown. Picking an entry re-applies that
  // exact format to the selected/newest matching drawing.
  const refreshPresets = () => setPresets(listPresets());
  useEffect(() => {
    refreshPresets();
  }, []);

  // The dropdown state must follow the store: opening it re-reads, so a preset
  // saved in another tab or in a previous render shows up immediately instead
  // of presenting a stale empty list (the state was only seeded once at mount,
  // which is why a freshly saved preset did not appear).
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
      setPresetMsg("Nothing on the chart to save — draw and configure it first.");
    }
    refreshPresets();
    window.setTimeout(() => setPresetMsg(""), 2600);
  };

  const doApplyPreset = (p: DrawingPreset) => {
    if (!ws) return;
    const name = applyPreset(ws, p.id);
    if (name) setPresetMsg(`Applied "${name}"`);
    else setPresetMsg("Draw a matching shape first, then pick the preset.");
    window.setTimeout(() => setPresetMsg(""), 2600);
  };

  const doDeletePreset = (id: string) => {
    deletePreset(id);
    refreshPresets();
  };

  // --- Dragging by the title (like Vela's settings popup) ---
  const onTitleDown = (e: React.PointerEvent) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Delta from pointer to the element's top-left, in viewport coords.
    drag.current = { sx: e.clientX, sy: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top };
    moved.current = false;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      const el = barRef.current;
      if (!d || !el) return;
      if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 3) {
        moved.current = true;
        setFloating(true);
      }
      if (!moved.current) return;
      const host = el.closest(".chart-host") as HTMLElement | null;
      const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: 0 };
      const x = e.clientX - hr.left - d.dx;
      const y = e.clientY - hr.top - d.dy;
      el.style.position = "absolute";
      el.style.left = Math.max(4, x) + "px";
      el.style.top = Math.max(4, y) + "px";
      el.style.right = "auto";
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      const el = barRef.current;
      if (el && moved.current) {
        const r = el.getBoundingClientRect();
        try {
          localStorage.setItem(POS_KEY, JSON.stringify({ x: r.left, y: r.top }));
        } catch {
          /* ignore */
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  // Restore a saved floating position.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
      if (p && barRef.current) {
        setFloating(true);
        const host = barRef.current.closest(".chart-host") as HTMLElement | null;
        const hr = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
        barRef.current.style.position = "absolute";
        barRef.current.style.left = Math.max(4, p.x - hr.left) + "px";
        barRef.current.style.top = Math.max(4, p.y - hr.top) + "px";
      }
    } catch {
      /* ignore */
    }
  }, []);

  // --- Vela state: starred tools + the armed tool ---
  useEffect(() => {
    if (!ws) return;
    // ws.chart throws "no active cell" on a destroyed instance (React 19
    // Strict Mode mounts+destroys one before the real one). Bail out whole.
    let c: any = null;
    try {
      c = (ws as any).active ? ws.chart : null;
    } catch {
      return;
    }
    if (!c) return;

    const SEED = "trade-pro:favs-seeded";
    const read = () => {
      // Guard: the workspace can be torn down between renders; a read on a
      // destroyed cell throws and would break the whole render.
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
      } catch {
        /* ignore */
      }
    };
    void read();

    const offFav = c.on("drawing:favorites", read);
    const offTool = c.on("drawing:tool", () => {
      try {
        setArmed(c.drawings.getTool());
      } catch {
        /* ignore */
      }
    });
    return () => {
      offFav?.();
      offTool?.();
    };
  }, [ws]);

  const arm = (type: string) => {
    if (!ws) return;
    try {
      const cur = ws.chart.drawings.getTool();
      ws.chart.drawings.setTool((cur === type ? null : type) as never);
    } catch (e) {
      console.warn("[favs] setTool failed:", e);
    }
  };

  const tool = (t: string) => VELA_TOOL_MAP[t];

  return (
    <div
      className={"favs" + (floating ? " floating" : "")}
      ref={barRef}
      role="toolbar"
      aria-label="Favorite drawing tools"
    >
      <span
        className="favs-title"
        title="Drag to move"
        onPointerDown={onTitleDown}
      >
        Tools
      </span>
      <span className="favs-tools">
        {favs.map((t) => {
          const meta = tool(t);
          return (
            <button
              key={t}
              className={"fav-btn" + (armed === t ? " on" : "")}
              title={meta?.label ?? t}
              aria-pressed={armed === t}
              onClick={() => arm(t)}
              dangerouslySetInnerHTML={
                meta
                  ? { __html: velaIcon(meta.svg) }
                  : { __html: '<span>✦</span>' }
              }
            />
          );
        })}
        <button
          className="fav-btn fav-add"
          title="Add or remove tools"
          aria-label="Add or remove tools"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
        >
          +
        </button>

        {/* Named drawing-format presets. Sits right after the text tool as the
            user asked: configure a drawing (yellow box, "fvg" text, levels
            off…), hit ✥ → Custom → name it → it lands in this dropdown.
            Picking an entry applies that exact format to the drawing you just
            made. */}
        <button
          className={"fav-btn fav-preset-btn" + (presetOpen ? " on" : "")}
          title="Saved drawing formats — save a configured drawing as a named preset, or apply one"
          aria-label="Drawing format presets"
          aria-expanded={presetOpen}
          onClick={() => {
            setPresetOpen((v) => !v);
            setNaming(false);
          }}
        >
          ✥
        </button>
      </span>

      {presetOpen && (
        <div className="preset-picker" role="dialog" aria-label="Drawing format presets">
          <div className="preset-head">
            <span>Saved formats</span>
            <button
              className="preset-custom-btn"
              onClick={() => setNaming((v) => !v)}
              title="Save the selected drawing's format under a name"
            >
              {naming ? "Cancel" : "Custom"}
            </button>
          </div>

          {naming && (
            <div className="preset-name-row">
              <input
                className="preset-name-input"
                placeholder="Name it, e.g. fvg"
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
                    title={`Apply this format to the selected ${p.tool} drawing`}
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
              No saved formats yet. Configure a drawing, then press{" "}
              <b>Custom</b> to save its format here.
            </div>
          )}

          {presetMsg && <div className="preset-msg">{presetMsg}</div>}
        </div>
      )}

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
                    title={t.label}
                    aria-pressed={favs.includes(t.type)}
                    onClick={() =>
                      ws?.chart.drawings.setFavorite(
                        t.type as never,
                        !favs.includes(t.type),
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
  );
}

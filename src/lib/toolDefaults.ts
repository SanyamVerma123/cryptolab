/**
 * toolDefaults — remember the last settings the user chose for each drawing
 * tool, and re-apply them when that tool is armed again (and after reload).
 *
 * The user's request: "the setting of any drawing tool should stay the same
 * until I change it again, after refresh or anything else."
 *
 * Vela persists DRAWINGS (geometry) via `persist: true`, but the *tool style
 * defaults* — the colour/width a new drawing starts with — are not remembered
 * between sessions. So we listen for edits, capture each drawing's style keyed
 * by tool type, and apply the remembered style whenever a tool is armed.
 *
 * Storage: localStorage, one style record per tool type.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:tool-defaults";

type StyleMap = Record<string, Record<string, unknown>>;

function load(): StyleMap {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as StyleMap) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function save(map: StyleMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * Capture styles from every drawing on the chart (called on edits). We key by
 * tool TYPE, not drawing id, because the default is what a NEW drawing of that
 * type should start with.
 */
function captureStyles(ws: VelaWorkspace): void {
  try {
    const docs = ws.chart.drawings.all();
    if (!docs.length) return;
    const map = load();
    let changed = false;
    for (const d of docs) {
      const style = d.style as unknown as Record<string, unknown> | undefined;
      if (!style) continue;
      // Only carry visual keys — colour, width, style, fill, text settings.
      const picked: Record<string, unknown> = {};
      for (const k of VISUAL_KEYS) {
        if (style[k] !== undefined) picked[k] = style[k];
      }
      if (Object.keys(picked).length) {
        map[d.type] = picked;
        changed = true;
      }
    }
    if (changed) save(map);
  } catch {
    /* chart not ready */
  }
}

/** Style keys worth remembering (Vela's DrawingStyle fields). */
const VISUAL_KEYS = [
  "lineColor", "lineWidth", "lineStyle",
  "fillColor", "fillOpacity", "fill",
  "textColor", "textSize", "text",
  "backgroundColor", "backgroundOpacity",
  "showLabel", "label",
  "extendLeft", "extendRight",
  "pointerEvents",
  /**
   * Per-type extras. Vela documents `levels` as "a fib tool's levels" but the
   * same field carries a Fair Value Gap's sub-level toggles — which levels are
   * drawn and which the user switched off. Without it here, "I removed some
   * levels in the FVG" never made it into the remembered style, so the next
   * FVG came back with every level on. `extras` is the generic escape hatch
   * for anything a future tool adds.
   */
  "levels", "extras", "showLevels", "showMid", "extend",
] as const;

/**
 * Apply the remembered style for the armed tool, if any. Called when a tool is
 * armed (`drawing:tool`); sets the pending default so the NEXT placement uses
 * it. Vela has no "set tool default" API, so we stash the style and apply it to
 * each drawing the moment it's created.
 */
export function applyToolDefault(ws: VelaWorkspace, type: string): void {
  const map = load();
  const style = map[type];
  if (!style) return;
  pendingDefault = { type, style };
}

interface Pending {
  type: string;
  style: Record<string, unknown>;
}

let pendingDefault: Pending | null = null;

/**
 * The user just armed tool `type`. Record the CURRENT on-chart style for it so
 * the next drawing of that type starts the same way — this is what makes "my
 * FVG colour/level change apply to the second FVG too" work, because arming the
 * tool happens between the two placements and we re-read the chart each time.
 *
 * Vela keys drawings by TYPE, so a style set on FVG #1 is the default for FVG #2.
 */
function refreshPending(ws: VelaWorkspace, type: string): void {
  const map = load();
  const style = map[type];
  if (!style) return;
  // The map is already fresh (captureStyles runs on every edit), so trusting it
  // here means the last edit before arming wins — exactly the user's request.
  pendingDefault = { type, style };
}

/** Apply a stashed default to a freshly-created drawing of the right type. */
function applyToCreated(ws: VelaWorkspace, id: string): void {
  if (!pendingDefault) return;
  try {
    const doc = ws.chart.drawings.all().find((d) => d.id === id);
    if (!doc || doc.type !== pendingDefault.type) return;
    ws.chart.drawings.update(id, { style: pendingDefault.style as never });
  } catch {
    /* ignore */
  }
}

/**
 * Install the tool-default persistence on a workspace. Returns a disposer.
 *
 * Events used:
 *   - drawing:edited  → remember what the user chose per tool
 *   - drawing:created → apply the remembered default to a new drawing
 *   - drawing:tool    → arm-time: load the default for that tool
 */
export function installToolDefaults(ws: VelaWorkspace): () => void {
  const c = ws.chart;
  const offs: (() => void)[] = [];

  const onEdited = () => void captureStyles(ws);
  const onCreated = (e: { id: string }) => {
    applyToCreated(ws, e.id);
    // Re-capture right after creation: a NEW drawing of this type inherits the
    // pending default (above), so the map stays an accurate record of what the
    // tool currently produces — the next placement reads the same value.
    void captureStyles(ws);
  };
  const onTool = (e: { type: string | null }) => {
    if (e.type) {
      void applyToolDefault(ws, e.type);
      refreshPending(ws, e.type);
    } else {
      pendingDefault = null;
    }
  };

  try {
    offs.push(c.on("drawing:edited", onEdited) as () => void);
    offs.push(c.on("drawing:created", onCreated) as () => void);
    offs.push(c.on("drawing:tool", onTool) as () => void);
  } catch {
    /* chart not ready */
  }

  // Seed from anything already on the chart.
  void captureStyles(ws);

  return () => {
    for (const off of offs) {
      try {
        off();
      } catch {
        /* already off */
      }
    }
  };
}

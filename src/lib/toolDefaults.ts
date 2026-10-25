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
import { getSafeActiveChart } from "./workspaceSafe";

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
 * Use the edited drawing as the source of truth. Sweeping every drawing after
 * an edit let an older drawing of the same type overwrite the one just edited.
 */
function captureDrawingStyle(chart: VelaWorkspace["chart"], id: string): void {
  try {
    const drawing = chart.drawings.all().find((doc) => doc.id === id);
    if (!drawing?.style) return;
    const map = load();
    // Keep the complete drawing style. Tools add options over time, and a
    // narrow allowlist silently dropped settings such as per-level toggles.
    const style = { ...(drawing.style as unknown as Record<string, unknown>) };
    if (!Object.keys(style).length) return;
    map[drawing.type] = style;
    save(map);
    if (pendingDefault?.type === drawing.type) pendingDefault = { type: drawing.type, style };
  } catch {
    /* chart not ready */
  }
}

/** Seed defaults from saved drawings only when no explicit tool preference exists. */
function seedStyles(chart?: any): void {
  if (!chart?.drawings?.all) return;
  try {
    const map = load();
    let changed = false;
    for (const drawing of [...chart.drawings.all()].reverse()) {
      if (map[drawing.type] || !drawing.style) continue;
      map[drawing.type] = { ...(drawing.style as unknown as Record<string, unknown>) };
      changed = true;
    }
    if (changed) save(map);
  } catch {
    /* chart not ready */
  }
}

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
function applyToCreated(ws: VelaWorkspace, id: string, chart?: any): void {
  if (!pendingDefault) return;
  const c = chart || getSafeActiveChart(ws);
  if (!c?.drawings?.all) return;
  try {
    const doc = c.drawings.all().find((d: any) => d.id === id);
    if (!doc || doc.type !== pendingDefault.type) return;
    c.drawings.update(id, { style: pendingDefault.style as never });
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
  if (!ws || (ws as any).destroyed) return () => {};
  const c = getSafeActiveChart(ws);
  if (!c) return () => {};
  const offs: (() => void)[] = [];

  const onEdited = (e: { id?: string }) => {
    if (e.id) captureDrawingStyle(c, e.id);
  };
  const onCreated = (e: { id: string }) => {
    applyToCreated(ws, e.id, c);
    // Keep the new tool instance as the current default even if the Vela
    // toolbar's in-memory `lastStyle` map still held its original values.
    captureDrawingStyle(c, e.id);
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
  seedStyles(c);

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

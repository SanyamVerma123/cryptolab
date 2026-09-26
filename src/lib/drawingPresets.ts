/**
 * drawingPresets — save a finished drawing's full format (colour, fill, text,
 * toggled levels, width…) under a name, then re-apply that exact format to the
 * next drawing of the same tool.
 *
 * The user's request: "if I like create any block then I will go through that
 * button it will show me the drop down and in the drop down small box appear
 * where I can select the pre define block options like I have made a block with
 * yellow colour and written fvg inside it so when I create a new block when I
 * select the drop down and select the fvg so it will apply that same format
 * into that block. And the options will available after when I at first make a
 * block and do everything changes through its settings then at the last there
 * is a button named custom I will click on it and I will give it a name and
 * save it so that it will goes to the list."
 *
 * So there are two halves:
 *   - SAVE: on demand, snapshot the SELECTED drawing (or the last-edited one)
 *     as a preset. The user names it in a small prompt; it joins the list.
 *   - APPLY: arm a preset, then the next drawing created with that tool starts
 *     with the preset's style instead of the tool's default.
 *
 * This is deliberately separate from `toolDefaults.ts`, which remembers the
 * LAST style per tool automatically. Presets are NAMED, multiple per tool, and
 * only applied when the user picks one — they are not automatic.
 *
 * FVG specifics: a Fair Value Gap drawing's "levels" (which sub-levels are on)
 * live in the style object too, so a preset that turns levels off carries those
 * toggles. That is the "I removed some levels in the FVG and it is not saving"
 * case — the style object holds them and this snapshots the whole object.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:presets";

/**
 * The currently-selected drawing id. Vela's `DrawingsControl` has `select()`
 * but no public `selected()` reader (the ids live in a private field), so we
 * track selection ourselves by listening to `drawing:selected`. This is the
 * drawing a settings popup is editing — the one "Custom" should snapshot.
 */
let selectedId: string | null = null;

/** Let VelaChart wire the selection tracker. Idempotent. */
let installedTracker = false;
export function trackSelection(ws: VelaWorkspace): void {
  if (installedTracker) return;
  installedTracker = true;
  try {
    ws.chart.on("drawing:selected", (e: { id?: string | null }) => {
      selectedId = e?.id ?? null;
    });
  } catch {
    /* chart not ready */
  }
}

export interface DrawingPreset {
  /** Unique id. */
  id: string;
  /** The name the user typed, e.g. "fvg". */
  name: string;
  /** Vela drawing type this preset belongs to ("box", "fvg", …). */
  tool: string;
  /** The complete style object, applied verbatim via drawings.update(). */
  style: Record<string, unknown>;
  /** When it was saved, for ordering newest-last like the user's list. */
  savedAt: number;
}

type Store = DrawingPreset[];

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Store) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(list: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

export function listPresets(): Store {
  return load();
}

/**
 * Save the SELECTED drawing (or the most recent one on the chart) as a preset
 * under `name`. Returns the preset, or null if the chart has no drawing of that
 * kind to snapshot.
 *
 * Prefers the selection: the user finishes editing in the settings popup, the
 * drawing is still selected, and "custom" then captures exactly that one. If
 * nothing is selected we fall back to the last drawing of the same tool.
 */
export function savePreset(
  ws: VelaWorkspace,
  name: string,
  tool?: string,
): DrawingPreset | null {
  const clean = name.trim();
  if (!clean) return null;
  try {
    const c = ws.chart;
    const all = c.drawings.all();
    if (!all.length) return null;

    // Selection first — that is the drawing the user just finished configuring.
    let doc = all.find((d) => d.id === selectedId);
    if (!doc || (tool && doc.type !== tool)) {
      // Fall back to the newest drawing of the requested (or any) tool.
      const same = tool ? all.filter((d) => d.type === tool) : all;
      doc = same[same.length - 1];
    }
    if (!doc) return null;

    const style = (doc.style as unknown as Record<string, unknown>) ?? {};
    const preset: DrawingPreset = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: clean,
      tool: doc.type,
      style,
      savedAt: Date.now(),
    };
    const list = load();
    // Replace an existing preset with the same name+tool (re-saving "fvg"
    // updates it instead of duplicating).
    const filtered = list.filter((p) => !(p.name === clean && p.tool === doc!.type));
    filtered.push(preset);
    save(filtered);
    return preset;
  } catch {
    /* chart not ready */
    return null;
  }
}

/**
 * Delete a preset by id.
 */
export function deletePreset(id: string): void {
  save(load().filter((p) => p.id !== id));
}

/**
 * Apply a preset's style to an existing drawing (by id).
 */
export function applyPresetTo(ws: VelaWorkspace, presetId: string, drawingId: string): boolean {
  try {
    const p = load().find((x) => x.id === presetId);
    if (!p) return false;
    ws.chart.drawings.update(drawingId, { style: p.style as never });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply a preset to the SELECTED drawing, or to the newest drawing of the
 * matching tool if nothing is selected. This is the "I created a block, now I
 * pick 'fvg' from the dropdown" path.
 *
 * Returns a short description of what happened, for the UI to confirm.
 */
export function applyPreset(ws: VelaWorkspace, presetId: string): string | null {
  try {
    const c = ws.chart;
    const p = load().find((x) => x.id === presetId);
    if (!p) return null;
    const all = c.drawings.all();
    if (!all.length) return null;

    // Selected drawing wins if it matches the preset's tool.
    const sel = all.find((d) => d.id === selectedId);
    let doc = sel && sel.type === p.tool ? sel : null;
    if (!doc) {
      // Otherwise the newest drawing of the right tool.
      const same = all.filter((d) => d.type === p.tool);
      doc = same[same.length - 1] ?? null;
    }
    if (!doc) return null;
    c.drawings.update(doc.id, { style: p.style as never });
    return p.name;
  } catch {
    return null;
  }
}

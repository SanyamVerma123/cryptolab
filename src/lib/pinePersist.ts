/**
 * pinePersist — keep CUSTOM Pine indicators on the chart across sessions.
 *
 * THE GAP this closes: the Pine editor saves a compiled script into a LIBRARY
 * (`trade-pro:pine-library`), which is a palette of saved scripts — but nothing
 * ever re-mounts the ones that were actually ON the chart. A custom indicator
 * vanishes on every reload, and its visibility/inputs are not remembered
 * either. That library answers "what can I re-add?", not "what did I have?".
 *
 * This module owns the second question, mirroring luxPersist:
 *   mount  → record the script (per coin, in application order, keyed by name)
 *   reload → re-mount each recorded script, then `applyIndicatorState` replays
 *            the user's hidden/eye state and input edits
 *   remove → forget it, so a reload does not bring it back
 *
 * The stable key is the script NAME (parsed from the `indicator("…")` /`
 * `strategy("…")` declaration, falling back to the compiled title). Vela's ids
 * are session-scoped, and every library-less Pine script can compile to the
 * generic title "Indicator", so the name is what survives a reload.
 *
 * Failure-safe: a script that no longer compiles after an engine update never
 * blocks the chart or the other restores — it is reported, not thrown.
 */
import { applyIndicatorState, beginRestore, endRestore } from "./indicatorState";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:pine-applied";

/**
 * Session-scoped map from a Vela indicator id to the custom script's name.
 * `indicator:removed` fires with only the id, so this is how a deleted custom
 * script is traced back to its name and forgotten. Never persisted.
 */
const idToName = new Map<string, string>();

interface AppliedScript {
  /** Stable match key: the declared script name, or the compiled title. */
  name: string;
  /** The raw Pine source, needed to re-mount it. */
  script: string;
}

type Store = Record<string, AppliedScript[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Store) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function save(store: Store): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage full or blocked — non-fatal */
  }
}

/** Strip the `provider:` prefix Vela adds (e.g. "hyperliquid:BTC" → "BTC"). */
function bareSymbol(sym: string | undefined): string | undefined {
  if (!sym) return undefined;
  const i = sym.indexOf(":");
  return i === -1 ? sym : sym.slice(i + 1);
}

/** Parse the declared name out of a `indicator("X")` / `strategy('X')` line. */
export function pineScriptName(src: string): string | null {
  const m = src.match(/(?:indicator|strategy)\s*\(\s*(?:"([^"]*)"|'([^']*)')/);
  return m ? (m[1] ?? m[2] ?? null) : null;
}

/**
 * Record a just-applied custom script for `symbol`, so it re-mounts after a
 * reload. Re-saving the same name replaces its source (edit → re-run keeps the
 * newest version), and duplicates never accumulate.
 */
export function rememberPineIndicator(
  symbol: string | undefined,
  script: string,
  compiledTitle?: string,
  indicatorId?: string
): string {
  const coin = bareSymbol(symbol);
  if (!coin || !script) return "";
  const name = pineScriptName(script) ?? compiledTitle ?? "Custom indicator";
  const store = load();
  const list = (store[coin] || []).filter((s) => s.name !== name);
  store[coin] = [...list, { name, script }];
  save(store);
  if (indicatorId) idToName.set(indicatorId, name);
  return name;
}

/** All custom scripts recorded for `symbol` (its applied list). */
export function appliedPineForCoin(symbol: string | undefined): AppliedScript[] {
  const coin = bareSymbol(symbol);
  if (!coin) return [];
  return load()[coin] || [];
}

/**
 * The script name for the indicator identified by Vela's per-session `id`, if
 * it is a custom Pine script we recorded. Used by `indicatorState` on
 * `indicator:removed` so a deleted custom script does not come back on reload.
 */
export const PINE_LIB_KEY = "trade-pro:pine-library";

export interface SavedPineScript {
  name: string;
  script: string;
}

export function loadPineLibrary(): SavedPineScript[] {
  try {
    const raw = localStorage.getItem(PINE_LIB_KEY);
    const arr = raw ? (JSON.parse(raw) as SavedPineScript[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function savePineLibrary(lib: SavedPineScript[]): void {
  try {
    localStorage.setItem(PINE_LIB_KEY, JSON.stringify(lib));
  } catch {
    /* ignore */
  }
}

export function removePineFromLibrary(name: string): void {
  try {
    const lib = loadPineLibrary().filter((s) => s.name !== name);
    savePineLibrary(lib);
  } catch {
    /* ignore */
  }
}

export function pineNameForIndicatorId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return idToName.get(id);
}

/** Forget the script named `name` for `symbol` — it will not come back. */
export function forgetPineIndicator(
  symbol: string | undefined,
  name: string
): void {
  const coin = bareSymbol(symbol);
  if (!coin || !name) return;
  const store = load();
  const list = store[coin] || [];
  if (list.length) {
    store[coin] = list.filter((s) => s.name !== name);
    save(store);
  }
  removePineFromLibrary(name);
  console.info("[trade-pro:pine] forgetPineIndicator", coin, name,
    "-> remaining:", (store[coin] || []).map((s) => s.name));
}

export interface PineRestoreResult {
  restored: string[];
  failed: { name: string; reason: string }[];
}


/**
 * Re-mount every custom script the user had on this coin.
 *
 * Safe on every load and symbol switch: a no-op when nothing is recorded, and
 * each script is restored independently — a compile failure in one stops none
 * of the others and never blocks the chart.
 */
export async function restorePineIndicators(
  ws: VelaWorkspace,
  symbol: string | undefined
): Promise<PineRestoreResult> {
  const coin = bareSymbol(symbol);
  if (!coin) return { restored: [], failed: [] };
  const scripts = load()[coin] || [];
  if (!scripts.length) return { restored: [], failed: [] };

  const restored: string[] = [];
  const failed: { name: string; reason: string }[] = [];

  // Suppress `indicator:added` snapshots during the re-mount (indicatorState):
  // they would write `visible: true` before the saved state is replayed.
  beginRestore();
  try {
    for (const { name, script } of scripts) {
      try {
        // Idempotency: skip a script that is ALREADY mounted on this chart.
        // React 19 Strict Mode mounts the chart effect twice; the first chart
        // is destroyed and the second is fresh, so a name-based "already
        // restored" flag would wrongly skip the live one and leave its new ids
        // unregistered (breaking the eye-toggle replay). Matching on the chart
        // itself re-mounts exactly once per real chart. Vela exposes the source
        // on the handle, so an identical script can never be added twice.
        const already = (ws.chart.indicators() || []).some(
          (h) => h.source === script
        );
        if (already) continue;

        const handle = ws.chart.addIndicator(script);
        // IndicatorHandle is synchronous; id/title exist immediately. Register the
        // per-session id -> name so a delete in THIS session can be traced back to
        // the script, and `keyOf` gives this indicator its own record (a Pine script
        // with no declared title compiles to the generic "Indicator" and would
        // otherwise collide with other scripts).
        if (handle?.id) rememberPineIndicator(symbol, script, handle.title, handle.id);
        restored.push(name);
      } catch (e) {
        failed.push({ name, reason: (e as Error).message || "compile failed" });
      }
    }
  } finally {
    // Replay the saved visibility/inputs onto the freshly mounted handles. This
    // is what keeps the "eye" toggle and input edits across a reload.
    endRestore(ws, symbol);
  }

  return { restored: [...restored], failed };
}

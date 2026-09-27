/**
 * luxPersist — keep applied LuxAlgo library indicators across sessions.
 *
 * THE GAP this closes: Vela's own `persist: true` restores layout, timezone and
 * favorites, but NOT the indicator list — and `indicatorState.ts` only replays
 * visibility/inputs for indicators that are ALREADY mounted. Neither layer
 * remembers that a host-added LuxAlgo Pine script was ever on the chart, so a
 * library indicator disappears on every reload. This module owns that:
 *
 *   mount  → record the slug (per coin, in order)
 *   reload → re-fetch each slug's source and re-mount it, then let
 *            `applyIndicatorState` replay the user's visibility/inputs
 *
 * The slug is the stable key: it identifies the script on LuxAlgo's servers and
 * survives a session, unlike Vela's per-session indicator ids or the compiled
 * title ("Indicator" for most library scripts, which is not unique).
 *
 * Failure-safe by design: a dead proxy or a pulled-down script must never block
 * the chart from loading. Each indicator is restored independently, and any
 * failure is reported to the caller rather than thrown.
 */
import { getIndicatorSource } from "./luxAlgoClient";
import { applyIndicatorState, beginRestore, endRestore } from "./indicatorState";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:lux-applied";

type Store = Record<string, string[]>;

/**
 * Session-scoped map from a Vela indicator id to the LuxAlgo slug that created
 * it. `indicator:removed` fires with only the id, so this is how a deleted
 * library script is traced back to its slug and forgotten. Never persisted.
 */
const idToSlug = new Map<string, string>();

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

/**
 * Record `slug` as applied to `symbol` (in application order), so it can be
 * re-mounted after a reload. Duplicates are skipped — the library panel is a
 * list, not a toggle, but a double-click should never add a script twice.
 *
 * Also maps the just-mounted indicator's Vela id to this slug, so a later
 * `indicator:removed` (which fires with only the per-session id) can be traced
 * back to the library script and forgotten. Vela ids are session-scoped, so
 * this map is kept in memory only.
 */
export function rememberLuxIndicator(
  symbol: string | undefined,
  slug: string,
  indicatorId?: string
): void {
  const coin = bareSymbol(symbol);
  if (!coin || !slug) return;
  const store = load();
  const list = store[coin] || [];
  if (!list.includes(slug)) {
    store[coin] = [...list, slug];
    save(store);
  }
  if (indicatorId) idToSlug.set(indicatorId, slug);
}

/**
 * The slug of the library indicator identified by Vela's per-session `id`, if
 * it is a library indicator at all. Used by `indicatorState` on
 * `indicator:removed` so a deleted library script does not come back on reload.
 */
export function slugForIndicatorId(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return idToSlug.get(id);
}

/**
 * Forget `slug` for `symbol`. Called when the user removes an indicator, so a
 * reload does not silently bring it back.
 */
export function forgetLuxIndicator(symbol: string | undefined, slug: string): void {
  const coin = bareSymbol(symbol);
  if (!coin || !slug) return;
  const store = load();
  const list = store[coin] || [];
  if (!list.length) return;
  store[coin] = list.filter((s) => s !== slug);
  save(store);
}

/**
 * A restore that has already mounted a coin's indicators must not mount them
 * again — React 19 Strict Mode runs the chart effect twice (mount → unmount →
 * remount). Idempotency is checked against the live chart (`h.source`) inside
 * the loop, so a destroyed-and-recreated chart still restores correctly.
 */
const restoredForLux = new Set<string>();

export interface RestoreResult {
  /** Slugs that were re-mounted successfully. */
  restored: string[];
  /** Slugs that failed, with a short human-readable reason. */
  failed: { slug: string; reason: string }[];
}

/**
 * Re-mount every library indicator the user had on this coin.
 *
 * Returns once every attempt has settled. Safe to call on every load and on
 * every symbol switch: it is a no-op when nothing was recorded for the coin,
 * and each restore is independent — one dead script never stops the rest or
 * blocks the chart.
 */
export async function restoreLuxIndicators(
  ws: VelaWorkspace,
  symbol: string | undefined
): Promise<RestoreResult> {
  const coin = bareSymbol(symbol);
  if (!coin) return { restored: [], failed: [] };
  const slugs = load()[coin] || [];
  if (!slugs.length) {
    restoredForLux.delete(coin);
    return { restored: [], failed: [] };
  }

  // React 19 Strict Mode mounts the chart effect twice; without an idempotency
  // guard every library indicator would be added twice on each reload.
  if (restoredForLux.has(coin)) return { restored: [], failed: [] };

  const restored: string[] = [];
  const failed: { slug: string; reason: string }[] = [];

  // Suppress `indicator:added` snapshots during the re-mount (indicatorState):
  // they would write `visible: true` before the saved state is replayed.
  beginRestore();
  try {
    for (const slug of slugs) {
      try {
        const { source, available } = await getIndicatorSource(slug);
        if (!available || !source) {
          failed.push({ slug, reason: "no public source (premium-tier indicators are excluded)" });
          continue;
        }
        // Idempotency: skip a script already mounted on THIS chart. Strict Mode
        // destroys the first chart and creates a fresh one, so a coin-level flag
        // would wrongly skip the live chart and leave its new ids unregistered.
        const already = (ws.chart.indicators() || []).some((h) => h.source === source);
        if (already) continue;

        const handle = ws.chart.addIndicator(source);
        // Re-register the new per-session id -> slug, so:
        //   - `keyOf` gives this indicator its OWN record (all library scripts
        //     compile to the same title "Indicator", so without the slug they
        //     would share one record and trample each other's settings)
        //   - a delete in THIS session can be traced back to the library script
        // Must happen BEFORE the snapshot below, which reads the id map.
        if (handle?.id) rememberLuxIndicator(symbol, slug, handle.id);
        restored.push(slug);
      } catch (e) {
        failed.push({ slug, reason: (e as Error).message || "fetch failed" });
      }
    }
  } finally {
    // Now that every id map is populated, replay the saved visibility/inputs
    // onto the freshly mounted handles — this keeps the "eye" toggle and input
    // edits across a reload.
    endRestore(ws, symbol);
  }

  restoredForLux.add(coin);
  return { restored, failed };
}

/**
 * perSymbolDrawings — keep each coin's chart drawings separate.
 *
 * The user's request: drawings made on BTC must NOT appear on ETH (or any
 * other coin), but the *tool style* choices (box colour, line width…) should
 * still carry across coins.
 *
 * Why this module exists: Vela's `persist: true` stores the whole workspace —
 * drawings included — under ONE `vela-workspace` localStorage key with NO
 * per-symbol scoping. On reload it re-applies that single drawing set onto
 * whatever market it restores. So with Vela alone:
 *   - draw on BTC, switch to LTC → BTC's boxes are still there;
 *   - draw a lot on LTC, refresh → whatever Vela restored wins, and the two
 *     coin's drawings were merged into one list anyway.
 *
 * Design (and why it looks the way it does):
 *
 *   - OUR store is the source of truth for drawings. On every create / edit /
 *     remove we snapshot the chart's drawings under the CURRENT coin. On every
 *     coin switch we save the coin we're leaving and load the coin we're
 *     joining (clearing the chart first, because Vela's restore + our own
 *     previous load both leave drawings on it).
 *
 *   - On mount we LOAD, we do not seed. The previous version seeded the chart
 *     into the store on mount, which raced with Vela's own restore and with
 *     our own debounced saves: a seed taken a beat too early wrote `[]` over a
 *     just-saved set, so every refresh silently dropped the newest drawings
 *     ("I added a lot of drawings and after refresh everything was gone").
 *     If the store has no entry for this coin we leave the chart untouched —
 *     the first visit trusts whatever Vela brought back, and our very first
 *     drawing edit will record the coin properly.
 *
 *   - We deliberately do NOT touch tool STYLES — those are `toolDefaults.ts`,
 *     keyed by tool TYPE so a red box on BTC is still a red box on ETH.
 *
 * Vela APIs used: `drawings.toJSON()` (sanitised, version-stamped document),
 * `drawings.fromJSON(doc)` (validates each entry — untrusted-safe),
 * `drawings.all()` / `drawings.removeMany([ids])` for the clear, and the
 * `drawing:created|edited|removed` + `market:changed` events.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:drawings";

type Store = Record<string, unknown[]>;

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
 * Snapshot the current chart's drawings under `symbol`, overwriting whatever
 * we had for that coin. Called after every drawing change so the store can
 * never go stale.
 */
export function saveDrawings(ws: VelaWorkspace, sym: string | undefined): void {
  const coin = bareSymbol(sym);
  if (!coin) return;
  // Skip while a load/clear is in flight — the chart is transiently empty and
  // snapshotting it here would overwrite this coin's saved set with `[]`.
  // (See loadDrawings for the feedback loop this guards against.)
  if (suppressSave) return;
  try {
    // `toJSON()` is the whole drawing document ({ version, drawings[] }) —
    // untrusted-safe and version-stamped, so `fromJSON` can restore it later.
    const doc = ws.chart.drawings.toJSON();
    const store = load();
    if (doc && doc.drawings?.length) {
      store[coin] = doc.drawings;
    } else {
      // Nothing on the chart — remember the emptiness too, so a later switch
      // to this coin clears instead of leaving the previous coin's boxes up.
      store[coin] = [];
    }
    save(store);
  } catch {
    /* chart not ready */
  }
}

/**
 * Restore `symbol`'s saved drawings onto the chart.
 *
 * IMPORTANT: this must NOT clear the chart when this coin has NO saved entry —
 * Vela's own `persist: true` may have just restored drawings from the
 * workspace document, and wiping them would break persistence entirely
 * (that was the "drawings vanish on refresh" bug). We only touch the chart
 * when we have something of our own to put there.
 */
export function loadDrawings(ws: VelaWorkspace, sym: string | undefined): void {
  const coin = bareSymbol(sym);
  if (!coin) return;
  try {
    const store = load();
    const saved = store[coin];
    // Three cases, and they must NOT be collapsed together:
    //   1. No entry for this coin (`undefined`) — we have never recorded it.
    //      Leave Vela's own `persist: true` restore alone; wiping it would
    //      break persistence on the very first load (the original "drawings
    //      vanish on refresh" bug).
    //   2. An entry holding drawings — swap them in.
    //   3. An EMPTY entry — we HAVE recorded this coin and it had no
    //      drawings. This must actively CLEAR the chart, because Vela's
    //      workspace persistence is not per-symbol: it re-applies the
    //      previous coin's boxes onto the new chart (the "LTC shows BTC's
    //      drawings" bug). `saveDrawings` records emptiness as `[]` for
    //      exactly this.
    if (saved === undefined) return;

    // CRITICAL: guard the clear. `removeMany` fires `drawing:removed`, which
    // our own persist handler listens to — without this flag it would snapshot
    // the momentarily-empty chart and write `store[coin] = []`, destroying this
    // coin's real drawings AND letting Vela persist the wipe to
    // vela-workspace. That silent feedback loop is what emptied the chart on
    // reload. `suppressSave` is checked in saveDrawings.
    suppressSave = true;
    try {
      const cur = ws.chart.drawings.all();
      if (cur.length) ws.chart.drawings.removeMany(cur.map((d) => d.id));
      if (saved.length) {
        // fromJSON is untrusted-safe (it validates + sanitises each entry).
        ws.chart.drawings.fromJSON({ version: 1, drawings: saved } as never);
      }
    } finally {
      // Re-arm on the next macrotask, so any sync `drawing:removed` burst from
      // the clear has already passed by the time saves are allowed again.
      setTimeout(() => {
        suppressSave = false;
      }, 0);
    }
  } catch {
    /* chart not ready */
  }
}

/**
 * Set while a `loadDrawings` clear/restore is in flight. `saveDrawings` must
 * not run during that window — the chart is transiently empty and snapshotting
 * it would record `[]` as the coin's saved set (see loadDrawings).
 */
let suppressSave = false;

/**
 * Install the per-symbol swap on a workspace. Returns a disposer.
 *
 * Persistence model: the store is written on EVERY drawing change (created /
 * edited / removed) and read on every coin switch. On MOUNT we only load —
 * never seed (see the module note about the seed race that lost drawings).
 */
export function installPerSymbolDrawings(ws: VelaWorkspace): () => void {
  const offs: (() => void)[] = [];

  // The coin we're currently showing. Tracked here because `market:changed`
  // arrives AFTER the switch, so the chart already reports the NEW symbol.
  let lastSymbol: string | undefined;
  try {
    lastSymbol = bareSymbol(ws.chart.market?.symbol);
    // LOAD, don't seed. If we have a saved entry for this coin, our store is
    // authoritative (and Vela may have just re-applied another coin's
    // drawings onto this chart). If we have NO entry this is the first visit
    // — trust the chart as it stands; our first drawing edit will record it.
    loadDrawings(ws, lastSymbol);
  } catch {
    /* chart not ready (Strict Mode destroyed instance) */
  }

  // Keep the store in lockstep with every edit. Debounced lightly — a drag
  // fires `edited` many times a second and a full toJSON each time is wasteful.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const persist = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      saveDrawings(ws, lastSymbol);
    }, 400);
  };

  const onMarketChanged = (e: { symbol?: string }) => {
    try {
      const next = bareSymbol(e.symbol);
      if (!next || next === lastSymbol) return;
      // Flush any pending edit for the coin we're leaving.
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
        saveDrawings(ws, lastSymbol);
      }
      lastSymbol = next;
      loadDrawings(ws, next);
    } catch {
      /* chart torn down */
    }
  };

  try {
    const c = ws.chart;
    offs.push(c.on("drawing:created", persist) as () => void);
    offs.push(c.on("drawing:edited", persist) as () => void);
    offs.push(c.on("drawing:removed", persist) as () => void);
    offs.push(c.on("market:changed", onMarketChanged) as () => void);
  } catch {
    /* chart not ready */
  }

  return () => {
    if (timer) clearTimeout(timer);
    for (const off of offs) {
      try {
        off();
      } catch {
        /* already off */
      }
    }
  };
}

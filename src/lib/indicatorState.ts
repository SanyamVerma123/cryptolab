/**
 * indicatorState — remember which indicators are hidden, which inputs the user
 * changed, and re-apply both after every reload.
 *
 * Vela's own `persist: true` does NOT round-trip indicator visibility or
 * per-input edits for host-added indicators ("the I button hides it, but it
 * comes back on refresh", "my FVG levels revert"). It restores the indicator
 * LIST (which ones are mounted) but replays them from their declaration
 * defaults. So we own this layer.
 *
 * What we persist, keyed by coin:
 *
 *   - HIDDEN  → the indicator's id + title, so we can `handle.setVisible(false)`
 *               again after the restore. Ids are per-session, so we match on
 *               TITLE (nativeType for native ones, or the script title) and
 *               hide any restored indicator whose title is on the list.
 *   - INPUTS  → the CURRENT input values from `handle.inputValues()`, applied
 *               back with `handle.setInputs()` after the restore. This is what
 *               keeps a user's FVG level edits (turning specific levels off)
 *               from resetting when the next FVG is added or the page reloads.
 *
 * Coin-scoped deliberately: an indicator setup is a per-chart thing, so hiding
 * MACD on BTC shouldn't hide it on ETH. Styles for drawing TOOLS are a
 * different layer (`toolDefaults.ts`) and stay global.
 *
 * Vela APIs used: `chart.indicators()` → handles with `title`, `nativeType`,
 * `visible`, `inputValues()`, `setInputs()`, `setVisible()`, and the
 * `indicator:visibility` / `indicator:inputs` change events.
 */
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

const KEY = "trade-pro:indicators";

/**
 * One saved indicator. Ids are session-scoped (they change every reload), so
 * the match key on restore is `key` — the nativeType for a native indicator,
 * or the script title for a Pine one.
 */
interface SavedIndicator {
  /** Match key: `nativeType` for native, script `title` for Pine. */
  key: string;
  /** Display title, for the AI's chart-state read only. */
  title: string;
  visible: boolean;
  /** Last-known input values (may be empty if the indicator declares none). */
  inputs?: Record<string, unknown>;
}

type Store = Record<string, SavedIndicator[]>;

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

/** The stable match key for a handle — nativeType for native, title for Pine. */
function keyOf(h: { nativeType?: string; title: string }): string {
  return h.nativeType || h.title;
}

/**
 * Snapshot every MOUNTED indicator's visibility + inputs under `symbol`.
 * Called after each change so the store is never stale.
 *
 * MERGE, never replace. The previous version overwrote the whole coin's list,
 * which destroyed the record of an indicator the user had just removed — so
 * "change my settings, remove it, add it back" could never restore them (the
 * record was gone the moment the removal snapshot ran). We keep the previous
 * record for any key that is no longer mounted, and refresh the ones that are.
 * Vela's ids change per session, so the match key is `nativeType` (native) or
 * the script `title` (Pine), never the id.
 */
function snapshot(ws: VelaWorkspace, sym: string | undefined): void {
  const coin = bareSymbol(sym);
  if (!coin) return;
  try {
    const handles = ws.chart.indicators();
    if (!handles) return;
    const store = load();
    const prev = new Map((store[coin] || []).map((s) => [s.key, s]));

    const list: SavedIndicator[] = [];
    for (const h of handles) {
      const rec: SavedIndicator = {
        key: keyOf(h),
        title: h.title,
        visible: h.visible,
      };
      try {
        const vals = h.inputValues();
        if (vals && Object.keys(vals).length) rec.inputs = vals;
      } catch {
        /* engine not prepared yet — keep any inputs we already had for it */
        const old = prev.get(rec.key);
        if (old?.inputs) rec.inputs = old.inputs;
      }
      list.push(rec);
    }

    // Preserve the last-known config for indicators that are no longer mounted
    // (the user just removed them). Without this the record is deleted and a
    // later re-add can only come back with declaration defaults.
    const mounted = new Set(list.map((s) => s.key));
    for (const [key, rec] of prev) {
      if (!mounted.has(key)) {
        // Drop only the VISIBILITY of a removed indicator — remembering it as
        // hidden would force a re-add to come back hidden, which is not what
        // "add it back" means. Its INPUTS survive, which is the actual fix.
        list.push({ ...rec, visible: true });
      }
    }

    store[coin] = list;
    save(store);
  } catch {
    /* chart not ready */
  }
}

/**
 * Re-apply the saved hidden-state + inputs to the currently mounted
 * indicators. Called after the chart restores them (on mount / coin switch /
 * indicator added), because Vela replays them from declaration defaults.
 *
 * Waits for `chart.ready()` before replaying inputs for the same reason
 * `carryInputsTo` does: at mount time the engine has not prepared the scripts
 * yet, so `setInputs` is silently ignored and the user's edits are lost. The
 * visibility part is synchronous and safe to do immediately — `setVisible` is
 * a host-side toggle that suspends the indicator, no script prep required.
 */
export function applyIndicatorState(ws: VelaWorkspace, sym: string | undefined): void {
  const coin = bareSymbol(sym);
  if (!coin) return;

  const run = () => {
    try {
      const store = load();
      const saved = store[coin];
      if (!saved || !saved.length) return;
      const handles = ws.chart.indicators();
      if (!handles) return;

      // Ids change per session; match on the stable key.
      const byKey = new Map(saved.map((s) => [s.key, s]));

      for (const h of handles) {
        const rec = byKey.get(keyOf(h));
        if (!rec) continue;
        // Only touch visibility when we recorded it as HIDDEN — showing is the
        // default, so re-applying `true` would be a no-op at best and would
        // fight a just-added indicator the user is mid-configuring at worst.
        if (rec.visible === false) {
          try {
            if (h.visible) h.setVisible(false);
          } catch {
            /* handle torn down */
          }
        }
        if (rec.inputs) {
          try {
            h.setInputs(rec.inputs as never);
          } catch {
            /* engine not ready for inputs yet */
          }
        }
      }
    } catch {
      /* chart not ready */
    }
  };

  // Visibility first (synchronous), then inputs once the engine is prepared.
  run();
}

/**
 * Carry THIS coin's last-saved settings for indicator `key` to a freshly added
 * indicator of the same kind.
 *
 * The user's report: "I change an indicator's settings, then when I remove it
 * and add it back, everything resets to defaults — my changes are not applied."
 * `indicator:added` fires before the settings dialog is ever opened, so on a
 * re-add Vela mounts from declaration defaults and nothing reapplies the user's
 * earlier edits. That is exactly this path: match the new handle to the saved
 * record by key (nativeType, or script title for Pine) and replay its inputs.
 *
 * Timing matters. `indicator:added` fires synchronously at MOUNT, before the
 * engine has prepared the script — `setInputs` then throws or is a no-op
 * because the input schema hasn't been built yet. That was the first attempt:
 * the carry silently did nothing and the re-add came back with defaults
 * (`fastLength: 12` instead of the saved `21`). We wait for `chart.ready()`
 * (which resolves once the indicator is prepared and computed) before
 * replaying. Idempotent and safe: `setInputs` with unchanged values is a no-op.
 */
function carryInputsTo(ws: VelaWorkspace, coin: string | undefined, key: string): void {
  if (!coin) return;
  const apply = () => {
    try {
      const store = load();
      const rec = (store[coin] || []).find((s) => s.key === key);
      if (!rec || !rec.inputs) return;
      const me = (ws.chart.indicators() || []).find((h) => keyOf(h) === key);
      if (!me) return;
      me.setInputs(rec.inputs as never);
    } catch {
      /* engine not ready for inputs yet — the ready() promise may have
         rejected for an unrelated reason; the next add will retry */
    }
  };
  try {
    Promise.resolve(ws.chart.ready()).then(apply, apply);
  } catch {
    apply();
  }
}

/**
 * Install indicator visibility + input persistence on a workspace.
 * Returns a disposer.
 */
export function installIndicatorState(ws: VelaWorkspace): () => void {
  const offs: (() => void)[] = [];
  let coin = bareSymbol(ws.chart.market?.symbol);

  // Debounce: a single "hide" or input drag fires many change events, and a
  // full indicator sweep each time is wasteful.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dirty = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      snapshot(ws, coin);
    }, 400);
  };

  const onVisibility = (e: { id?: string; visible?: boolean }) => {
    void e;
    dirty();
  };
  const onInputs = (e: { id?: string }) => {
    void e;
    dirty();
  };
  const onRemoved = (e: { id?: string }) => {
    void e;
    // A removal must NOT delete the indicator's saved config. `snapshot` keeps
    // the previous record for any key that is no longer mounted (so the inputs
    // survive), so all we do here is trigger that merge a beat early. The
    // debounced `dirty()` after a remove used to land AFTER our handler had
    // already forgotten the handle, which is exactly why settings never came
    // back on re-add. Flushing now keeps the record current.
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    snapshot(ws, coin);
  };
  const onAdded = (e: { id?: string }) => {
    void e;
    // A newly-added indicator mounts from its declaration defaults. If the user
    // has previously configured this SAME indicator kind on this coin (e.g.
    // turning specific FVG levels off, or changing MACD's fast period), carry
    // those inputs to the new one — this is the "remove it, add it back, and
    // my settings are gone" bug. Keyed by nativeType / title, NOT by id, since
    // ids change every session and every add.
    try {
      const all = ws.chart.indicators() || [];
      const me = e.id ? all.find((h) => h.id === e.id) : undefined;
      const key = me ? keyOf(me) : undefined;
      if (me && key) carryInputsTo(ws, coin, key);
    } catch {
      /* chart torn down */
    }
    // Then snapshot so the newly-added indicator enters the store.
    dirty();
  };
  const onMarketChanged = (e: { symbol?: string }) => {
    coin = bareSymbol(e.symbol);
    // Apply this coin's indicator state as soon as its indicators restore.
    setTimeout(() => applyIndicatorState(ws, coin), 50);
  };

  try {
    const c = ws.chart;
    offs.push(c.on("indicator:visibility", onVisibility) as () => void);
    offs.push(c.on("indicator:inputs", onInputs) as () => void);
    offs.push(c.on("indicator:removed", onRemoved) as () => void);
    offs.push(c.on("indicator:added", onAdded) as () => void);
    offs.push(c.on("market:changed", onMarketChanged) as () => void);
  } catch {
    /* chart not ready */
  }

  // The chart has already restored its indicators at install time — apply the
  // saved state right away (deferred: Vela's restore is itself async and the
  // indicator list lands a tick after mount).
  setTimeout(() => applyIndicatorState(ws, coin), 200);

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

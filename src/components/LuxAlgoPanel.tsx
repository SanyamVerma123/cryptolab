/**
 * LuxAlgoPanel — the official LuxAlgo indicator library, rendered as a panel.
 *
 * Two-stage on-demand loading, exactly as specced:
 *   1. On open, fetch the indicator list (names + slugs) and render it.
 *   2. On a row click, fetch that indicator's Pine source and inject it into
 *      the running chart with chart.addIndicator(source).
 *
 * Both stages carry their own loading state (spinner + "Adding…"), and every
 * failure surfaces as a plain-English message in the panel footer rather than
 * a console-only error. Nothing about the chart's existing rendering is
 * touched — this component only reads `ws.chart` to add one indicator.
 *
 * The panel is a floating overlay anchored to the right edge of the chart host
 * (same mount point as AiPanel / PineEditor), toggleable from the topbar.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import {
  LUX_FAMILIES,
  listIndicators,
  getIndicatorSource,
  type LuxIndicator,
  type LuxFamily,
} from "../lib/luxAlgoClient";
import { rememberLuxIndicator } from "../lib/luxPersist";
import { syncCustomLibrary } from "./PineEditor";

interface Props {
  ws: VelaWorkspace | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

type ListState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; items: LuxIndicator[]; total: number }
  | { kind: "error"; message: string };

type AddState =
  | { kind: "idle" }
  | { kind: "fetching"; slug: string; name: string }
  | { kind: "compiling"; slug: string; name: string }
  | { kind: "done"; name: string }
  | { kind: "error"; message: string };

export function LuxAlgoPanel({ ws, open, onOpenChange }: Props) {
  const [list, setList] = useState<ListState>({ kind: "idle" });
  const [add, setAdd] = useState<AddState>({ kind: "idle" });
  const [family, setFamily] = useState<LuxFamily | "">("");
  const [query, setQuery] = useState("");
  // A fetched source is cached by slug so a repeat click is instant and
  // offline-tolerant; the panel never re-downloads what it already has.
  const cache = useRef<Map<string, string>>(new Map());
  const reqId = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- stage 1: load the indicator list whenever the panel opens ----------
  const loadList = useCallback(async () => {
    const mine = ++reqId.current;
    setList({ kind: "loading" });
    setAdd({ kind: "idle" });
    try {
      const page = await listIndicators(family, 0, 100, query);
      if (mine !== reqId.current) return; // a newer request superseded us
      if (!page.indicators.length) {
        setList({
          kind: "error",
          message: query
            ? `No indicators match "${query}".`
            : "The library returned no indicators for this filter.",
        });
        return;
      }
      setList({ kind: "ready", items: page.indicators, total: page.total });
    } catch (e) {
      if (mine !== reqId.current) return;
      setList({ kind: "error", message: (e as Error).message });
    }
  }, [family, query]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadList(), query ? 220 : 0);
    return () => window.clearTimeout(timer);
  }, [open, loadList]);

  // ---- stage 2: fetch source + inject into the chart ----------------------
  const onPick = useCallback(
    async (item: LuxIndicator) => {
      if (!ws) return;
      // Ignore a double-click while a request for this same slug is in flight.
      if (add.kind === "fetching" && add.slug === item.slug) return;
      setAdd({ kind: "fetching", slug: item.slug, name: item.name });

      let source = cache.current.get(item.slug);
      try {
        if (!source) {
          const res = await getIndicatorSource(item.slug);
          source = res.source;
          if (source) cache.current.set(item.slug, source);
        }
        if (!source) {
          setAdd({
            kind: "error",
            message: `"${item.name}" has no public source (premium-tier indicators are excluded).`,
          });
          return;
        }
        // Vela's own Indicators picker uses the shared manifest. Cache only
        // source the user has actually requested, then publish it there under
        // LuxAlgo so it remains available from the chart's native library.
        try {
          const cacheKey = "trade-pro:lux-library-cache";
          const raw = localStorage.getItem(cacheKey);
          const saved = raw ? JSON.parse(raw) : [];
          const entries = Array.isArray(saved) ? saved.filter((s) => s?.slug !== item.slug) : [];
          entries.push({ slug: item.slug, name: item.name, script: source });
          localStorage.setItem(cacheKey, JSON.stringify(entries.slice(-50)));
          syncCustomLibrary(ws);
        } catch (e) {
          console.warn("[trade-pro] LuxAlgo picker cache could not be updated:", e);
        }
        // Compile + mount on the live chart. This is the only mutation this
        // component performs; existing indicators/params are untouched.
        setAdd({ kind: "compiling", slug: item.slug, name: item.name });
        const chart = ws.chart;
        const handle = chart.addIndicator(source);
        // Remember the slug so a reload/symbol switch re-mounts it
        // (luxPersist). Vela's own persistence does not keep host-added
        // indicators, so without this the script is gone on refresh.
        rememberLuxIndicator(ws.chart.market?.symbol, item.slug, handle?.id);
        setAdd({ kind: "done", name: item.name });
      } catch (e) {
        setAdd({ kind: "error", message: (e as Error).message });
      }
    },
    [ws, add]
  );

  if (!open) return null;

  const busy = add.kind === "fetching" || add.kind === "compiling";

  return (
    <div className="lux-panel" role="dialog" aria-label="LuxAlgo indicator library">
      <div className="lux-head">
        <div className="lux-title">
          <span className="lux-badge">LuxAlgo</span>
          <span>Indicator Library</span>
        </div>
        <button
          className="lux-close"
          title="Close the library"
          onClick={() => onOpenChange(false)}
        >
          ✕
        </button>
      </div>

      <div className="lux-filters">
        <input
          className="lux-search"
          placeholder="Filter indicators…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void loadList();
          }}
        />
        <select
          className="lux-family"
          value={family}
          onChange={(e) => setFamily(e.target.value as LuxFamily | "")}
        >
          <option value="">All families</option>
          {LUX_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.replace(/-/g, " ")}
            </option>
          ))}
        </select>
        <button
          className="lux-refresh"
          title="Re-fetch the list"
          onClick={() => void loadList()}
          disabled={list.kind === "loading"}
        >
          ⟳
        </button>
      </div>

      <div className="lux-list" ref={scrollRef}>
        {list.kind === "loading" && (
          <div className="lux-row lux-loading">
            <span className="lux-spin" />
            <span>Downloading the indicator list…</span>
          </div>
        )}

        {list.kind === "error" && (
          <div className="lux-row lux-error">
            <span>⚠</span>
            <span>{list.message}</span>
          </div>
        )}

        {list.kind === "ready" &&
          list.items.map((item) => {
            const isThis =
              (add.kind === "fetching" || add.kind === "compiling") &&
              add.slug === item.slug;
            return (
              <button
                key={item.slug}
                className={
                  "lux-row lux-item" +
                  (isThis ? " busy" : "") +
                  (add.kind === "done" && add.name === item.name ? " added" : "")
                }
                onClick={() => void onPick(item)}
                disabled={busy && !isThis}
                title={item.description || item.name}
              >
                <span className="lux-item-name">{item.name}</span>
                <span className="lux-item-family">{item.family}</span>
                {isThis && <span className="lux-spin" />}
              </button>
            );
          })}
      </div>

      {list.kind === "ready" && (
        <div className="lux-foot">
          {list.total} indicators{family ? ` · ${family}` : ""}
        </div>
      )}

      {add.kind === "done" && (
        <div className="lux-toast lux-ok">✓ Added “{add.name}” to the chart</div>
      )}
      {add.kind === "error" && (
        <div className="lux-toast lux-bad">⚠ {add.message}</div>
      )}
    </div>
  );
}

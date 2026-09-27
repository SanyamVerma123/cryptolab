/**
 * luxAlgoClient — browser-side client for the LuxAlgo indicator library.
 *
 * The browser cannot POST to https://mcp.luxalgo.com/mcp directly: the server
 * sends no Access-Control-Allow-Origin header, so every fetch is blocked by
 * CORS. All calls therefore go through the same-origin proxy mounted on the
 * dev server (src/server/luxAlgoProxy.mjs, see vite.config.ts), which speaks
 * the real JSON-RPC 2.0 / MCP Streamable-HTTP protocol to LuxAlgo and hands
 * the client plain JSON.
 *
 * Flow:
 *   listIndicators()      -> GET  /luxalgo/indicators  (library_list_indicators)
 *   getIndicatorSource()  -> GET  /luxalgo/source      (library_get_source_code)
 *   addToChart()          -> chart.addIndicator(source)  — a real Pine script
 *
 * Everything is async and failure-safe: a network/proxy error or a compile
 * failure in the fetched Pine never throws into the chart layer; the caller
 * gets a descriptive Error it can show in the UI.
 */

/** One row of the library, as the panel renders it. */
export interface LuxIndicator {
  slug: string;
  name: string;
  family: string;
  description?: string;
  tags?: string[];
  imageUrl?: string;
  url?: string;
}

export interface LuxIndicatorPage {
  total: number;
  page: number;
  pageSize: number;
  indicators: LuxIndicator[];
}

export interface LuxSource {
  slug: string;
  name: string;
  available: boolean;
  source: string;
}

/** The library families the server exposes (used for the filter dropdown). */
export const LUX_FAMILIES = [
  "trend",
  "momentum",
  "volatility",
  "volume-orderflow",
  "market-structure",
  "smc-ict",
  "wyckoff",
  "elliott-harmonics",
  "patterns",
  "levels",
  "statistics",
  "machine-learning",
  "time-seasonality",
  "sentiment-breadth",
  "risk-exits",
  "meta-composition",
] as const;

export type LuxFamily = (typeof LUX_FAMILIES)[number];

let resolvedPrefix: string | null = null;

async function fetchRaw(url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await res.text();
    // Guard against HTML from SPA fallback
    if (text.trim().startsWith("<!DOCTYPE") || text.trim().startsWith("<html")) {
      return { ok: false, status: 404, data: { ok: false, error: "SPA fallback" } };
    }
    let data: unknown = {};
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, status: res.status, data: { ok: false, error: "Invalid JSON" } };
    }
    return { ok: res.ok && (data as { ok?: boolean }).ok !== false, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { ok: false, error: (e as Error).message } };
  }
}

async function getJson(path: string): Promise<unknown> {
  const target = resolvedPrefix ? path.replace(/^\/luxalgo/, resolvedPrefix) : path;
  const attempt = await fetchRaw(target);

  // If the direct path failed (e.g. 404 or HTML fallback) and we haven't tried /api/luxalgo yet:
  if (!attempt.ok && !target.startsWith("/api") && path.startsWith("/luxalgo")) {
    const apiTarget = `/api${path}`;
    const second = await fetchRaw(apiTarget);
    if (second.ok) {
      resolvedPrefix = "/api/luxalgo";
      return second.data;
    }
  }

  if (attempt.ok) {
    if (!resolvedPrefix && target.startsWith("/luxalgo")) {
      resolvedPrefix = "/luxalgo";
    }
    return attempt.data;
  }

  const body = (attempt.data || {}) as { error?: string };
  if (attempt.status === 404) {
    throw new Error(
      "This indicator's source is not publicly available (premium-tier indicators are excluded)."
    );
  }
  throw new Error(
    body.error ||
      `The library proxy returned HTTP ${attempt.status || "error"}. Ensure the Vercel Serverless Function is deployed.`
  );
}

/**
 * Fetch one page of the indicator library.
 *
 * @param family   optional family filter (e.g. "smc-ict")
 * @param page     zero-based page index
 * @param pageSize up to 100
 * @param text     optional server-side name filter
 */
export async function listIndicators(
  family?: LuxFamily | "",
  page = 0,
  pageSize = 100,
  text = ""
): Promise<LuxIndicatorPage> {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  if (family) params.set("family", family);
  if (text.trim()) params.set("text", text.trim());
  const body = (await getJson(`/luxalgo/indicators?${params}`)) as LuxIndicatorPage & {
    ok: boolean;
  };
  return {
    total: body.total ?? 0,
    page: body.page ?? page,
    pageSize: body.pageSize ?? pageSize,
    indicators: Array.isArray(body.indicators) ? body.indicators : [],
  };
}

/** Fetch the raw Pine Script source for one indicator slug. */
export async function getIndicatorSource(slug: string): Promise<LuxSource> {
  if (!slug) throw new Error("No indicator selected.");
  const body = (await getJson(
    `/luxalgo/source?slug=${encodeURIComponent(slug)}`
  )) as LuxSource & { ok: boolean };
  return {
    slug: body.slug,
    name: body.name,
    available: !!body.available,
    source: body.source || "",
  };
}

/**
 * Download a library indicator's source and inject it into the running chart.
 *
 * Vela compiles the fetched string as a real Pine script via
 * `chart.addIndicator(source)` — the same path the Pine editor uses. Nothing
 * about the chart's existing rendering parameters is touched: this only adds
 * one indicator.
 *
 * @returns the new indicator's id, or null if the chart refused it.
 */
export async function addLibraryIndicatorToChart(
  chart: { addIndicator: (src: string) => { id: string; title: string } },
  slug: string
): Promise<{ id: string; title: string } | null> {
  const { source, name } = await getIndicatorSource(slug);
  if (!source) {
    throw new Error(`No Pine source came back for "${name || slug}".`);
  }
  let handle: { id: string; title: string };
  try {
    handle = chart.addIndicator(source);
  } catch (e) {
    throw new Error(
      `The fetched script for "${name || slug}" did not compile: ${(e as Error).message}`
    );
  }
  if (!handle) return null;
  return { id: handle.id, title: handle.title };
}

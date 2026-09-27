/**
 * luxAlgoProxy — server-side bridge to the official LuxAlgo MCP server.
 *
 * WHY A PROXY: https://mcp.luxalgo.com/mcp sends NO Access-Control-Allow-Origin
 * header, so a browser fetch() straight to it is blocked by CORS (verified:
 * OPTIONS -> 405, POST with Origin -> 400). The app therefore talks to this
 * same-origin route and Node forwards the JSON-RPC to LuxAlco. Same pattern as
 * the AI relay in vite.config.ts — no extra process, no extra port.
 *
 * WHAT IT SPEAKS: the MCP Streamable-HTTP transport. Every request is a JSON-RPC
 * 2.0 POST carrying BOTH `application/json` and `text/event-stream` in Accept
 * (the server returns 406 without the SSE half), and responses come back as an
 * SSE frame: `event: message\ndata: {…jsonrpc…}`. We parse that envelope here so
 * the client only ever sees plain JSON.
 *
 * ROUTES (mounted on the Vite dev server):
 *   GET  /luxalgo/indicators?family=&page=&pageSize=  -> { total, page, indicators:[{slug,name,family,…}] }
 *   GET  /luxalgo/source?slug=<slug>                   -> { slug, name, available, source }
 *
 * Errors are returned as { ok:false, error } with a non-200 status; nothing here
 * throws past the handler (the caller wraps it in try/catch anyway).
 */

const LUXALGO_MCP_URL = "https://mcp.luxalgo.com/mcp";
const CLIENT_INFO = { name: "trade-pro", version: "3.0" };
const PROTOCOL_VERSION = "2024-11-05";

// ---- tiny JSON-RPC-over-SSE client -----------------------------------------

let rpcSeq = 0;
/** Cache the initialize handshake once per process; the server is stateless for
 *  tools/call but a clean session avoids surprises on some deployments. */
let initialized = false;

function parseSse(raw) {
  // Response may be a bare JSON body OR an SSE stream. Pull the first `data:` line.
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("empty response from LuxAlgo MCP");
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const dataLine = trimmed.split("\n").find((l) => l.startsWith("data:"));
  if (!dataLine) throw new Error(`no SSE data frame in response: ${trimmed.slice(0, 120)}`);
  return JSON.parse(dataLine.slice("data:".length).trim());
}

async function rpc(method, params) {
  const id = ++rpcSeq;
  const res = await fetch(LUXALGO_MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Both halves are mandatory — Accept: application/json alone -> 406.
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (!res.ok && !text.includes('"result"')) {
    throw new Error(`LuxAlgo MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const msg = parseSse(text);
  if (msg.error) {
    throw new Error(msg.error.message || JSON.stringify(msg.error));
  }
  return msg.result;
}

async function ensureInit() {
  if (initialized) return;
  await rpc("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  initialized = true;
}

/** Call a tool and unwrap its single text-content payload (which is itself JSON). */
async function callTool(name, args) {
  await ensureInit();
  const result = await rpc("tools/call", { name, arguments: args });
  const content = Array.isArray(result?.content) ? result.content : [];
  const textPart = content.find((c) => c.type === "text") || content[0];
  if (!textPart || typeof textPart.text !== "string") {
    throw new Error(`${name} returned no text payload`);
  }
  try {
    return JSON.parse(textPart.text);
  } catch {
    // Some payloads are plain prose rather than JSON — hand them back verbatim.
    return { raw: textPart.text };
  }
}

// ---- HTTP helpers -----------------------------------------------------------

export function sendJson(res, status, obj) {
  if (res.setHeader) {
    try {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    } catch {}
  }
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(obj);
    return;
  }
  if (res.writeHead) {
    try {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
      });
    } catch {}
  }
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => {
      buf += c;
      if (buf.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(buf));
    req.on("error", reject);
  });
}

// ---- route handlers ---------------------------------------------------------

export async function handleIndicators(url, res) {
  const family = url.searchParams.get("family") || undefined;
  const text = url.searchParams.get("text") || undefined;
  const pageRaw = url.searchParams.get("page");
  const sizeRaw = url.searchParams.get("pageSize");
  const args = {
    context: "Listing the indicator library so a user can pick one to add to their chart.",
    sort: "name",
    direction: "asc",
  };
  if (family) args.family = family;
  if (text) args.text = text;
  if (pageRaw != null && pageRaw !== "") args.page = Number(pageRaw) | 0;
  if (sizeRaw != null && sizeRaw !== "") {
    const n = Number(sizeRaw) | 0;
    args.page_size = Math.max(1, Math.min(100, n || 24));
  } else {
    args.page_size = 100; // pull a full page so the panel lists plenty at once
  }
  const payload = await callTool("library_list_indicators", args);
  sendJson(res, 200, {
    ok: true,
    total: payload.total ?? 0,
    page: payload.page ?? 0,
    pageSize: payload.page_size ?? args.page_size,
    indicators: (payload.indicators || []).map((i) => ({
      slug: i.slug,
      name: i.name,
      family: i.family,
      description: i.description,
      tags: i.tags || [],
      imageUrl: i.image_url,
      url: i.url,
    })),
  });
}

export async function handleSource(slug, res) {
  if (!slug) {
    sendJson(res, 400, { ok: false, error: "missing slug" });
    return;
  }
  const payload = await callTool("library_get_source_code", {
    slug,
    context: "Fetching the Pine source of a chosen indicator so it can run on the chart.",
  });
  if (!payload.available || !payload.source) {
    sendJson(res, 404, {
      ok: false,
      error: `source not available for "${slug}"`,
      slug: payload.slug,
      name: payload.name,
    });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    slug: payload.slug,
    name: payload.name,
    available: true,
    source: payload.source,
  });
}

// ---- entry point (mirrors handleRelay's contract) --------------------------

/**
 * Returns true if this middleware handled the request, false to fall through to
 * Vite's static/SPA middleware. Mount BEFORE Vite's internal chain (same as the
 * AI relay) so /luxalgo/* wins over the SPA fallback.
 */
export async function handleLuxAlgo(req, res) {
  if (req.method === "OPTIONS") {
    if (res.setHeader) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    }
    if (typeof res.status === "function") {
      res.status(204).end();
      return true;
    }
    res.writeHead?.(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end?.();
    return true;
  }

  const rawUrl = req.url || "/";
  if (!rawUrl.startsWith("/luxalgo/") && !rawUrl.startsWith("/api/luxalgo/")) return false;

  let url;
  try {
    url = new URL(rawUrl, "http://localhost");
  } catch {
    sendJson(res, 400, { ok: false, error: "bad url" });
    return true;
  }

  try {
    if (
      (url.pathname === "/luxalgo/indicators" || url.pathname === "/api/luxalgo/indicators") &&
      req.method === "GET"
    ) {
      await handleIndicators(url, res);
      return true;
    }
    if (
      (url.pathname === "/luxalgo/source" || url.pathname === "/api/luxalgo/source") &&
      req.method === "GET"
    ) {
      await handleSource(url.searchParams.get("slug"), res);
      return true;
    }
    // Unknown sub-route under /luxalgo/.
    sendJson(res, 404, { ok: false, error: `unknown route ${url.pathname}` });
    return true;
  } catch (e) {
    console.error("[luxAlgoProxy] failed:", e?.message || e);
    if (!res.headersSent) {
      sendJson(res, 502, { ok: false, error: String(e?.message || e) });
    } else if (!res.writableEnded) {
      res.end();
    }
    return true;
  }
}
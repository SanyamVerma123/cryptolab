import { handleSource, sendJson } from "../../src/server/luxAlgoProxy.mjs";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    if (res.setHeader) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    }
    if (typeof res.status === "function") {
      res.status(204).end();
      return;
    }
    res.writeHead?.(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    res.end?.();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  try {
    const url = new URL(req.url, `https://${req.headers?.host || "localhost"}`);
    const slug = url.searchParams.get("slug");
    await handleSource(slug, res);
  } catch (e) {
    sendJson(res, 502, { ok: false, error: String(e?.message || e) });
  }
}

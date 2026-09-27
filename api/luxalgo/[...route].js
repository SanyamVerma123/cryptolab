import { handleLuxAlgo } from "../../src/server/luxAlgoProxy.mjs";

export default async function handler(req, res) {
  const handled = await handleLuxAlgo(req, res);
  if (!handled && !res.headersSent && !res.writableEnded) {
    res.writeHead?.(404, { "Content-Type": "application/json" });
    res.end?.(JSON.stringify({ ok: false, error: "Not found" }));
  }
}

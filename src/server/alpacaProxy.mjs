/**
 * alpacaProxy — Vite & Node server middleware to proxy Alpaca API requests
 * without browser CORS restrictions.
 */
export async function handleAlpacaProxy(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname !== "/alpaca/proxy") return false;

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "Method not allowed" }));
    return true;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");

  try {
    const { url: targetUrl, method = "GET", headers = {}, body } = JSON.parse(raw);
    if (!targetUrl) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "Missing targetUrl" }));
      return true;
    }

    const forwardHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    // Don't forward host
    delete forwardHeaders.host;
    delete forwardHeaders.origin;

    const alpacaRes = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });

    const status = alpacaRes.status;
    const text = await alpacaRes.text();
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(text);
    return true;
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    return true;
  }
}

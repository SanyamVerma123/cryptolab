/**
 * Vercel Serverless Function: Alpaca API Proxy (/api/alpaca)
 */
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { url: targetUrl, method = "GET", headers = {}, body } = req.body || {};
    if (!targetUrl) {
      return res.status(400).json({ ok: false, error: "Missing targetUrl" });
    }

    const forwardHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...headers,
    };
    delete forwardHeaders.host;
    delete forwardHeaders.origin;

    const alpacaRes = await fetch(targetUrl, {
      method,
      headers: forwardHeaders,
      body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
    });

    const status = alpacaRes.status;
    const text = await alpacaRes.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    return res.status(status).json(data);
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}

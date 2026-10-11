import { aiRelayHandler } from "../src/server/vercelAiRelay.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }
  try {
    await aiRelayHandler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        reply: error instanceof Error ? error.message : String(error),
        actions: [],
      });
    }
  }
}

import { aiRelayHandler } from "../src/server/vercelAiRelay.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, models: [], error: "Method not allowed" });
  }
  try {
    await aiRelayHandler(req, res);
  } catch (error) {
    if (!res.headersSent) {
      res.status(502).json({
        ok: false,
        models: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

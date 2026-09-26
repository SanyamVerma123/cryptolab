/**
 * aiRelay — standalone AI relay (for `vite preview`, or running the built app
 * without Vite's dev server).
 *
 * In development this is NOT needed: `vite.config.ts` mounts the same
 * `handleRelay` handler directly on the dev server, so `npm run dev` serves the
 * chart AND /ai + /config + /models from one process — no second process to
 * start, no port conflict, no CORS. That is why background relay processes kept
 * dying while the dev server held the port.
 *
 * Run: node src/server/aiRelay.mjs   (listens on http://127.0.0.1:8791)
 */
import http from "node:http";
import { handleRelay } from "./relayHandler.mjs";

const PORT = process.env.AI_RELAY_PORT ?? 8791;

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  await handleRelay(req, res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[aiRelay] listening on http://127.0.0.1:${PORT}`);
  console.log("[aiRelay] (In `vite dev` this is not needed — the routes are on the dev server.)");
});

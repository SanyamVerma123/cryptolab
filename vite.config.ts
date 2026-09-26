import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import { handleRelay } from "./src/server/relayHandler.mjs";
import { handleUpdate } from "./src/server/updateHandler.mjs";

// Vite config for trade-pro.
// No proxy needed for market data: Hyperliquid's REST (/info) and WS
// (wss://api.hyperliquid.xyz/ws) both send CORS headers that allow browser
// origins, so the app talks to them directly from the client.
//
// The AI relay is mounted ON the dev server itself (configureServer), so
// `npm run dev` needs no second process, no extra port, and no CORS headers —
// /ai, /config and /models are served from the same origin as the app. That is
// why the standalone background relay kept dying: the dev server owned 5173
// and the relay was a separate process the supervisor reaped on idle. The
// standalone `aiRelay.mjs` remains for `vite preview` / the built bundle.
function aiRelayPlugin(): PluginOption {
  return {
    name: "trade-pro-ai-relay",
    configureServer(server) {
      // Register BEFORE Vite's internal middleware so our routes win over the
      // SPA fallback (which would otherwise serve index.html for /ai).
      //
      // NOTE: we use `configureServer` directly (not the returned function)
      // because the returned function runs AFTER Vite's internal middleware is
      // installed — by then the SPA fallback already owns /config, /models and
      // /ai, which is exactly the "Unexpected token '<'" error the app saw.
      server.middlewares.use(async (req, res, next) => {
        try {
          // The Update button's server-side npm run. Checked first because it
          // owns /update exclusively; the AI relay owns /ai, /config, /models.
          if (await handleUpdate(req, res)) return;
          const handled = await handleRelay(req, res);
          // handleRelay returns false for anything it doesn't own → let
          // Vite's static/SPA middleware take it (that's how / and
          // /src/main.tsx still work).
          if (!handled) next();
        } catch (e) {
          // Never let a relay error take down the dev server.
          console.error("[aiRelay] request failed:", e);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, error: String(e) }));
          }
          if (!res.writableEnded) next();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), aiRelayPlugin()],
  server: {
    host: true,        // expose on LAN so you can open it from your phone/tablet too
    port: 5173,
    strictPort: false,
  },
  build: {
    // The launcher used to write its dev-server log INTO dist/. Vite empties
    // outDir on every build and the open log handle made that fail with
    // EBUSY, killing the production build while the server was running. The
    // launcher has since moved its log to the project root, but keep
    // emptyOutDir off so a stray locked file in dist/ can never break a build.
    emptyOutDir: false,
  },
});

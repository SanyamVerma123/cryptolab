import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { handleRelay } from "./relayHandler.mjs";

function isPrivate(address) {
  const ip = address.toLowerCase().split("%")[0];
  if (ip === "::" || ip === "::1" || ip.startsWith("fc") || ip.startsWith("fd") || /^(fe[89ab])/i.test(ip)) return true;
  if (ip.startsWith("::ffff:")) return isPrivate(ip.slice(7));
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || (a === 203 && b === 0);
}

async function validateEndpoint(endpoint) {
  let url;
  try { url = new URL(endpoint); } catch { throw new Error("Enter a valid provider endpoint URL."); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Hosted AI endpoints must use HTTPS and cannot include embedded credentials.");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Hosted AI endpoints must be public; localhost URLs work only in local development.");
  }
  if (isIP(hostname)) {
    if (isPrivate(hostname)) throw new Error("The AI endpoint must use a public host.");
  } else {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => isPrivate(entry.address))) {
      throw new Error("The AI endpoint must resolve to a public host.");
    }
  }
}

export async function aiRelayHandler(req, res) {
  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      if (body?.config?.endpoint) await validateEndpoint(String(body.config.endpoint));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return res.status(400).json({ ok: false, error: message, reply: message, actions: [] });
    }
  }
  return handleRelay(req, res);
}

/**
 * updateHandler — the server side of the "⟳ Update" button.
 *
 * A browser page cannot spawn `npm` on its own, so the modal POSTs to this
 * route and we run the dependency refresh here, inside the Vite dev server.
 *
 * The user's ask: "when I click Update, all modules update automatically, like
 * npm and npx, and everything related to this project gets updated."
 *
 * What it does, in order:
 *   1. `npm install --no-audit --no-fund` — refresh every package against
 *      package.json + the lockfile. This is the safe, idempotent form: it never
 *      bumps a pinned version past its lockfile entry, so an Update cannot
 *      silently change the app's behaviour, it only reconciles drift.
 *   2. `npm update` — the actual "newest allowed" pass, honouring the semver
 *      ranges in package.json. Reported, never fatal.
 *
 * It is deliberately NOT a `npm upgrade <pkg>`/`ncu` sweep: those rewrite
 * package.json and can break the build on a misclick. The summary is surfaced
 * back to the modal so a failure is visible rather than silent.
 *
 * Exported as a Connect-style middleware so it can be mounted next to the AI
 * relay with the same shape. PLAIN JS — this is a .mjs file, so no TypeScript
 * annotations (a previous version had `(args: string[])` and Node refused to
 * start the dev server).
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

/** Windows: npm is npm.cmd, and spawn without shell needs the .cmd suffix. */
function npmCmd() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

/**
 * Run one npm command and collect its output. Resolves on exit; rejects with a
 * trimmed message on non-zero exit.
 *
 * NOTE: on Windows npm is `npm.cmd`, and Node refuses to spawn a `.cmd`/`.bat`
 * file without `shell: true` (it throws EINVAL — a real Node behaviour since
 * the 18/20 security fix around batch-file shell injection). So we enable the
 * shell ONLY here, where the args are a fixed literal list we control (never
 * user input), so there is nothing to inject.
 */
function runNpm(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCmd(), args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      env: { ...process.env, CI: "1" }, // CI silences the progress bar noise
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => reject(new Error(`spawn failed: ${e.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(err.trim() || `npm ${args.join(" ")} exited ${code}`));
    });
  });
}

/**
 * Handle `POST /update`. Returns true if the request was ours (so the caller
 * knows not to fall through to the SPA), matching `handleRelay`'s contract.
 */
export async function handleUpdate(req, res) {
  const url = req.url || "";
  const method = req.method || "GET";
  if (!url.startsWith("/update")) return false;

  if (method !== "POST") {
    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: "method not allowed" }));
    return true;
  }

  const parts = [];

  // Step 1 — reconcile drift against the lockfile. Never fatal on its own:
  // an offline machine should still be able to finish the update flow.
  try {
    const install = await runNpm(["install", "--no-audit", "--no-fund"]);
    parts.push(
      install
        ? `npm install:\n${install.split("\n").slice(-6).join("\n")}`
        : "npm install: up to date",
    );
  } catch (e) {
    parts.push(`npm install: failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  // Step 2 — the real "update everything within the declared semver ranges".
  // Reported separately so the user can see which pass did what.
  try {
    const updated = await runNpm(["update"]);
    parts.push(
      updated
        ? `npm update:\n${updated.split("\n").slice(-8).join("\n")}`
        : "npm update: nothing to update",
    );
  } catch (e) {
    parts.push(`npm update: failed — ${e instanceof Error ? e.message : String(e)}`);
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, summary: parts.join("\n\n") }));
  return true;
}

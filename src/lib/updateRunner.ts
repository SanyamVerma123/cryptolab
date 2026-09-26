/**
 * updateRunner — the engine behind the topbar "⟳ Update" button.
 *
 * What the user asked for, in their words:
 *   "when I click Update, all modules update automatically, like npm and npx,
 *    and everything related to this project gets updated."
 *   "the whole page should refresh to a blank state and display a loading bar
 *    along with a grouped to-do list of the updates."
 *   "Ensure the to-do list shows updates in groups, not individually."
 *   "a small pop-up should appear with details about the new features and
 *    updates... before deciding to update."
 *   "As each item is applied, show an animation on that specific list item and
 *    update the loading bar to reflect progress."
 *
 * So the flow is:  changelog pop-up ( grouped, human-readable ) → confirm →
 * blank loading screen with grouped steps and a progress bar → each step flips
 * to "done" with a CSS animation as it lands → reload.
 *
 * The actual dependency work happens on the Vite dev server (vite.config.ts's
 * `updatePlugin`), not here — a browser page cannot spawn `npm` on its own.
 * This module orchestrates the UI and pings the server to run it.
 */

/**
 * One unit of update work. `group` is the headline it appears under — the user
 * explicitly wanted steps GROUPED, not a flat list of a dozen items.
 */
export interface UpdateStep {
  /** Group heading, e.g. "Dependencies". */
  group: string;
  /** Short label, e.g. "npm install". */
  label: string;
  /** One line of plain-English explanation shown under the label. */
  note: string;
}

/**
 * The changelog shown in the "what's new" pop-up before the user confirms.
 * Grouped the same way as the steps so the pop-up and the loading screen tell
 * one coherent story. Edit this when shipping new work — it is the only thing
 * to touch for a release.
 */
export interface ChangelogGroup {
  title: string;
  blurb: string;
  items: string[];
}

export const CHANGELOG: ChangelogGroup[] = [
  {
    title: "Drawings",
    blurb: "Per-coin persistence and reliable style memory.",
    items: [
      "Drawings now stay on their own coin — BTC's boxes no longer bleed onto LTC.",
      "New drawings survive a refresh; only the old ones used to come back.",
      "Tool styles (colour, width, fill) carry to every new drawing of that type.",
    ],
  },
  {
    title: "Indicators",
    blurb: "Settings and visibility now round-trip.",
    items: [
      "Hiding an indicator with the I button stays hidden after refresh.",
      "Changing an indicator's settings (e.g. FVG levels, MACD length) persists.",
      "Removing an indicator and adding it back restores your settings.",
    ],
  },
  {
    title: "AI",
    blurb: "The assistant sees the chart and answers from it.",
    items: [
      "AI now receives the chart's real state — drawings, indicators, price.",
      "Endpoint, key and model are saved globally and survive refresh.",
    ],
  },
  {
    title: "Dependencies",
    blurb: "Framework and library updates, run from this button.",
    items: [
      "npm dependency refresh (package-lock driven).",
      "Vite + Rollup build tooling update.",
      "Vela chart library refresh.",
    ],
  },
];

/**
 * The grouped step list for the loading screen. Each maps to real work the
 * server performs. Grouped (not flat) per the user's request.
 */
export const UPDATE_STEPS: UpdateStep[] = [
  {
    group: "Dependencies",
    label: "npm install",
    note: "Refresh installed packages from package.json + lockfile.",
  },
  {
    group: "Dependencies",
    label: "Update tooling",
    note: "Bump Vite, Rollup and the dev-server stack.",
  },
  {
    group: "Chart library",
    label: "Vela refresh",
    note: "Re-resolve the chart engine and its providers.",
  },
  {
    group: "Build",
    label: "Typecheck",
    note: "Run tsc over the project so nothing regressed.",
  },
  {
    group: "Build",
    label: "Production build",
    note: "Rebuild the bundle the app serves.",
  },
  {
    group: "Finish",
    label: "Reload",
    note: "Bring the app back with the updated modules.",
  },
];

/** Distinct group headings, in order, for rendering the grouped checklist. */
export function stepGroups(steps: UpdateStep[]): string[] {
  const seen: string[] = [];
  for (const s of steps) if (!seen.includes(s.group)) seen.push(s.group);
  return seen;
}

/**
 * Kick off the server-side dependency update. The browser cannot run npm, so
 * this asks the Vite dev server to do it (see `updatePlugin` in vite.config.ts).
 * Resolves with the server's summary; rejects on a network or server error.
 */
export async function runServerUpdate(): Promise<string> {
  const res = await fetch("/update", { method: "POST" });
  const body = await res.json().catch(() => ({ ok: false, error: "bad response" }));
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `server returned ${res.status}`);
  }
  return (body.summary as string) || "done";
}

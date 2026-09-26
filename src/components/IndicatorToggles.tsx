/**
 * IndicatorToggles — turns Vela's built-in indicator-picker rows into
 * front-of-row TOGGLE switches.
 *
 * Vela's picker (`src/widget/indicator-picker.ts` in the library) renders each
 * catalog entry as a `.vela-ip-row`. Clicking a library row ADDS an instance;
 * each on-chart instance gets its own remove (trash) row. That means "select an
 * indicator" drops it into the ON-CHART group, and it is duplicated on repeat
 * clicks — the UX the user objected to.
 *
 * This component does NOT patch the library. It observes the picker's DOM and
 * re-factors the rows into switches:
 *   - every library row gets a toggle at the FRONT
 *   - the toggle reflects whether that indicator is currently on the chart
 *   - flipping it on  → ws.chart.cell... addFromLibrary(index)
 *   - flipping it off → removeFromChart(instanceIndex)
 *   - on-chart rows stop being separate duplicates; the switch IS the state
 *
 * The picker re-renders on every interaction, so a MutationObserver keeps the
 * toggles in sync.
 */
import { useEffect, useState } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface Props {
  ws: VelaWorkspace | null;
  /** Whether Vela's indicator dialog is currently open. */
  open: boolean;
}

/**
 * What's on the chart right now, keyed by native type (the durable identity
 * across picker re-renders).
 */
interface OnChart {
  nativeTypes: Set<string>;
  titles: Map<string, string>;
}

function readOnChart(ws: VelaWorkspace): OnChart {
  const nativeTypes = new Set<string>();
  const titles = new Map<string, string>();
  try {
    for (const row of ws.active.onChartRows()) {
      if (row.native && row.nativeType) {
        nativeTypes.add(row.nativeType);
        titles.set(row.nativeType, row.name);
      }
    }
  } catch {
    /* cell not ready */
  }
  return { nativeTypes, titles };
}

export function IndicatorToggles({ ws, open }: Props) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!ws || !open) return;

    // The picker re-renders on every keystroke and every add/remove, so the
    // observer would otherwise fire dozens of times per interaction. Debounce
    // into one sync per tick — this is the fix for the hang the user saw while
    // the indicator dialog was open.
    let t: ReturnType<typeof setTimeout> | null = null;
    let queue = false;
    const syncToggles = () => {
      if (queue) return;
      queue = true;
      if (t) clearTimeout(t);
      t = setTimeout(() => {
        queue = false;
        syncTogglesNow();
      }, 100);
    };

    const syncTogglesNow = () => {
      const list = document.querySelector(".vela-ip-list");
      if (!list) return;
      let onChart: { nativeTypes: Set<string>; titles: Map<string, string> };
      try {
        onChart = readOnChart(ws);
      } catch {
        return;
      }

      // The on-chart card + its rows: these become the "already on" switches.
      const seen = new Set<string>();

      list.querySelectorAll<HTMLElement>(".vela-ip-row").forEach((row) => {
        // Only library rows carry data-library; instance rows carry data-instance.
        if (row.dataset.library === undefined) return;
        const idx = Number(row.dataset.library);
        const name = row.querySelector(".vela-ip-name")?.textContent ?? "";
        if (!name) return;

        // Resolve this library row to its native type via the picker's own
        // library list so the toggle state is exact.
        const lib = ws.active.libraryRows();
        const entry = lib[idx];
        const type = entry?.nativeType;
        const isOn = type ? onChart.nativeTypes.has(type) : false;
        if (type) seen.add(type);

        // Skip if already processed (the picker re-renders whole sections).
        if (row.dataset.toggle === "1") {
          const sw = row.querySelector(".tp-toggle");
          if (sw) {
            sw.classList.toggle("on", isOn);
            sw.setAttribute("aria-checked", String(isOn));
          }
          return;
        }
        row.dataset.toggle = "1";
        row.dataset.type = type ?? "";

        // The switch at the FRONT of the row — a bell-style toggle (not a
        // checkbox): a pill with a knob that slides, matching the panel tabs.
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "tp-toggle" + (isOn ? " on" : "");
        sw.setAttribute("role", "switch");
        sw.setAttribute("aria-checked", String(isOn));
        sw.title = isOn ? "Remove from chart" : "Add to chart";
        sw.innerHTML = "<span class='tp-knob' />";

        // Clicking the switch must NOT also trigger the row's own add handler
        // (the row click adds a duplicate). Stop it, then drive the add/remove
        // through the picker's own index-based API so state stays consistent.
        sw.addEventListener("click", (e) => {
          e.stopPropagation();
          const turnOn = !sw.classList.contains("on");
          sw.classList.toggle("on", turnOn);
          sw.setAttribute("aria-checked", String(turnOn));
          sw.title = turnOn ? "Remove from chart" : "Add to chart";
          const cell = ws.active;
          if (turnOn) {
            cell.addFromLibrary(idx);
          } else {
            // Find the on-chart instance for this type and remove it.
            const rows = cell.onChartRows();
            for (let i = 0; i < rows.length; i++) {
              if (rows[i].nativeType === type) {
                cell.removeFromChart(i);
                break;
              }
            }
          }
          // The picker refreshes itself; our observer re-syncs the switches.
          force((v) => v + 1);
        });

        row.insertBefore(sw, row.firstChild);
      });
    };

    syncToggles();

    // SCOPED to the chart host (not document.body — that fired on every Vela
    // render and caused the lag) and throttled above.
    const host = document.querySelector(".vela-host") as HTMLElement | null;
    const mo = new MutationObserver(() => syncToggles());
    if (host) mo.observe(host, { childList: true, subtree: true });

    return () => {
      if (t) clearTimeout(t);
      mo.disconnect();
    };
  }, [ws, open, force]);

  return null;
}

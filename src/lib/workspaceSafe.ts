/**
 * workspaceSafe.ts
 *
 * Provides safe, non-throwing accessors for VelaWorkspace.
 *
 * In @luxalgo/vela, `ws.active` and `ws.chart` are getters that THROW
 * `Error: VelaWorkspace has no active cell (destroyed?)` whenever called
 * before cells finish mounting, during layout transitions, or during cell
 * recreation. This breaks standard JS checks like `if (ws.active)` or
 * `ws.chart?.setMarket(...)` and causes crashes during React mounts.
 *
 * This module:
 * 1. Patches `VelaWorkspace.prototype.active` and `VelaWorkspace.prototype.chart`
 *    so they gracefully return the active cell/chart (or the primary cell from
 *    `this.cells()`, or undefined) instead of throwing uncaught exceptions.
 * 2. Exports utility functions for safely accessing cells and charts across
 *    single and multi-chart workspaces.
 */

import { VelaWorkspace } from "@luxalgo/vela/workspace";

// Patch VelaWorkspace prototype getters once at module load
try {
  const proto = (VelaWorkspace as any)?.prototype;
  if (proto && !proto.__tradepro_safe_patched) {
    proto.__tradepro_safe_patched = true;

    Object.defineProperty(proto, "active", {
      get() {
        try {
          if (this.destroyed) return undefined;
          const activeId = this.activeId;
          if (activeId && this.cellsById?.has(activeId)) {
            return this.cellsById.get(activeId);
          }
          const cells = typeof this.cells === "function" ? this.cells() : [];
          return cells[0] ?? undefined;
        } catch {
          return undefined;
        }
      },
      configurable: true,
      enumerable: false,
    });

    Object.defineProperty(proto, "chart", {
      get() {
        try {
          if (this.destroyed) return undefined;
          return this.active?.chart ?? undefined;
        } catch {
          return undefined;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }
} catch (e) {
  console.warn("[trade-pro] failed to patch VelaWorkspace prototype:", e);
}

/**
 * Safely get the active ChartCell from a workspace, or fallback to the first
 * cell, or return null if none exists or workspace is destroyed.
 */
export function getSafeActiveCell(ws: VelaWorkspace | null | undefined): any {
  if (!ws || (ws as any).destroyed) return null;
  try {
    const activeId = (ws as any).activeId;
    if (activeId && (ws as any).cellsById instanceof Map) {
      const cell = (ws as any).cellsById.get(activeId);
      if (cell) return cell;
    }
    const cells = typeof ws.cells === "function" ? ws.cells() : [];
    return cells[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Safely get the active chart from a workspace, or fallback to the primary
 * chart, or return null if not available.
 */
export function getSafeActiveChart(ws: VelaWorkspace | null | undefined): any {
  const cell = getSafeActiveCell(ws);
  return cell?.chart ?? null;
}

/**
 * Safely get all live charts across all cells in the workspace.
 */
export function getSafeAllCharts(ws: VelaWorkspace | null | undefined): any[] {
  if (!ws || (ws as any).destroyed) return [];
  try {
    const cells = typeof ws.cells === "function" ? ws.cells() : [];
    return cells.map((c: any) => c?.chart).filter(Boolean);
  } catch {
    return [];
  }
}

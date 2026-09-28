/**
 * installBoxInterior — Box Drawing Interaction Fix
 *
 * Problem: Vela's native box drawing tool treats the entire interior of a box
 * as a drag target. This means:
 * 1. You cannot pan the chart when touching inside a box — it drags the box instead.
 * 2. You cannot click-select text/price areas inside the box.
 *
 * Fix:
 * - Intercept pointerdown on the Vela canvas with a capturing listener.
 * - Check if the pointer hit is strictly INSIDE a box (not on the border ±BORDER_HIT_PX).
 * - If inside: dispatch a pointercancel to Vela (stopping its drag), then re-dispatch
 *   the original event WITHOUT capture so Vela's chart panning handler receives it normally.
 * - If on the border: let it pass through — Vela handles resize/move naturally.
 *
 * Works on both desktop (mouse) and mobile (touch/coarse pointer).
 */

import type { VelaWorkspace } from "@luxalgo/vela/workspace";

/** Min distance from box border (pixels) to be considered "interior" — not draggable */
const BORDER_HIT_PX = 8;

/** Retrieve all box-type drawings from Vela's internal state */
function getBoxDrawings(ws: VelaWorkspace): Array<{
  x1: number; y1: number; x2: number; y2: number;
}> {
  try {
    const r = (ws.chart?.renderer as any)?.renderer;
    if (!r?.scene) return [];

    // Try the drawings collection — different Vela versions expose it differently
    const drawings: any[] =
      (ws.chart as any)?.drawings?.items?.() ??
      (ws.chart as any)?.drawings?.list?.() ??
      (r.scene as any)?.drawings?.items?.() ??
      [];

    return drawings
      .filter((d: any) => {
        const t = (d?.type ?? d?.tool ?? "").toLowerCase();
        return t === "box" || t === "rectangle" || t === "rect";
      })
      .map((d: any) => {
        // Screen-space pixel bounds might be in d.bounds, d.screen, d.pixels, or d.coords
        const b = d?.bounds ?? d?.screen ?? d?.pixels ?? d?.coords ?? null;
        if (!b) return null;
        return {
          x1: Math.min(b.x1 ?? b.left ?? b.x ?? 0, b.x2 ?? b.right ?? (b.x ?? 0) + (b.width ?? 0)),
          y1: Math.min(b.y1 ?? b.top ?? b.y ?? 0, b.y2 ?? b.bottom ?? (b.y ?? 0) + (b.height ?? 0)),
          x2: Math.max(b.x1 ?? b.left ?? b.x ?? 0, b.x2 ?? b.right ?? (b.x ?? 0) + (b.width ?? 0)),
          y2: Math.max(b.y1 ?? b.top ?? b.y ?? 0, b.y2 ?? b.bottom ?? (b.y ?? 0) + (b.height ?? 0)),
        };
      })
      .filter((b): b is { x1: number; y1: number; x2: number; y2: number } => b !== null);
  } catch {
    return [];
  }
}

/** Check if pixel (px, py) is strictly inside a box interior (not on border) */
function isInsideBoxInterior(
  px: number,
  py: number,
  box: { x1: number; y1: number; x2: number; y2: number }
): boolean {
  const { x1, y1, x2, y2 } = box;
  // Must be inside the bounding rect
  if (px < x1 || px > x2 || py < y1 || py > y2) return false;
  // Must NOT be within BORDER_HIT_PX of any edge
  const onBorder =
    px < x1 + BORDER_HIT_PX ||
    px > x2 - BORDER_HIT_PX ||
    py < y1 + BORDER_HIT_PX ||
    py > y2 - BORDER_HIT_PX;
  return !onBorder;
}

export function installBoxInterior(ws: VelaWorkspace): () => void {
  // Find the canvas element — may be multiple (one per pane), we attach to all
  const getCanvases = (): HTMLCanvasElement[] =>
    Array.from(document.querySelectorAll<HTMLCanvasElement>(".vela-cell canvas"));

  let attached: HTMLCanvasElement[] = [];

  const onPointerDown = (e: PointerEvent) => {
    // Only intercept when a box tool is active or a drawing is selected
    // We always check: if pointer is inside a box interior, prevent drag
    const boxes = getBoxDrawings(ws);
    if (!boxes.length) return;

    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    for (const box of boxes) {
      if (isInsideBoxInterior(px, py, box)) {
        // Stop Vela's capturing handler from starting a box drag
        e.stopImmediatePropagation();

        // Dispatch a synthetic pointercancel so any active drag state in Vela resets
        try {
          const cancel = new PointerEvent("pointercancel", {
            pointerId: e.pointerId,
            bubbles: true,
            cancelable: false,
          });
          canvas.dispatchEvent(cancel);
        } catch { /* ignore */ }

        // Re-fire the pointerdown WITHOUT capture flag so Vela's non-capturing
        // chart-pan listener receives it and normal panning begins
        try {
          const redispatch = new PointerEvent("pointerdown", {
            ...e,
            bubbles: true,
            cancelable: true,
            pointerId: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
            pointerType: e.pointerType,
            pressure: e.pressure,
          });
          // Small delay so the cancel settles first
          setTimeout(() => canvas.dispatchEvent(redispatch), 0);
        } catch { /* ignore */ }

        return;
      }
    }
  };

  const attach = () => {
    const canvases = getCanvases();
    for (const c of canvases) {
      if (!attached.includes(c)) {
        // capture: true puts us BEFORE Vela's own listener
        c.addEventListener("pointerdown", onPointerDown, { capture: true });
        attached.push(c);
      }
    }
  };

  // Initial attach + watch for new canvases (pane add/remove)
  attach();
  const mo = new MutationObserver(() => attach());
  const host = document.querySelector(".vela-host") ?? document.body;
  mo.observe(host, { childList: true, subtree: true });

  return () => {
    mo.disconnect();
    for (const c of attached) {
      c.removeEventListener("pointerdown", onPointerDown, { capture: true });
    }
    attached = [];
  };
}

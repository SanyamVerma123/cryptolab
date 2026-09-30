/**
 * drawingInteractions — Precision hit-testing and isolation for chart drawings.
 *
 * Solves:
 * 1. BOX (RECTANGLE) DRAWING BORDER-ONLY HIT-TEST:
 *    - Touching/clicking inside a box will NOT select or drag the box.
 *    - Tapping/dragging from inside the box pans the chart screen instead.
 *    - The box is only selected, moved, or resized by touching its BORDER or corner handles.
 *
 * 2. PRICE AXIS (Y-AXIS) & DATE AXIS (X-AXIS) DRAWING ISOLATION:
 *    - Drawings extending behind the Y-axis price bar or X-axis date bar NEVER
 *      intercept pointer/touch events.
 *    - Dragging the price axis rescales/compresses price without moving drawings.
 *    - Dragging the date axis scrolls/scales time without moving drawings.
 *
 * 3. OSCILLATOR INDICATOR PANES ISOLATION:
 *    - Drawings from the main candle chart extending behind oscillator indicator panes
 *      (e.g., RSI, MACD, Stochastic) are never functional or touched in those panes.
 *    - Dragging inside an oscillator pane pans the chart and does not disturb drawings.
 *
 * Works seamlessly across both Android devices (touch) and Windows (mouse/pointer).
 */

import { getDrawingType } from "@luxalgo/vela";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

/** Euclidean distance from point (px, py) to segment (ax, ay)-(bx, by) */
function distToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 <= 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

let boxPatched = false;

/**
 * Patch Box and RotatedRect hit-testing so only the border is interactive.
 * Clicking/tapping/dragging inside the box returns false, allowing the chart
 * pan handler to navigate the screen naturally.
 */
export function patchBoxHitTest(): void {
  if (boxPatched) return;
  try {
    const boxMeta = getDrawingType("box");
    if (boxMeta) {
      const dummy = boxMeta.create({ paneId: "price", anchors: [] } as any);
      const BoxClass = dummy?.constructor as any;
      if (BoxClass && BoxClass.prototype) {
        BoxClass.prototype.hitTest = function (
          px: number,
          py: number,
          proj: any,
          tol: number = 6
        ): boolean {
          const r = this.rect(proj);
          if (!r) return false;

          // BORDER ONLY: Do NOT check pointInBox.
          // This allows users on Android and Windows to pan the screen by touching
          // anywhere inside the box without moving or breaking the box setup.
          const effectiveTol = Math.max(tol || 6, 8); // 8px tolerance for smooth touch & mouse interaction
          const edges: [number, number, number, number][] = [
            [r.x1, r.y1, r.x2, r.y1],
            [r.x2, r.y1, r.x2, r.y2],
            [r.x2, r.y2, r.x1, r.y2],
            [r.x1, r.y2, r.x1, r.y1],
          ];
          return edges.some(
            (e) => distToSegment(px, py, e[0], e[1], e[2], e[3]) <= effectiveTol
          );
        };
      }
    }

    const rotatedMeta = getDrawingType("rotatedrect");
    if (rotatedMeta) {
      const dummy = rotatedMeta.create({ paneId: "price", anchors: [] } as any);
      const RotatedClass = dummy?.constructor as any;
      if (RotatedClass && RotatedClass.prototype) {
        RotatedClass.prototype.hitTest = function (
          px: number,
          py: number,
          proj: any,
          tol: number = 6
        ): boolean {
          const g = this.geometry(proj);
          if (!g || !Array.isArray(g.segments)) return false;
          // Border segments only — ignore interior fill polygon
          const effectiveTol = Math.max(tol || 6, 8);
          return g.segments.some(
            (s: [number, number, number, number]) =>
              distToSegment(px, py, s[0], s[1], s[2], s[3]) <= effectiveTol
          );
        };
      }
    }

    boxPatched = true;
  } catch (e) {
    console.warn("[trade-pro] patchBoxHitTest failed:", e);
  }
}

/** Check if coordinates (x, y) fall on the price axis or time axis strips */
function isAxisZone(x: number, y: number, proj: any, coords: any): boolean {
  const w = proj?.width ?? coords?.width ?? 0;
  const h = proj?.height ?? coords?.height ?? 0;
  if (w > 0 && x >= w - 1) return true; // Price bar (Y-axis)
  if (h > 0 && y >= h - 1) return true; // Time/date bar (X-axis)
  if (x < 0 || y < 0) return true;
  return false;
}

/**
 * Safely find the topmost drawing at (x, y), strictly enforcing pane isolation
 * and axis isolation.
 */
function safeTopDrawingAt(
  drawings: any[],
  x: number,
  y: number,
  proj: any,
  coords: any,
  tol: number = 6
): any {
  if (!drawings || !drawings.length || !proj) return null;
  if (isAxisZone(x, y, proj, coords)) return null;

  const currentPaneId = proj.paneIdAtY ? proj.paneIdAtY(y) : "price";

  for (let i = drawings.length - 1; i >= 0; i -= 1) {
    const d = drawings[i];
    if (!d || !d.visible) continue;

    // OSCILLATOR PANE ISOLATION:
    // If pointer is inside an oscillator pane, drawings belonging to the main price pane
    // (or any other pane) must NEVER be touched or functional!
    if (d.paneId && currentPaneId && d.paneId !== currentPaneId) {
      continue;
    }

    // Check pane vertical bounds: y must be strictly inside the drawing's pane
    const rect = proj.paneRect?.(d.paneId ?? currentPaneId);
    if (rect) {
      if (rect.height <= 0) continue;
      if (y < rect.top || y > rect.top + rect.height) continue;
    }

    if (d.hitTest && d.hitTest(x, y, proj, tol)) {
      return d;
    }
  }

  return null;
}

/**
 * Install Drawing Isolation on a Vela workspace.
 *
 * Guarantees that:
 * 1. Price Bar (Y-axis) drag/scale is never intercepted by drawings behind it.
 * 2. Date Bar (X-axis) drag/scroll is never intercepted by drawings behind it.
 * 3. Oscillator indicator panes (RSI, MACD, etc.) never trigger drawings behind them.
 * 4. Box drawings are only functional on their borders.
 */
export function installDrawingIsolation(ws: VelaWorkspace): () => void {
  // Ensure Box hit-testing is patched
  patchBoxHitTest();

  try {
    const renderer = (ws.chart as any)?.renderer;
    if (!renderer) return () => {};

    const userDrawings = renderer.userDrawings;
    const interaction = userDrawings?.interaction;
    const coords = renderer.coords;

    if (!userDrawings || !interaction) return () => {};

    const origInteractionHitAt = interaction.hitAt;
    const origInteractionClaim = interaction.claim;
    const origUserDrawingsClaim = userDrawings.claim;
    const origUserDrawingsUpdateHover = userDrawings.updateHover;
    const origUserDrawingsDeleteAt = userDrawings.deleteAt;

    // 1. Patch interaction.hitAt
    interaction.hitAt = function (x: number, y: number) {
      const proj = this.deps.projector();
      if (!proj) return null;

      // Axis isolation
      if (isAxisZone(x, y, proj, coords)) return null;

      const currentPaneId = proj.paneIdAtY ? proj.paneIdAtY(y) : "price";

      // Check handle drawings (selected/hovered) with strict pane isolation
      if (typeof this.handleDrawings === "function") {
        for (const d of this.handleDrawings()) {
          if (!d) continue;
          if (d.paneId && currentPaneId && d.paneId !== currentPaneId) continue;

          const r = proj.paneRect?.(d.paneId ?? currentPaneId);
          if (r && r.height > 0) {
            if (y < r.top || y > r.top + r.height) continue;
          }

          if (d.hitHandle && d.hitHandle(x, y, proj, 6) >= 0) return d;
        }
      }

      return safeTopDrawingAt(this.deps.drawings(), x, y, proj, coords, 6);
    };

    // 2. Patch interaction.claim
    interaction.claim = function (x: number, y: number): boolean {
      const proj = this.deps.projector();
      // Axis isolation: drawings NEVER claim pointer events in the price or time axis strips
      if (isAxisZone(x, y, proj, coords)) return false;

      // In-flight gesture: continue moving
      if (this.state && this.state.kind !== "idle") return true;

      // If active tool is armed:
      if (this.deps.activeTool() != null) {
        return true;
      }

      const hit = this.hitAt(x, y);
      if (!hit) return false;

      // KEY USER REQUIREMENT:
      // "Can you make that until i click or tap on any drawing, it will not active for atteration or changes.
      // Like sumtimes i move the screen by click and move finger or mouse the drawing is also moving so make until i fist click or tap then it will ativate to move."
      //
      // An unselected drawing does NOT claim pointerdown. This allows any press & drag
      // over an unselected drawing to PAN THE SCREEN smoothly instead of dragging the drawing!
      // Only when a drawing is ALREADY SELECTED (or its handles are touched) does it claim the drag.
      const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
      const isSelected = selected.has(hit.id);
      const isHandle = typeof hit.hitHandle === "function" && hit.hitHandle(x, y, proj, 6) >= 0;

      return isSelected || isHandle;
    };

    // 3. Patch userDrawings.claim
    userDrawings.claim = function (x: number, y: number): boolean {
      const proj = this.deps?.projector ? this.deps.projector() : renderer.drawingProjector?.();
      if (isAxisZone(x, y, proj, coords)) return false;

      if (this.measureMode || this.eraserMode) return true;
      if (typeof this.magnifierChipAt === "function" && this.magnifierChipAt(x, y)) return true;

      return this.interaction.claim(x, y);
    };

    // 4. Patch userDrawings.updateHover
    userDrawings.updateHover = function (x: number, y: number, mod: boolean = false) {
      const proj = this.deps?.projector ? this.deps.projector() : renderer.drawingProjector?.();
      if (isAxisZone(x, y, proj, coords)) {
        if (this.hoveredId !== null) {
          this.hoveredId = null;
          this.render();
        }
        return;
      }

      let id = null;
      if (
        !mod &&
        this.activeTool == null &&
        !this.interaction.isPlacing() &&
        !this.interaction.isDragging()
      ) {
        const hit = safeTopDrawingAt(this.drawings, x, y, proj, coords, 6);
        id = hit?.id ?? null;
      }

      if (id !== this.hoveredId) {
        this.hoveredId = id;
        this.render();
      }
    };

    // 5. Patch userDrawings.deleteAt
    if (typeof origUserDrawingsDeleteAt === "function") {
      userDrawings.deleteAt = function (x: number, y: number, withSelection: boolean = false) {
        const proj = this.deps?.projector ? this.deps.projector() : renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) return false;
        return origUserDrawingsDeleteAt.call(this, x, y, withSelection);
      };
    }

    // 6. Wrap input.deps.drawingsClaim for ultimate protection
    if (renderer.input?.deps?.drawingsClaim) {
      const origInputDrawingsClaim = renderer.input.deps.drawingsClaim;
      renderer.input.deps.drawingsClaim = (x: number, y: number): boolean => {
        const proj = renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) return false;
        return userDrawings.claim(x, y);
      };
    }

    // 7. Intercept input.deps.onClick so clicking/tapping an unselected drawing activates/selects it
    const origInputOnClick = renderer.input?.deps?.onClick;
    if (renderer.input?.deps) {
      renderer.input.deps.onClick = (x: number, y: number) => {
        const proj = renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) {
          origInputOnClick?.(x, y);
          return;
        }

        const hit = interaction.hitAt(x, y);
        if (hit) {
          // Single tap/click on an unselected drawing: ACTIVATE IT!
          // Now handles appear and the user can alter, drag, or resize it.
          if (typeof userDrawings.openSettingsById === "function") {
            userDrawings.openSettingsById(hit.id, x, y);
          } else if (typeof userDrawings.setSelection === "function") {
            userDrawings.setSelection([hit.id]);
          }
          return;
        }

        // Tap/click on empty chart space: deselect drawings
        origInputOnClick?.(x, y);
      };
    }

    return () => {
      try {
        interaction.hitAt = origInteractionHitAt;
        interaction.claim = origInteractionClaim;
        userDrawings.claim = origUserDrawingsClaim;
        userDrawings.updateHover = origUserDrawingsUpdateHover;
        if (origUserDrawingsDeleteAt) userDrawings.deleteAt = origUserDrawingsDeleteAt;
        if (origInputOnClick && renderer.input?.deps) renderer.input.deps.onClick = origInputOnClick;
      } catch {
        /* already destroyed */
      }
    };
  } catch (e) {
    console.warn("[trade-pro] installDrawingIsolation failed:", e);
    return () => {};
  }
}

// Immediately patch box hit-testing when module is loaded
patchBoxHitTest();


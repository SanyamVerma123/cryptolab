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
    const origInteractionDown = interaction.down;
    const origInteractionCursorAt = interaction.cursorAt;
    const origInteractionHandleDrawings = interaction.handleDrawings;
    const origUserDrawingsClaim = userDrawings.claim;
    const origUserDrawingsUpdateHover = userDrawings.updateHover;
    const origUserDrawingsDeleteAt = userDrawings.deleteAt;
    const origPainterPaintAll = userDrawings.painter?.paintAll;
    const origPainterPaintHighlights = userDrawings.painter?.paintHighlights;

    // 1. Lock userDrawings.hoveredId to ALWAYS be null.
    // Hovering must NEVER highlight drawings, set hover state, or paint hover handles.
    try {
      Object.defineProperty(userDrawings, "hoveredId", {
        get() {
          return null;
        },
        set(_val) {
          // Strictly ignore any attempt to store or set hoveredId
        },
        configurable: true,
      });
    } catch {
      userDrawings.hoveredId = null;
    }

    // 2. Patch userDrawings.painter.paintAll & paintHighlights:
    // Guarantees that only drawings that the user has explicitly tapped and released (selected)
    // can ever display handles on the canvas.
    if (userDrawings.painter) {
      if (typeof origPainterPaintAll === "function") {
        userDrawings.painter.paintAll = function (
          ctx: any,
          drawings: any[],
          proj: any,
          theme: any,
          targets: any = {}
        ) {
          const sanitizedTargets = {
            ...targets,
            hovered: null, // Zero out hover target
          };
          return origPainterPaintAll.call(this, ctx, drawings, proj, theme, sanitizedTargets);
        };
      }

      if (typeof origPainterPaintHighlights === "function") {
        userDrawings.painter.paintHighlights = function (
          ctx: any,
          drawings: any[],
          proj: any,
          handleIds: Set<string>
        ) {
          // Strictly filter handles to drawings currently in selectedIds
          const selected = userDrawings.selectedIds || new Set<string>();
          const strictHandleIds = new Set<string>();
          if (handleIds) {
            for (const id of handleIds) {
              if (selected.has(id)) {
                strictHandleIds.add(id);
              }
            }
          }
          return origPainterPaintHighlights.call(this, ctx, drawings, proj, strictHandleIds);
        };
      }
    }

    // 3. Patch interaction.handleDrawings:
    // Only return handles for drawings that are in selectedIds!
    interaction.handleDrawings = function () {
      const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
      const out: any[] = [];
      for (const id of selected) {
        const d = this.byId(id);
        if (d && !d.locked && d.visible) out.push(d);
      }
      return out;
    };

    // 4. Patch interaction.hitAt:
    // Only check handles on drawings that are ALREADY selected.
    interaction.hitAt = function (x: number, y: number) {
      const proj = this.deps.projector();
      if (!proj) return null;

      // Axis isolation: drawings never intercept pointer events in axis strips
      if (isAxisZone(x, y, proj, coords)) return null;

      const currentPaneId = proj.paneIdAtY ? proj.paneIdAtY(y) : "price";

      // Check handle drawings (STRICTLY SELECTED ONLY) with pane isolation
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

    // 5. Patch interaction.claim:
    // KEY REQUIREMENT:
    // "make it until i touch the drawing and tap on it and realease the drawing will not action and move.
    // Think in detail please and i want to make it on every drawings."
    //
    // A drawing CANNOT claim pointer events unless it was ALREADY selected by a prior tap-and-release!
    // Dragging over any drawing smoothly pans the chart screen.
    interaction.claim = function (x: number, y: number): boolean {
      const proj = this.deps.projector();
      if (isAxisZone(x, y, proj, coords)) return false;

      // If active tool is currently armed (drawing a new shape from toolbar):
      if (this.deps.activeTool() != null || this.state?.kind === "placing") {
        return true;
      }

      // In-flight gesture: only continue if state is ALREADY pressed or dragging an already-selected drawing
      if (this.state && this.state.kind !== "idle") {
        if (this.state.kind === "pressed") {
          const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
          if (!selected.has(this.state.id)) {
            this.state = { kind: "idle" };
            return false;
          }
        }
        return true;
      }

      const hit = this.hitAt(x, y);
      if (!hit) return false;

      // STRICT TAP-AND-RELEASE ACTIVATION:
      // If the drawing is NOT already selected, claim returns FALSE!
      // This routes the pointer event to chart pan (data region).
      const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
      return selected.has(hit.id);
    };

    // 6. Patch interaction.down:
    // Prevent unselected drawings from entering state = { kind: "pressed" }
    interaction.down = function (
      x: number,
      y: number,
      mode = "off",
      shift2 = false,
      mod = false
    ) {
      if (this.deps.activeTool() != null || this.state?.kind === "placing") {
        return origInteractionDown.call(this, x, y, mode, shift2, mod);
      }

      const hit = this.hitAt(x, y);
      if (hit) {
        const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
        // If the drawing is NOT selected, do not press or grab it!
        // Return immediately so this.state stays { kind: "idle" }.
        if (!selected.has(hit.id)) {
          return;
        }
      }

      return origInteractionDown.call(this, x, y, mode, shift2, mod);
    };

    // 7. Patch interaction.cursorAt:
    // Only show pointer/grab cursor if drawing is ALREADY selected or active tool is armed.
    interaction.cursorAt = function (x: number, y: number) {
      if (this.deps.activeTool() != null) return null;
      const hit = this.hitAt(x, y);
      if (!hit) return null;
      const selected = this.deps.selectedIds ? this.deps.selectedIds() : new Set<string>();
      if (selected.has(hit.id)) return "pointer";
      return null;
    };

    // 8. Patch userDrawings.claim
    userDrawings.claim = function (x: number, y: number): boolean {
      const proj = this.deps?.projector ? this.deps.projector() : renderer.drawingProjector?.();
      if (isAxisZone(x, y, proj, coords)) return false;

      if (this.measureMode || this.eraserMode) return true;
      if (typeof this.magnifierChipAt === "function" && this.magnifierChipAt(x, y)) return true;

      return this.interaction.claim(x, y);
    };

    // 9. Patch userDrawings.updateHover:
    // Never activate or highlight drawings on hover
    userDrawings.updateHover = function (_x: number, _y: number) {
      // No-op: hover is permanently disabled
    };

    // 10. Patch userDrawings.deleteAt
    if (typeof origUserDrawingsDeleteAt === "function") {
      userDrawings.deleteAt = function (x: number, y: number, withSelection: boolean = false) {
        const proj = this.deps?.projector ? this.deps.projector() : renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) return false;
        return origUserDrawingsDeleteAt.call(this, x, y, withSelection);
      };
    }

    // 11. Wrap input.deps.drawingsClaim for chart pan protection
    if (renderer.input?.deps?.drawingsClaim) {
      renderer.input.deps.drawingsClaim = (x: number, y: number): boolean => {
        const proj = renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) return false;
        return userDrawings.claim(x, y);
      };
    }

    // 12. Intercept input.deps.onClick:
    // A complete tap/click and release gesture (without drag) on a drawing activates it!
    const origInputOnClick = renderer.input?.deps?.onClick;
    if (renderer.input?.deps) {
      renderer.input.deps.onClick = (x: number, y: number) => {
        const proj = renderer.drawingProjector?.();
        if (isAxisZone(x, y, proj, coords)) {
          origInputOnClick?.(x, y);
          return;
        }

        const hit = safeTopDrawingAt(userDrawings.drawings, x, y, proj, coords, 8);
        if (hit) {
          // Touch, tap, and release: NOW the drawing becomes actionable!
          // Handles appear and settings toolbar opens:
          if (typeof userDrawings.setSelection === "function") {
            userDrawings.setSelection([hit.id]);
          }
          if (typeof userDrawings.openSettingsById === "function") {
            userDrawings.openSettingsById(hit.id, x, y);
          }
          userDrawings.render();
          return;
        }

        // Tap/click on empty chart space: deactivate all drawings
        if (typeof userDrawings.clearSelection === "function") {
          userDrawings.clearSelection();
        }
        userDrawings.popup?.close();
        userDrawings.render();
        origInputOnClick?.(x, y);
      };
    }

    return () => {
      try {
        interaction.hitAt = origInteractionHitAt;
        interaction.claim = origInteractionClaim;
        interaction.down = origInteractionDown;
        interaction.cursorAt = origInteractionCursorAt;
        interaction.handleDrawings = origInteractionHandleDrawings;
        userDrawings.claim = origUserDrawingsClaim;
        userDrawings.updateHover = origUserDrawingsUpdateHover;
        if (origUserDrawingsDeleteAt) userDrawings.deleteAt = origUserDrawingsDeleteAt;
        if (origInputOnClick && renderer.input?.deps) renderer.input.deps.onClick = origInputOnClick;
        if (origPainterPaintAll && userDrawings.painter) userDrawings.painter.paintAll = origPainterPaintAll;
        if (origPainterPaintHighlights && userDrawings.painter) userDrawings.painter.paintHighlights = origPainterPaintHighlights;
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


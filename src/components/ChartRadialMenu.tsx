import React, { useState, useEffect, useRef, useCallback } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";

interface RadialTool {
  id: string;
  type: string;
  label: string;
  shortLabel: string;
  svg: string;
}

const RADIAL_TOOLS: RadialTool[] = [
  {
    id: "hray",
    type: "hray",
    label: "Horizontal Ray",
    shortLabel: "Horizontal ...",
    svg: `<line x1="5" y1="12" x2="21" y2="12"/><circle cx="5" cy="12" r="1.6" fill="currentColor"/>`,
  },
  {
    id: "fibextension",
    type: "fibextension",
    label: "Fib Extension",
    shortLabel: "Fib Extension",
    svg: `<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="15" x2="14" y2="15"/><line x1="3" y1="20" x2="14" y2="20"/>`,
  },
  {
    id: "text",
    type: "text",
    label: "Text",
    shortLabel: "Text",
    svg: `<path d="M5 6h14M12 6v13"/>`,
  },
  {
    id: "freehand",
    type: "freehand",
    label: "Brush",
    shortLabel: "Brush",
    svg: `<path d="M9.5 12 17 4.5a2.12 2.12 0 0 1 3 3L12.5 15"/><path d="M7 14a3 3 0 0 0-3 3c0 1.3-1.2 1.5-1.5 2 .8.9 2 1.5 3.5 1.5a3.5 3.5 0 0 0 3.5-3.5 3 3 0 0 0-2.5-3Z"/>`,
  },
  {
    id: "xabcd",
    type: "xabcd",
    label: "XABCD Pattern",
    shortLabel: "XABCD Patt...",
    svg: `<path d="M3 18 7 8 11 14 15 6 20 16"/>`,
  },
  {
    id: "cursor",
    type: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
    svg: `<path d="m4 4 7 17 2.8-6.2L20 12Z"/>`,
  },
  {
    id: "abcd",
    type: "abcd",
    label: "ABCD Pattern",
    shortLabel: "ABCD Pattern",
    svg: `<path d="M4 17 9 7 14 15 20 5"/>`,
  },
  {
    id: "box",
    type: "box",
    label: "Rectangle",
    shortLabel: "Rectangle",
    svg: `<rect x="4" y="6" width="16" height="12" rx="1"/>`,
  },
  {
    id: "magnifier",
    type: "magnifier",
    label: "Magnifier",
    shortLabel: "Magnifier",
    svg: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.3 15.3 5.2 5.2"/><path d="M8 12.5v-3M10.5 13.5v-5.5M13 12v-2"/>`,
  },
];

interface Props {
  ws: VelaWorkspace | null;
}

export function ChartRadialMenu({ ws }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [center, setCenter] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [selectedIndex, setSelectedIndex] = useState<number>(6); // default to ABCD Pattern or middle
  const mousePos = useRef<{ x: number; y: number }>({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  const isOpenRef = useRef(false);
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  const R_IN = 70;
  const R_OUT = 185;
  const SIZE = 400;
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const NUM_SLICES = RADIAL_TOOLS.length;
  const SLICE_ANGLE = (2 * Math.PI) / NUM_SLICES;
  // Offset start angle so slice 0 is at 12 o'clock (top)
  const START_OFFSET = -Math.PI / 2 - SLICE_ANGLE / 2;

  // Track global mouse position
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };

      if (isOpenRef.current) {
        const dx = e.clientX - center.x;
        const dy = e.clientY - center.y;
        const dist = Math.hypot(dx, dy);

        if (dist > R_IN * 0.7) {
          let angle = Math.atan2(dy, dx) - START_OFFSET;
          while (angle < 0) angle += 2 * Math.PI;
          while (angle >= 2 * Math.PI) angle -= 2 * Math.PI;

          const idx = Math.floor(angle / SLICE_ANGLE) % NUM_SLICES;
          setSelectedIndex(idx);
        }
      }
    };

    window.addEventListener("mousemove", onMouseMove, { capture: true });
    return () => window.removeEventListener("mousemove", onMouseMove, { capture: true });
  }, [center]);

  // Arm chosen tool
  const armTool = useCallback(
    (tool: RadialTool) => {
      if (!ws) return;
      try {
        if (tool.type === "cursor") {
          ws.chart.drawings.setTool(null);
        } else {
          ws.chart.drawings.setTool(tool.type as never);
        }
      } catch (e) {
        console.warn("[radial menu] failed to set tool:", e);
      }
    },
    [ws]
  );

  // Listen for Alt keydown / keyup
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (!isOpenRef.current) {
          e.preventDefault();
          // Clamp center so wheel doesn't overflow viewport edges
          const pad = 210;
          const cx = Math.max(pad, Math.min(window.innerWidth - pad, mousePos.current.x));
          const cy = Math.max(pad, Math.min(window.innerHeight - pad, mousePos.current.y));
          setCenter({ x: cx, y: cy });
          setIsOpen(true);
          isOpenRef.current = true;
        }
      } else if (e.key === "Escape" && isOpenRef.current) {
        setIsOpen(false);
        isOpenRef.current = false;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        if (isOpenRef.current) {
          const tool = RADIAL_TOOLS[selectedIndexRef.current];
          if (tool) {
            armTool(tool);
          }
          setIsOpen(false);
          isOpenRef.current = false;
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  }, [armTool]);

  if (!isOpen) return null;

  const activeTool = RADIAL_TOOLS[selectedIndex] || RADIAL_TOOLS[0];

  // Helper to create donut wedge path
  const makeWedgePath = (index: number) => {
    const a1 = START_OFFSET + index * SLICE_ANGLE + 0.015;
    const a2 = START_OFFSET + (index + 1) * SLICE_ANGLE - 0.015;

    const x1Out = CX + R_OUT * Math.cos(a1);
    const y1Out = CY + R_OUT * Math.sin(a1);
    const x2Out = CX + R_OUT * Math.cos(a2);
    const y2Out = CY + R_OUT * Math.sin(a2);

    const x2In = CX + R_IN * Math.cos(a2);
    const y2In = CY + R_IN * Math.sin(a2);
    const x1In = CX + R_IN * Math.cos(a1);
    const y1In = CY + R_IN * Math.sin(a1);

    return `M ${x1Out} ${y1Out} A ${R_OUT} ${R_OUT} 0 0 1 ${x2Out} ${y2Out} L ${x2In} ${y2In} A ${R_IN} ${R_IN} 0 0 0 ${x1In} ${y1In} Z`;
  };

  return (
    <div
      className="radial-menu-backdrop"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        pointerEvents: "auto",
        userSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="radial-menu-container"
        style={{
          position: "absolute",
          left: `${center.x - CX}px`,
          top: `${center.y - CY}px`,
          width: `${SIZE}px`,
          height: `${SIZE}px`,
        }}
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          style={{ overflow: "visible", filter: "drop-shadow(0 12px 36px rgba(0, 0, 0, 0.75))" }}
        >
          {/* Wheel wedges */}
          {RADIAL_TOOLS.map((tool, idx) => {
            const isSelected = idx === selectedIndex;
            const midAngle = START_OFFSET + (idx + 0.5) * SLICE_ANGLE;
            const rMid = (R_IN + R_OUT) / 2;
            const iconX = CX + (rMid - 8) * Math.cos(midAngle);
            const iconY = CY + (rMid - 8) * Math.sin(midAngle);
            const textX = CX + (rMid + 16) * Math.cos(midAngle);
            const textY = CY + (rMid + 16) * Math.sin(midAngle);

            return (
              <g
                key={tool.id}
                className={`radial-slice ${isSelected ? "selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(idx)}
                onClick={() => {
                  armTool(tool);
                  setIsOpen(false);
                  isOpenRef.current = false;
                }}
                style={{ cursor: "pointer" }}
              >
                {/* Wedge background */}
                <path
                  d={makeWedgePath(idx)}
                  fill={isSelected ? "#2563eb" : "rgba(22, 26, 37, 0.94)"}
                  stroke={isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.08)"}
                  strokeWidth={isSelected ? 2 : 1}
                  style={{
                    transition: "fill 100ms ease, stroke 100ms ease",
                  }}
                />

                {/* Tool Icon */}
                <g
                  transform={`translate(${iconX - 11}, ${iconY - 11}) scale(0.9)`}
                  fill="none"
                  stroke={isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.75)"}
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  dangerouslySetInnerHTML={{ __html: tool.svg }}
                />

                {/* Tool Label */}
                <text
                  x={textX}
                  y={textY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={isSelected ? "#ffffff" : "rgba(255, 255, 255, 0.65)"}
                  fontSize="11"
                  fontWeight={isSelected ? 600 : 500}
                  letterSpacing="-0.2px"
                  style={{ pointerEvents: "none" }}
                >
                  {tool.shortLabel}
                </text>
              </g>
            );
          })}

          {/* Center Circle Ring */}
          <circle
            cx={CX}
            cy={CY}
            r={R_IN}
            fill="#12151d"
            stroke="#2563eb"
            strokeWidth="2.5"
            style={{ filter: "drop-shadow(0 0 10px rgba(37, 99, 235, 0.5))" }}
          />
        </svg>

        {/* Center Content overlay */}
        <div
          style={{
            position: "absolute",
            top: `${CY - R_IN + 10}px`,
            left: `${CX - R_IN + 10}px`,
            width: `${(R_IN - 10) * 2}px`,
            height: `${(R_IN - 10) * 2}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            pointerEvents: "none",
          }}
        >
          {/* ALT badge */}
          <div
            style={{
              padding: "2px 7px",
              background: "rgba(255, 255, 255, 0.12)",
              border: "1px solid rgba(255, 255, 255, 0.2)",
              borderRadius: "4px",
              fontSize: "10px",
              fontWeight: 700,
              color: "#e2e8f0",
              letterSpacing: "0.5px",
              marginBottom: "6px",
            }}
          >
            ALT
          </div>

          {/* Active Tool Label */}
          <div
            style={{
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 700,
              lineHeight: 1.2,
              padding: "0 6px",
              textShadow: "0 2px 4px rgba(0,0,0,0.8)",
            }}
          >
            {activeTool.label}
          </div>

          {/* Subtext: Release to arm */}
          <div
            style={{
              color: "rgba(255, 255, 255, 0.55)",
              fontSize: "10px",
              marginTop: "4px",
              letterSpacing: "0.2px",
            }}
          >
            Release to arm
          </div>
        </div>
      </div>
    </div>
  );
}

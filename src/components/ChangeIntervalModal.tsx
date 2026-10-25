import React, { useState, useEffect, useRef } from "react";
import type { VelaWorkspace } from "@luxalgo/vela/workspace";
import { getSafeActiveCell, getSafeActiveChart } from "../lib/workspaceSafe";

interface Props {
  ws: VelaWorkspace | null;
  currentTf?: string;
  onClose?: () => void;
}

type IntervalUnit = "minutes" | "hours" | "days" | "weeks" | "months";

const SUPPORTED_MINUTES = [1, 3, 5, 15, 30, 45, 60, 120, 180, 240, 360, 480, 720];

export function resolveTimeframe(rawInput: string, selectedUnit: IntervalUnit): string {
  const trimmed = rawInput.trim().toUpperCase();
  if (!trimmed) return "60";

  // Check explicit unit suffixes
  if (trimmed.endsWith("M") && !trimmed.endsWith("MO")) {
    const numPart = trimmed.slice(0, -1);
    if (/^\d+$/.test(numPart)) {
      const val = parseInt(numPart, 10);
      if (selectedUnit === "months") return "M";
      // otherwise treated as minutes
      return snapToSupportedMinutes(val);
    }
    if (trimmed === "M") return "M";
  }

  if (trimmed.endsWith("H")) {
    const numPart = trimmed.slice(0, -1);
    if (/^\d+$/.test(numPart)) {
      const hours = parseInt(numPart, 10);
      return snapToSupportedMinutes(hours * 60);
    }
  }

  if (trimmed.endsWith("D") || trimmed === "D") {
    return "D";
  }

  if (trimmed.endsWith("W") || trimmed === "W") {
    return "W";
  }

  if (trimmed.endsWith("MO") || trimmed === "MONTH") {
    return "M";
  }

  // Pure digits: apply selectedUnit
  if (/^\d+$/.test(trimmed)) {
    const val = parseInt(trimmed, 10);
    if (selectedUnit === "hours") {
      return snapToSupportedMinutes(val * 60);
    }
    if (selectedUnit === "days") {
      return "D";
    }
    if (selectedUnit === "weeks") {
      return "W";
    }
    if (selectedUnit === "months") {
      return "M";
    }
    // minutes default
    return snapToSupportedMinutes(val);
  }

  return "60";
}

function snapToSupportedMinutes(mins: number): string {
  if (SUPPORTED_MINUTES.includes(mins)) return String(mins);
  // Find closest supported minute timeframe
  let closest = SUPPORTED_MINUTES[0];
  let minDiff = Math.abs(mins - closest);
  for (const s of SUPPORTED_MINUTES) {
    const diff = Math.abs(mins - s);
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return String(closest);
}

const PRESET_PILLS: { label: string; tf: string; unit: IntervalUnit }[] = [
  { label: "1m", tf: "1", unit: "minutes" },
  { label: "3m", tf: "3", unit: "minutes" },
  { label: "5m", tf: "5", unit: "minutes" },
  { label: "15m", tf: "15", unit: "minutes" },
  { label: "30m", tf: "30", unit: "minutes" },
  { label: "45m", tf: "45", unit: "minutes" },
  { label: "1h", tf: "60", unit: "hours" },
  { label: "2h", tf: "120", unit: "hours" },
  { label: "4h", tf: "240", unit: "hours" },
  { label: "1D", tf: "D", unit: "days" },
  { label: "1W", tf: "W", unit: "weeks" },
  { label: "1M", tf: "M", unit: "months" },
];

export function ChangeIntervalModal({ ws, currentTf = "60", onClose }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState<IntervalUnit>("minutes");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleOpen = (e: CustomEvent<{ initialValue?: string }>) => {
      const initial = e.detail?.initialValue ?? "";
      setValue(initial);

      // Guess initial unit from input
      const upper = initial.toUpperCase();
      if (upper.includes("H")) setUnit("hours");
      else if (upper.includes("D")) setUnit("days");
      else if (upper.includes("W")) setUnit("weeks");
      else if (upper === "M") setUnit("months");
      else setUnit("minutes");

      setIsOpen(true);
    };

    window.addEventListener("tradepro:open-change-interval" as any, handleOpen);
    return () => window.removeEventListener("tradepro:open-change-interval" as any, handleOpen);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Focus and move cursor to end
      const timer = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          const len = inputRef.current.value.length;
          inputRef.current.setSelectionRange(len, len);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = () => {
    setIsOpen(false);
    onClose?.();
  };

  const applyTimeframe = (tfToApply: string) => {
    try {
      const cell = getSafeActiveCell(ws);
      const chart = getSafeActiveChart(ws);
      if (cell && typeof (cell as any).setTimeframe === "function") {
        (cell as any).setTimeframe(tfToApply);
      } else if (chart) {
        (chart as any).setMarket?.({ timeframe: tfToApply });
      }
    } catch (e) {
      console.warn("[trade-pro] could not set timeframe:", e);
    }

    window.dispatchEvent(
      new CustomEvent("tradepro:change-timeframe", { detail: { timeframe: tfToApply } })
    );

    handleClose();
  };

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!value.trim()) {
      handleClose();
      return;
    }
    const resolved = resolveTimeframe(value, unit);
    applyTimeframe(resolved);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="change-interval-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="change-interval-card" onKeyDown={handleKeyDown}>
        <div className="change-interval-header">
          <span className="change-interval-title">Change interval</span>
          <button
            type="button"
            className="change-interval-close"
            onClick={handleClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="change-interval-form">
          <div className="change-interval-input-row">
            <input
              ref={inputRef}
              type="text"
              className="change-interval-input"
              value={value}
              onChange={(e) => {
                const val = e.target.value;
                setValue(val);
                // Auto switch unit if typed letter
                const upper = val.toUpperCase();
                if (upper.endsWith("H")) setUnit("hours");
                else if (upper.endsWith("D")) setUnit("days");
                else if (upper.endsWith("W")) setUnit("weeks");
                else if (upper === "M") setUnit("months");
              }}
              placeholder="e.g. 5, 15, 60, 4h, 1D"
              autoComplete="off"
              spellCheck={false}
            />
            <select
              className="change-interval-select"
              value={unit}
              onChange={(e) => setUnit(e.target.value as IntervalUnit)}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months</option>
            </select>
          </div>

          <div className="change-interval-presets-label">Quick select</div>
          <div className="change-interval-presets">
            {PRESET_PILLS.map((p) => {
              const isActive = currentTf === p.tf;
              return (
                <button
                  key={p.tf}
                  type="button"
                  className={`change-interval-pill ${isActive ? "active" : ""}`}
                  onClick={() => applyTimeframe(p.tf)}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="change-interval-actions">
            <button
              type="button"
              className="change-interval-btn cancel"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button type="submit" className="change-interval-btn apply">
              OK
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

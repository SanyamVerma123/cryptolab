import { registerStatePersistence } from "@luxalgo/vela/plugin";

export interface ReplayDockPosition {
  leftRatio: number;
  topRatio: number;
}

let replayDockPosition: ReplayDockPosition | null = null;

function readPosition(value: unknown): ReplayDockPosition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ReplayDockPosition>;
  if (!Number.isFinite(candidate.leftRatio) || !Number.isFinite(candidate.topRatio)) return null;
  return {
    leftRatio: Math.max(0, Math.min(1, candidate.leftRatio!)),
    topRatio: Math.max(0, Math.min(1, candidate.topRatio!)),
  };
}

// Store dock placement in Vela's single versioned workspace document.
registerStatePersistence({
  key: "trade-pro.replay-dock",
  scope: "global",
  serialize: () => replayDockPosition ?? undefined,
  restore: (payload) => { replayDockPosition = readPosition(payload); },
});

export function getReplayDockPosition(): ReplayDockPosition | null {
  return replayDockPosition;
}

export function setReplayDockPosition(position: ReplayDockPosition | null): void {
  replayDockPosition = position ? readPosition(position) : null;
}

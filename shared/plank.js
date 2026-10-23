export const LANDMARK_COUNT = 33;

const LEFT = { shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28 };
const REQUIRED = ["shoulder", "elbow", "hip", "knee", "ankle"];

const MIN_VISIBILITY = 0.5;
const MAX_TILT_DEG = 35;
const MIN_HIP_DEG = 150;
const MIN_KNEE_DEG = 150;
const MIN_BODY_LENGTH = 0.25;

export function isValidFrame(frame) {
  if (!Array.isArray(frame) || frame.length !== LANDMARK_COUNT) return false;
  return frame.every(
    (p) =>
      Array.isArray(p) &&
      p.length === 3 &&
      p.every(Number.isFinite) &&
      p[0] >= -1 && p[0] <= 2 &&
      p[1] >= -1 && p[1] <= 2 &&
      p[2] >= 0 && p[2] <= 1,
  );
}

export function isValidAspect(aspect) {
  return Number.isFinite(aspect) && aspect >= 0.2 && aspect <= 5;
}

function sideScore(frame, side) {
  return Object.values(side).reduce((sum, i) => sum + frame[i][2], 0);
}

function point(frame, index, aspect) {
  const [x, y, v] = frame[index];
  return { x: x * aspect, y, v };
}

function angleAt(a, b, c) {
  const abx = a.x - b.x, aby = a.y - b.y;
  const cbx = c.x - b.x, cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180) / Math.PI;
}

function hipsAboveLine(shoulder, hip, ankle) {
  const t = (hip.x - shoulder.x) / (ankle.x - shoulder.x || 1e-6);
  const lineY = shoulder.y + t * (ankle.y - shoulder.y);
  return hip.y < lineY;
}

export function measurePlank(frame, aspect) {
  const side = sideScore(frame, LEFT) >= sideScore(frame, RIGHT) ? LEFT : RIGHT;
  const p = Object.fromEntries(Object.entries(side).map(([name, i]) => [name, point(frame, i, aspect)]));
  return {
    p,
    visibility: Math.min(...REQUIRED.map((name) => p[name].v)),
    length: Math.hypot(p.ankle.x - p.shoulder.x, p.ankle.y - p.shoulder.y),
    tilt: (Math.atan2(Math.abs(p.ankle.y - p.shoulder.y), Math.abs(p.ankle.x - p.shoulder.x)) * 180) / Math.PI,
    hip: angleAt(p.shoulder, p.hip, p.ankle),
    knee: angleAt(p.hip, p.knee, p.ankle),
  };
}

export function assessPlank(frame, aspect) {
  const m = measurePlank(frame, aspect);
  const { p } = m;
  if (m.visibility < MIN_VISIBILITY) return { ok: false, reason: "whole body not in frame" };
  if (m.length < MIN_BODY_LENGTH) return { ok: false, reason: "move closer to the camera" };
  if (m.tilt > MAX_TILT_DEG) return { ok: false, reason: "get horizontal" };
  if (m.hip < MIN_HIP_DEG) {
    return { ok: false, reason: hipsAboveLine(p.shoulder, p.hip, p.ankle) ? "hips too high" : "hips sagging" };
  }
  if (m.knee < MIN_KNEE_DEG) return { ok: false, reason: "knees down" };
  if (p.elbow.y <= p.shoulder.y) return { ok: false, reason: "arms under your shoulders" };
  return { ok: true, reason: "holding" };
}

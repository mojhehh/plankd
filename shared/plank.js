export const LANDMARK_COUNT = 33;

const SHOULDERS = [11, 12];
const ELBOWS = [13, 14];
const HIPS = [23, 24];
const KNEES = [25, 26];
const ANKLES = [27, 28];

const MIN_UPPER_VISIBILITY = 0.5;
const MIN_LEG_VISIBILITY = 0.15;
const MIN_SIZE = 0.2;
const MAX_TILT_DEG = 45;
const MIN_HIP_DEG = 145;
const MIN_KNEE_DEG = 140;

function inRange(value, low, high) {
  return Number.isFinite(value) && value >= low && value <= high;
}

export function isValidFrame(frame) {
  if (!Array.isArray(frame) || frame.length !== LANDMARK_COUNT) return false;
  return frame.every(
    (p) => Array.isArray(p) && p.length === 3 && inRange(p[0], -1, 2) && inRange(p[1], -1, 2) && inRange(p[2], 0, 1),
  );
}

export function isValidWorld(world) {
  if (!Array.isArray(world) || world.length !== LANDMARK_COUNT) return false;
  return world.every((p) => Array.isArray(p) && p.length === 3 && p.every((v) => inRange(v, -3, 3)));
}

export function isValidAspect(aspect) {
  return inRange(aspect, 0.2, 5);
}

function bestVisibility(frame, pair) {
  return Math.max(frame[pair[0]][2], frame[pair[1]][2]);
}

function mid(world, [a, b]) {
  return world[a].map((v, i) => (v + world[b][i]) / 2);
}

function sub(a, b) {
  return a.map((v, i) => v - b[i]);
}

function dot(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0);
}

function norm(a) {
  return Math.hypot(...a);
}

function angleAt(a, b, c) {
  const ab = sub(a, b);
  const cb = sub(c, b);
  const mag = norm(ab) * norm(cb);
  if (mag === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, dot(ab, cb) / mag))) * 180) / Math.PI;
}

function screenSize(frame, aspect) {
  const seen = frame.filter((p) => p[2] >= 0.3);
  if (seen.length < 2) return 0;
  const xs = seen.map((p) => p[0] * aspect);
  const ys = seen.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

export function measurePlank(frame, aspect, world) {
  const shoulder = mid(world, SHOULDERS);
  const elbow = mid(world, ELBOWS);
  const hip = mid(world, HIPS);
  const knee = mid(world, KNEES);
  const ankle = mid(world, ANKLES);
  const body = sub(ankle, shoulder);
  const t = dot(sub(hip, shoulder), body) / (dot(body, body) || 1e-6);
  const lineY = shoulder[1] + t * body[1];
  return {
    upper: Math.min(bestVisibility(frame, SHOULDERS), bestVisibility(frame, ELBOWS), bestVisibility(frame, HIPS)),
    legs: Math.max(bestVisibility(frame, KNEES), bestVisibility(frame, ANKLES)),
    size: screenSize(frame, aspect),
    tilt: (Math.asin(Math.min(1, Math.abs(body[1]) / (norm(body) || 1e-6))) * 180) / Math.PI,
    hip: angleAt(shoulder, hip, ankle),
    knee: angleAt(hip, knee, ankle),
    hipsLow: hip[1] > lineY,
    armsDown: elbow[1] > shoulder[1],
  };
}

export function assessPlank(frame, aspect, world) {
  const m = measurePlank(frame, aspect, world);
  if (m.upper < MIN_UPPER_VISIBILITY) return { ok: false, reason: "upper body not in frame" };
  if (m.legs < MIN_LEG_VISIBILITY) return { ok: false, reason: "legs not in frame" };
  if (m.size < MIN_SIZE) return { ok: false, reason: "move closer to the camera" };
  if (m.tilt > MAX_TILT_DEG) return { ok: false, reason: "get horizontal" };
  if (m.hip < MIN_HIP_DEG) return { ok: false, reason: m.hipsLow ? "hips sagging" : "hips too high" };
  if (m.knee < MIN_KNEE_DEG) return { ok: false, reason: "knees down" };
  if (!m.armsDown) return { ok: false, reason: "arms under your shoulders" };
  return { ok: true, reason: "holding" };
}

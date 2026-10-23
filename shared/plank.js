export const LANDMARK_COUNT = 33;

const SHOULDERS = [11, 12];
const ELBOWS = [13, 14];
const HIPS = [23, 24];
const KNEES = [25, 26];
const ANKLES = [27, 28];

const MIN_VISIBILITY = 0.5;
const MIN_SIZE = 0.2;
const MAX_FRONTAL_RATIO = 1.0;
const MAX_TORSO_TILT_DEG = 45;
const MAX_UPPER_ARM_DEG = 40;
const MIN_ARM_DROP_M = 0.07;
const MIN_HIP_LIFT_M = 0.04;
const MAX_KNEE_RISE_M = 0.15;
const MIN_THIGH_DEG = 140;
const MIN_KNEE_DEG = 120;
const PIKE_RISE_M = 0.12;
const PIKE_LINE_M = 0.1;
const PIKE_ABOVE_SHOULDERS_M = 0.05;

const PARTS = [
  ["shoulders", SHOULDERS],
  ["hips", HIPS],
  ["knees", KNEES],
];

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

function tiltOf(vector) {
  return (Math.asin(Math.min(1, Math.abs(vector[1]) / (norm(vector) || 1e-6))) * 180) / Math.PI;
}

function frontalRatio(frame, aspect) {
  const width = Math.abs(frame[11][0] - frame[12][0]) * aspect;
  const torsoX = ((frame[23][0] + frame[24][0]) / 2 - (frame[11][0] + frame[12][0]) / 2) * aspect;
  const torsoY = (frame[23][1] + frame[24][1]) / 2 - (frame[11][1] + frame[12][1]) / 2;
  return width / (Math.hypot(torsoX, torsoY) || 1e-6);
}

function screenSize(frame, aspect) {
  const seen = frame.filter((p) => p[2] >= 0.3);
  if (seen.length < 2) return 0;
  const xs = seen.map((p) => p[0] * aspect);
  const ys = seen.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function framingProblem(frame) {
  for (const [label, pair] of PARTS) {
    if (bestVisibility(frame, pair) >= MIN_VISIBILITY) continue;
    const x = (frame[pair[0]][0] + frame[pair[1]][0]) / 2;
    const y = (frame[pair[0]][1] + frame[pair[1]][1]) / 2;
    if (y > 1) return `${label} below the picture, tilt the phone down`;
    if (y < 0) return `${label} above the picture, tilt the phone up`;
    if (x < 0 || x > 1) return `${label} cut off, move the phone back`;
    return `can't see your ${label} clearly`;
  }
  return null;
}

export function measurePlank(frame, aspect, world) {
  const shoulder = mid(world, SHOULDERS);
  const elbow = mid(world, ELBOWS);
  const hip = mid(world, HIPS);
  const knee = mid(world, KNEES);
  const ankle = mid(world, ANKLES);
  const thighLine = sub(knee, shoulder);
  const t = dot(sub(hip, shoulder), thighLine) / (dot(thighLine, thighLine) || 1e-6);
  const upperArm = sub(elbow, shoulder);
  return {
    framing: framingProblem(frame),
    ankles: bestVisibility(frame, ANKLES),
    size: screenSize(frame, aspect),
    frontal: frontalRatio(frame, aspect),
    torsoTilt: tiltOf(sub(hip, shoulder)),
    upperArmFromVertical: (Math.acos(Math.max(-1, Math.min(1, upperArm[1] / (norm(upperArm) || 1e-6)))) * 180) / Math.PI,
    armDrop: elbow[1] - shoulder[1],
    hipLift: elbow[1] - hip[1],
    kneeRise: Math.min(hip[1], shoulder[1]) - knee[1],
    kneeAboveAnkle: ankle[1] - knee[1],
    thigh: angleAt(shoulder, hip, knee),
    knee: angleAt(hip, knee, ankle),
    hipsLow: hip[1] > shoulder[1] + t * thighLine[1],
    hipAboveLine: shoulder[1] + t * thighLine[1] - hip[1],
    hipAboveShoulders: shoulder[1] - hip[1],
    hipsHigh: hip[1] < shoulder[1] - PIKE_RISE_M,
  };
}

export function assessPlank(frame, aspect, world) {
  const m = measurePlank(frame, aspect, world);
  if (m.framing) return { ok: false, reason: m.framing };
  if (m.size < MIN_SIZE) return { ok: false, reason: "move closer to the camera" };
  if (m.frontal > MAX_FRONTAL_RATIO) return { ok: false, reason: "move the phone more to your side" };
  if (m.torsoTilt > MAX_TORSO_TILT_DEG) return { ok: false, reason: "get horizontal" };
  if (m.armDrop < MIN_ARM_DROP_M || m.upperArmFromVertical > MAX_UPPER_ARM_DEG) {
    return { ok: false, reason: "get up on your elbows or hands" };
  }
  if (m.kneeRise > MAX_KNEE_RISE_M) return { ok: false, reason: "legs down" };
  if (m.hipAboveLine > PIKE_LINE_M && m.hipAboveShoulders > PIKE_ABOVE_SHOULDERS_M) return { ok: false, reason: "hips too high" };
  if (m.thigh < MIN_THIGH_DEG) {
    if (m.hipsLow) return { ok: false, reason: "hips sagging" };
    return { ok: false, reason: m.hipsHigh ? "hips too high" : "knees down" };
  }
  if (m.ankles >= MIN_VISIBILITY && m.knee < MIN_KNEE_DEG) return { ok: false, reason: "knees down" };
  if (m.hipLift < MIN_HIP_LIFT_M) return { ok: false, reason: "lift your hips off the floor" };
  return { ok: true, reason: "holding" };
}

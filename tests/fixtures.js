import { LANDMARK_COUNT } from "../shared/plank.js";

export const ASPECT = 16 / 9;

const PLANK = {
  nose: [-0.85, -0.05],
  shoulder: [-0.6, -0.05],
  elbow: [-0.6, 0.25],
  wrist: [-0.5, 0.3],
  hip: [0, 0],
  knee: [0.45, 0.03],
  ankle: [0.9, 0.06],
};

const STANDING = {
  nose: [0, -0.75],
  shoulder: [0, -0.5],
  elbow: [0, -0.2],
  wrist: [0, 0.05],
  hip: [0, 0],
  knee: [0, 0.45],
  ankle: [0, 0.9],
};

const JOINTS = {
  nose: [0],
  shoulder: [11, 12],
  elbow: [13, 14],
  wrist: [15, 16],
  hip: [23, 24],
  knee: [25, 26],
  ankle: [27, 28],
};

export function plankPose({ view = "side", standing = false, bend = {}, place = {}, visibility = {}, scale = 1, jitter = 0 } = {}) {
  const base = { ...(standing ? STANDING : PLANK), ...place };
  const world = Array.from({ length: LANDMARK_COUNT }, () => [0, 0, 0]);
  const frame = Array.from({ length: LANDMARK_COUNT }, () => [0.5, 0.5, 0.2]);
  for (const [name, indices] of Object.entries(JOINTS)) {
    const [along, height] = base[name];
    const y = height + (bend[name] ?? 0);
    indices.forEach((index, n) => {
      const across = indices.length === 1 ? 0 : n === 0 ? -0.18 : 0.18;
      world[index] = view === "side" ? [along, y, across] : [across, y, along];
      const [sx, sy] = view === "side" ? [along, y] : [across, y];
      const zoom = (view === "side" ? 0.4 : 0.6) * scale;
      frame[index] = [0.5 + sx * zoom / ASPECT + jitter, 0.5 + sy * zoom + jitter, visibility[name] ?? 0.95];
    });
  }
  return { frame, world };
}

export function fakeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => (now += ms),
  };
}

export function fakePlayer(name) {
  const sent = [];
  return {
    name,
    sent,
    send: (msg) => sent.push(msg),
    last: (t) => sent.findLast((m) => m.t === t),
  };
}

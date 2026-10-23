import { LANDMARK_COUNT } from "../shared/plank.js";

export const ASPECT = 16 / 9;

const PLANK = {
  11: [0.3, 0.5],
  13: [0.3, 0.65],
  15: [0.38, 0.66],
  23: [0.5, 0.52],
  25: [0.62, 0.535],
  27: [0.75, 0.55],
};

export function plankFrame(overrides = {}, jitter = 0) {
  const points = { ...PLANK, ...overrides };
  return Array.from({ length: LANDMARK_COUNT }, (_, i) => {
    const [x, y] = points[i] ?? [0.2, 0.5];
    return [x + jitter, y + jitter, i in points ? 0.95 : 0.2];
  });
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

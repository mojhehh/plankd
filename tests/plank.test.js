import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPlank, isValidAspect, isValidFrame, isValidWorld } from "../shared/plank.js";
import { ASPECT, plankPose } from "./fixtures.js";

function reason(options) {
  const { frame, world } = plankPose(options);
  return assessPlank(frame, ASPECT, world).reason;
}

function reasonFor(edit) {
  const { frame, world } = plankPose();
  edit(frame);
  return assessPlank(frame, ASPECT, world).reason;
}

const LYING_FLAT = { shoulder: [-0.6, 0], elbow: [-0.9, 0.02], wrist: [-1.1, 0.03], hip: [0, 0], knee: [0.45, 0], ankle: [0.9, 0] };
const SPHINX = { shoulder: [-0.6, -0.25], elbow: [-0.6, 0], wrist: [-0.35, 0.02], hip: [0, 0], knee: [0.45, 0], ankle: [0.9, 0] };

test("a straight plank filmed from the side holds", () => {
  assert.equal(reason(), "holding");
});

test("a straight-arm plank holds", () => {
  assert.equal(reason({ place: { elbow: [-0.6, 0.12], wrist: [-0.6, 0.3] } }), "holding");
});

test("feet out of frame are fine", () => {
  assert.equal(reason({ visibility: { ankle: 0.05 } }), "holding");
});

test("a camera facing the player asks to move to the side", () => {
  assert.equal(reason({ view: "front" }), "move the phone more to your side");
});

test("lying flat on the floor fails", () => {
  assert.equal(reason({ place: LYING_FLAT }), "get up on your elbows or hands");
});

test("propped on the elbows with hips on the floor fails", () => {
  assert.equal(reason({ place: SPHINX }), "lift your hips off the floor");
});

test("throwing the legs up fails", () => {
  assert.equal(reason({ place: { knee: [0.3, -0.35], ankle: [0.5, -0.7] } }), "legs down");
});

test("sagging hips fail", () => {
  assert.equal(reason({ bend: { hip: 0.3 } }), "hips sagging");
});

test("piked hips fail", () => {
  assert.equal(reason({ bend: { hip: -0.35 } }), "hips too high");
});

test("knees on the floor fail, with or without the feet in view", () => {
  assert.equal(reason({ bend: { knee: 0.35 } }), "knees down");
  assert.equal(reason({ place: { knee: [0.1, 0.45], ankle: [0.55, 0.45] } }), "knees down");
  assert.equal(reason({ place: { knee: [0.1, 0.45] }, visibility: { ankle: 0.05 } }), "knees down");
});

test("standing up fails", () => {
  assert.equal(reason({ standing: true }), "get horizontal");
});

test("framing hints say what is missing and how to fix it", () => {
  const set = (frame, indices, point) => indices.forEach((i) => (frame[i] = [...point]));
  assert.equal(reasonFor((f) => set(f, [23, 24], [0.5, 1.2, 0.1])), "hips below the picture, tilt the phone down");
  assert.equal(reasonFor((f) => set(f, [11, 12], [0.3, -0.1, 0.1])), "shoulders above the picture, tilt the phone up");
  assert.equal(reasonFor((f) => set(f, [25, 26], [1.1, 0.6, 0.1])), "knees cut off, move the phone back");
  assert.equal(reasonFor((f) => set(f, [25, 26], [0.7, 0.6, 0.2])), "can't see your knees clearly");
});

test("a body too far away fails", () => {
  assert.equal(reason({ scale: 0.2 }), "move closer to the camera");
});

test("validation rejects malformed input", () => {
  const { frame, world } = plankPose();
  assert.equal(isValidFrame(frame), true);
  assert.equal(isValidWorld(world), true);
  assert.equal(isValidFrame(frame.slice(1)), false);
  assert.equal(isValidWorld(world.slice(1)), false);
  assert.equal(isValidFrame("nope"), false);
  assert.equal(isValidWorld(null), false);
  const bad = plankPose().frame;
  bad[3] = [0.5, Number.NaN, 0.9];
  assert.equal(isValidFrame(bad), false);
  bad[3] = [5, 0.5, 0.9];
  assert.equal(isValidFrame(bad), false);
  const farWorld = plankPose().world;
  farWorld[0] = [9, 0, 0];
  assert.equal(isValidWorld(farWorld), false);
  assert.equal(isValidAspect(16 / 9), true);
  assert.equal(isValidAspect(0), false);
  assert.equal(isValidAspect(Infinity), false);
});

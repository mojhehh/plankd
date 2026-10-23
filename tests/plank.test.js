import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPlank, isValidAspect, isValidFrame, isValidWorld } from "../shared/plank.js";
import { ASPECT, plankPose } from "./fixtures.js";

function reason(options) {
  const { frame, world } = plankPose(options);
  return assessPlank(frame, ASPECT, world).reason;
}

test("a straight plank filmed from the side holds", () => {
  assert.equal(reason({ view: "side" }), "holding");
});

test("a plank filmed head-on holds", () => {
  assert.equal(reason({ view: "front" }), "holding");
});

test("head-on, legs are not judged, so a kneel passes in casual mode", () => {
  assert.equal(reason({ view: "front", place: { knee: [0.1, 0.45], ankle: [0.55, 0.45] } }), "holding");
  assert.equal(reason({ view: "front", bend: { knee: 0.35 } }), "holding");
});

test("standing up fails head-on too", () => {
  assert.equal(reason({ view: "front", standing: true }), "get horizontal");
});

test("sagging hips fail", () => {
  assert.equal(reason({ bend: { hip: 0.3 } }), "hips sagging");
});

test("piked hips fail", () => {
  assert.equal(reason({ bend: { hip: -0.35 } }), "hips too high");
});

test("knees on the floor fail", () => {
  assert.equal(reason({ bend: { knee: 0.35 } }), "knees down");
  assert.equal(reason({ place: { knee: [0.1, 0.45], ankle: [0.55, 0.45] } }), "knees down");
});

test("legs the model folds toward the head are skipped instead of failing", () => {
  assert.equal(reason({ place: { knee: [-0.35, 0.2], ankle: [-0.15, 0.3] } }), "holding");
});

test("feet out of frame are fine as long as the knees show", () => {
  assert.equal(reason({ visibility: { ankle: 0.05 } }), "holding");
  assert.equal(reason({ visibility: { ankle: 0.05 }, place: { knee: [0.1, 0.45] } }), "knees down");
});

test("standing up fails", () => {
  assert.equal(reason({ standing: true }), "get horizontal");
});

test("arms above the shoulders fail", () => {
  assert.equal(reason({ bend: { elbow: -0.6 } }), "arms under your shoulders");
});

test("legs fully out of frame still hold", () => {
  assert.equal(reason({ visibility: { knee: 0.1, ankle: 0.1 } }), "holding");
});

test("hidden shoulders fail", () => {
  assert.equal(reason({ visibility: { shoulder: 0.2 } }), "shoulders and hips not in frame");
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

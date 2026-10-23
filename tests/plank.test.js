import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPlank, isValidAspect, isValidFrame, isValidWorld } from "../shared/plank.js";
import { ASPECT, plankPose } from "./fixtures.js";

function reason(options) {
  const { frame, world } = plankPose(options);
  return assessPlank(frame, ASPECT, world).reason;
}

test("a straight plank holds filmed from the side", () => {
  assert.equal(reason({ view: "side" }), "holding");
});

test("a straight plank holds filmed head-on", () => {
  assert.equal(reason({ view: "front" }), "holding");
});

test("head-on with the legs half hidden behind the body still holds", () => {
  assert.equal(reason({ view: "front", visibility: { knee: 0.3, ankle: 0.2 } }), "holding");
});

for (const view of ["side", "front"]) {
  test(`sagging hips fail (${view})`, () => {
    assert.equal(reason({ view, bend: { hip: 0.3 } }), "hips sagging");
  });

  test(`piked hips fail (${view})`, () => {
    assert.equal(reason({ view, bend: { hip: -0.35 } }), "hips too high");
  });

  test(`knees on the floor fail (${view})`, () => {
    assert.equal(reason({ view, bend: { knee: 0.35 } }), "knees down");
  });

  test(`standing up fails (${view})`, () => {
    assert.equal(reason({ view, standing: true }), "get horizontal");
  });
}

test("arms above the shoulders fail", () => {
  assert.equal(reason({ bend: { elbow: -0.6 } }), "arms under your shoulders");
});

test("no legs visible at all fails", () => {
  assert.equal(reason({ view: "front", visibility: { knee: 0.05, ankle: 0.05 } }), "legs not in frame");
});

test("hidden shoulders fail", () => {
  assert.equal(reason({ visibility: { shoulder: 0.2 } }), "upper body not in frame");
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

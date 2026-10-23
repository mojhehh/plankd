import assert from "node:assert/strict";
import { test } from "node:test";
import { assessPlank, isValidAspect, isValidFrame } from "../shared/plank.js";
import { ASPECT, plankFrame } from "./fixtures.js";

test("a straight side-on plank holds", () => {
  assert.deepEqual(assessPlank(plankFrame(), ASPECT), { ok: true, reason: "holding" });
});

test("sagging hips fail", () => {
  assert.equal(assessPlank(plankFrame({ 23: [0.5, 0.66] }), ASPECT).reason, "hips sagging");
});

test("piked hips fail", () => {
  assert.equal(assessPlank(plankFrame({ 23: [0.5, 0.36] }), ASPECT).reason, "hips too high");
});

test("knees on the floor fail", () => {
  assert.equal(assessPlank(plankFrame({ 25: [0.6, 0.66], 27: [0.75, 0.55] }), ASPECT).reason, "knees down");
});

test("standing up fails", () => {
  const standing = plankFrame({ 11: [0.5, 0.2], 13: [0.52, 0.35], 23: [0.5, 0.5], 25: [0.5, 0.7], 27: [0.5, 0.9] });
  assert.equal(assessPlank(standing, ASPECT).reason, "get horizontal");
});

test("a body too far away fails", () => {
  const tiny = plankFrame({ 11: [0.45, 0.5], 13: [0.45, 0.52], 23: [0.5, 0.505], 25: [0.53, 0.507], 27: [0.56, 0.51] });
  assert.equal(assessPlank(tiny, ASPECT).reason, "move closer to the camera");
});

test("hidden landmarks fail", () => {
  const frame = plankFrame();
  frame[27][2] = 0.1;
  frame[28][2] = 0.1;
  assert.equal(assessPlank(frame, ASPECT).reason, "whole body not in frame");
});

test("frame validation rejects malformed input", () => {
  assert.equal(isValidFrame(plankFrame()), true);
  assert.equal(isValidFrame(plankFrame().slice(1)), false);
  assert.equal(isValidFrame("nope"), false);
  const bad = plankFrame();
  bad[3] = [0.5, Number.NaN, 0.9];
  assert.equal(isValidFrame(bad), false);
  bad[3] = [5, 0.5, 0.9];
  assert.equal(isValidFrame(bad), false);
  assert.equal(isValidAspect(16 / 9), true);
  assert.equal(isValidAspect(0), false);
  assert.equal(isValidAspect(Infinity), false);
});

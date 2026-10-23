import assert from "node:assert/strict";
import { test } from "node:test";
import { COUNTDOWN_MS, FROZEN_FRAMES, GRACE_MS, Match, SILENCE_MS } from "../server/match.js";
import { ASPECT, fakeClock, fakePlayer, plankPose } from "./fixtures.js";

function setup() {
  const clock = fakeClock();
  const a = fakePlayer("alice");
  const b = fakePlayer("bob");
  const ended = [];
  const match = new Match(
    [
      { player: a, identity: "id_a", token: "tok_a" },
      { player: b, identity: "id_b", token: "tok_b" },
    ],
    { room: "room1", livekitUrl: "ws://lk", onEnd: (m, results) => ended.push(results), clock: clock.now, autoTick: false },
  );
  let jitter = 0;
  const step = (ms, frames = {}) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(100);
      jitter = jitter === 0 ? 0.001 : 0;
      for (const [identity, pose] of Object.entries(frames)) {
        const { frame, world } = typeof pose === "function" ? pose(jitter) : pose;
        match.judgePose(identity, frame, ASPECT, world);
      }
      match.tick();
    }
  };
  return { clock, a, b, match, ended, step };
}

const planking = (jitter) => plankPose({ jitter });
const sagging = (jitter) => plankPose({ bend: { hip: 0.3 }, jitter });

function startLive(ctx) {
  ctx.step(200, { id_a: planking, id_b: planking });
  assert.equal(ctx.match.ready(ctx.a), null);
  assert.equal(ctx.match.ready(ctx.b), null);
  assert.equal(ctx.match.phase, "countdown");
  ctx.step(COUNTDOWN_MS, { id_a: planking, id_b: planking });
  assert.equal(ctx.match.phase, "live");
}

test("both players get a token for the room", () => {
  const { a, b } = setup();
  assert.equal(a.last("matched").token, "tok_a");
  assert.equal(b.last("matched").opponent, "alice");
});

test("ready is refused until the judge sees the camera", () => {
  const ctx = setup();
  assert.match(ctx.match.ready(ctx.a), /can't see your camera/);
  assert.equal(ctx.match.phase, "connecting");
});

test("the player who drops loses after the grace period", () => {
  const ctx = setup();
  startLive(ctx);
  ctx.step(5_000, { id_a: planking, id_b: planking });
  assert.equal(ctx.match.phase, "live");
  ctx.step(GRACE_MS + 300, { id_a: planking, id_b: sagging });
  assert.equal(ctx.match.phase, "done");
  assert.equal(ctx.a.last("result").outcome, "win");
  assert.equal(ctx.b.last("result").outcome, "loss");
  assert.equal(ctx.b.last("result").yourReason, "hips sagging");
  const [results] = ctx.ended;
  assert.ok(results[1].holdMs >= 5_000 && results[1].holdMs < 5_300);
});

test("a short wobble inside the grace period is forgiven", () => {
  const ctx = setup();
  startLive(ctx);
  ctx.step(1_000, { id_a: planking, id_b: sagging });
  ctx.step(5_000, { id_a: planking, id_b: planking });
  assert.equal(ctx.match.phase, "live");
});

test("a frozen feed is treated as a drop", () => {
  const ctx = setup();
  startLive(ctx);
  const still = plankPose();
  ctx.step((FROZEN_FRAMES + 1) * 100 + GRACE_MS + 300, { id_a: planking, id_b: still });
  assert.equal(ctx.match.phase, "done");
  assert.equal(ctx.b.last("result").yourReason, "video looks frozen");
});

test("a camera that stops sending loses", () => {
  const ctx = setup();
  startLive(ctx);
  ctx.step(SILENCE_MS + 300, { id_a: planking });
  assert.equal(ctx.b.last("result").outcome, "loss");
  assert.equal(ctx.a.last("result").outcome, "win");
});

test("both dropping together is a draw", () => {
  const ctx = setup();
  startLive(ctx);
  ctx.step(GRACE_MS + 300, { id_a: sagging, id_b: sagging });
  assert.equal(ctx.a.last("result").outcome, "draw");
  assert.equal(ctx.b.last("result").outcome, "draw");
});

test("leaving before the start cancels without results", () => {
  const ctx = setup();
  ctx.match.leave(ctx.a);
  assert.equal(ctx.b.last("cancelled").reason, "opponent left");
  assert.deepEqual(ctx.ended, [[]]);
});

test("leaving mid-plank is a loss", () => {
  const ctx = setup();
  startLive(ctx);
  ctx.step(3_000, { id_a: planking, id_b: planking });
  ctx.match.leave(ctx.a);
  assert.equal(ctx.b.last("result").outcome, "win");
});

test("frames for unknown identities and malformed frames are ignored", () => {
  const ctx = setup();
  const pose = plankPose();
  ctx.match.judgePose("intruder", pose.frame, ASPECT, pose.world);
  const errors = [];
  const original = console.error;
  console.error = (msg) => errors.push(msg);
  ctx.match.judgePose("id_a", [[1, 2]], ASPECT, pose.world);
  ctx.match.judgePose("id_a", pose.frame, ASPECT, null);
  console.error = original;
  assert.equal(errors.length, 2);
  assert.match(ctx.match.ready(ctx.a), /can't see your camera/);
});

test("a solo practice round runs and reports its own hold time", () => {
  const clock = fakeClock();
  const a = fakePlayer("alice");
  const ended = [];
  const match = new Match([{ player: a, identity: "id_a", token: "tok_a" }], {
    room: "solo",
    livekitUrl: "ws://lk",
    onEnd: (m, results) => ended.push(results),
    clock: clock.now,
    autoTick: false,
  });
  assert.equal(a.last("matched").practice, true);
  assert.equal(a.last("matched").opponent, null);
  let jitter = 0;
  const run = (ms, frame) => {
    const end = clock.now() + ms;
    while (clock.now() < end) {
      clock.advance(100);
      jitter = jitter === 0 ? 0.001 : 0;
      const { frame: f, world } = frame(jitter);
      match.judgePose("id_a", f, ASPECT, world);
      match.tick();
    }
  };
  run(200, (j) => plankPose({ jitter: j }));
  assert.equal(a.last("skeleton").ok, true);
  assert.equal(match.ready(a), null);
  run(COUNTDOWN_MS + 4_000, (j) => plankPose({ jitter: j }));
  assert.equal(a.last("state").them, null);
  run(GRACE_MS + 300, (j) => plankPose({ bend: { hip: 0.3 }, jitter: j }));
  const result = a.last("result");
  assert.equal(result.outcome, "practice");
  assert.equal(result.theirMs, null);
  assert.ok(result.yourMs >= 4_000 && result.yourMs < 4_300);
  assert.deepEqual(ended, [[]]);
});

test("one bad frame does not flip the status, a sustained one does", () => {
  const ctx = setup();
  ctx.step(600, { id_a: planking, id_b: planking });
  ctx.step(100, { id_a: sagging, id_b: planking });
  assert.equal(ctx.a.last("skeleton").ok, true);
  ctx.step(300, { id_a: sagging, id_b: planking });
  assert.equal(ctx.a.last("skeleton").ok, false);
  assert.equal(ctx.a.last("skeleton").reason, "hips sagging");
});

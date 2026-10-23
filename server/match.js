import { assessPlank, isValidAspect, isValidFrame, isValidWorld, measurePlank } from "../shared/plank.js";
import { Recorder } from "./recorder.js";

export const COUNTDOWN_MS = 10_000;
export const GRACE_MS = 1_750;
export const KNEE_GRACE_MS = 1_000;
export const BASELINE_FRAMES = 24;
const KNEE_SINK_M = 0.035;
const KNEE_DROP_M = 0.03;
export const FRAME_TTL_MS = 1_500;
export const SILENCE_MS = 3_000;
export const READY_TIMEOUT_MS = 90_000;
export const MAX_MS = 30 * 60_000;
export const FROZEN_FRAMES = 12;
const FRAME_MIN_GAP_MS = 60;
const SMOOTHING_FRAMES = 5;
const TICK_MS = 100;
const BROADCAST_EVERY = 2;

class Feed {
  at = 0;
  ok = false;
  reason = "waiting for camera";
  prev = null;
  still = 0;
  #recent = [];
  #samples = [];
  #baseline = null;

  update(frame, aspect, world, now, live = false) {
    this.at = now;
    if (frame === null) {
      this.prev = null;
      this.still = 0;
      this.#settle({ ok: false, reason: "no body found" });
      return;
    }
    this.still = this.prev && sameFrame(this.prev, frame) ? this.still + 1 : 0;
    this.prev = frame;
    if (this.still >= FROZEN_FRAMES) {
      this.#recent = [];
      this.ok = false;
      this.reason = "video looks frozen";
      return;
    }
    this.#settle(this.#judge(assessPlank(frame, aspect, world), frame, aspect, world, live));
  }

  #judge(verdict, frame, aspect, world, live) {
    if (!verdict.ok || !live) return verdict;
    const { kneeAboveAnkle, kneeRise } = measurePlank(frame, aspect, world);
    if (!this.#baseline) {
      this.#samples.push({ kneeAboveAnkle, kneeRise });
      if (this.#samples.length >= BASELINE_FRAMES) this.#baseline = medians(this.#samples);
      return verdict;
    }
    const sunk = kneeAboveAnkle < this.#baseline.kneeAboveAnkle - KNEE_SINK_M && kneeRise < this.#baseline.kneeRise - KNEE_DROP_M;
    return sunk ? { ok: false, reason: "knees down" } : verdict;
  }

  #settle(verdict) {
    this.#recent.push(verdict);
    if (this.#recent.length > SMOOTHING_FRAMES) this.#recent.shift();
    const holding = this.#recent.filter((v) => v.ok).length;
    this.ok = holding * 2 > this.#recent.length;
    this.reason = this.ok ? "holding" : this.#recent.findLast((v) => !v.ok).reason;
  }

  live(now) {
    return now - this.at <= FRAME_TTL_MS;
  }

  read(now) {
    if (!this.live(now)) return { ok: false, reason: this.at ? "camera feed lost" : "waiting for camera" };
    return { ok: this.ok, reason: this.reason };
  }
}

function medians(samples) {
  const pick = (key) => {
    const sorted = samples.map((s) => s[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  return { kneeAboveAnkle: pick("kneeAboveAnkle"), kneeRise: pick("kneeRise") };
}

function sameFrame(a, b) {
  return a.every((p, i) => p[0] === b[i][0] && p[1] === b[i][1]);
}

class Side {
  ready = false;
  feed = new Feed();
  recorder = new Recorder();
  lastHolding = 0;
  out = null;

  constructor(player, identity) {
    this.player = player;
    this.identity = identity;
  }
}

export class Match {
  phase = "connecting";
  countdownEndsAt = 0;
  startedAt = 0;
  #sides;
  #clock;
  #onEnd;
  #onReport;
  #timer = null;
  #ticks = 0;
  #createdAt;

  constructor(entries, { room, livekitUrl, onEnd, onReport = () => {}, clock = Date.now, autoTick = true }) {
    this.room = room;
    this.practice = entries.length === 1;
    this.#sides = entries.map(({ player, identity }) => new Side(player, identity));
    this.#clock = clock;
    this.#onEnd = onEnd;
    this.#onReport = onReport;
    this.#createdAt = clock();
    if (autoTick) this.#timer = setInterval(() => this.tick(), TICK_MS);
    entries.forEach(({ player, token }, i) => {
      player.send({ t: "matched", practice: this.practice, opponent: entries[1 - i]?.player.name ?? null, livekitUrl, token });
    });
  }

  get identities() {
    return this.#sides.map((s) => s.identity);
  }

  #side(player) {
    return this.#sides.find((s) => s.player === player);
  }

  #other(side) {
    return this.#sides.find((s) => s !== side) ?? null;
  }

  ready(player) {
    if (this.phase !== "connecting") return null;
    const side = this.#side(player);
    if (!side.feed.live(this.#clock())) return "the judge can't see your camera yet";
    side.ready = true;
    if (this.#sides.every((s) => s.ready)) {
      this.phase = "countdown";
      this.countdownEndsAt = this.#clock() + COUNTDOWN_MS;
    }
    this.#broadcast();
    return null;
  }

  judgePose(identity, frame, aspect, world) {
    if (this.phase === "done") return;
    const side = this.#sides.find((s) => s.identity === identity);
    if (!side) return;
    if (frame !== null && (!isValidFrame(frame) || !isValidWorld(world) || !isValidAspect(aspect))) {
      console.error(`judge sent an invalid frame for ${identity}`);
      return;
    }
    const now = this.#clock();
    if (now - side.feed.at < FRAME_MIN_GAP_MS) return;
    side.feed.update(frame, aspect, world, now, this.phase === "live");
    side.recorder.add(this.phase, now, frame, aspect, world, side.feed.reason);
    side.player.send({ t: "skeleton", frame, aspect, ok: side.feed.ok, reason: side.feed.reason });
  }

  judgeFailed() {
    if (this.phase !== "done") this.#cancel("the judge hit an error, match voided");
  }

  tick() {
    const now = this.#clock();
    if (this.phase === "connecting" && now - this.#createdAt > READY_TIMEOUT_MS) {
      this.#cancel("ready timeout");
      return;
    }
    if (this.phase === "countdown" && now >= this.countdownEndsAt) {
      this.phase = "live";
      this.startedAt = now;
      for (const s of this.#sides) s.lastHolding = now;
    }
    if (this.phase === "live") {
      this.#judge(now);
      if (this.phase === "done") return;
    }
    if (++this.#ticks % BROADCAST_EVERY === 0) this.#broadcast();
  }

  #judge(now) {
    for (const side of this.#sides) {
      if (now - Math.max(side.feed.at, this.startedAt) > SILENCE_MS) {
        side.out = "camera feed lost";
        continue;
      }
      const { ok, reason } = side.feed.read(now);
      if (ok) side.lastHolding = now;
      else if (now - side.lastHolding > (reason === "knees down" ? KNEE_GRACE_MS : GRACE_MS)) side.out = reason;
    }
    if (this.#sides.some((s) => s.out) || now - this.startedAt >= MAX_MS) this.#finish(now);
  }

  leave(player) {
    if (this.phase === "done") return;
    if (this.phase !== "live") {
      this.#cancel("opponent left");
      return;
    }
    const side = this.#side(player);
    side.out = "disconnected";
    side.lastHolding = Math.min(side.lastHolding, this.#clock());
    this.#finish(this.#clock());
  }

  #finish(now) {
    this.#stop();
    const results = this.#sides.map((side) => {
      const other = this.#other(side);
      let outcome = "draw";
      if (!other) outcome = "practice";
      else if (side.out && !other.out) outcome = "loss";
      else if (!side.out && other.out) outcome = "win";
      const holdMs = Math.max(0, (side.out ? side.lastHolding : now) - this.startedAt);
      return { player: side.player, outcome, holdMs };
    });
    results.forEach((r, i) => {
      const side = this.#sides[i];
      const other = this.#other(side);
      r.player.send({
        t: "result",
        practice: this.practice,
        outcome: r.outcome,
        yourMs: r.holdMs,
        theirMs: results[1 - i]?.holdMs ?? null,
        yourReason: side.out,
        theirReason: other?.out ?? null,
      });
    });
    this.#onEnd(this, this.practice ? [] : results);
  }

  #cancel(reason) {
    this.#stop();
    for (const s of this.#sides) s.player.send({ t: "cancelled", reason });
    this.#onEnd(this, []);
  }

  #report(ending) {
    this.#onReport({
      room: this.room,
      ending,
      startedAt: this.startedAt,
      sides: this.#sides.map((s) => ({ identity: s.identity, name: s.player.name, out: s.out, ...s.recorder.summary() })),
      frames: Object.fromEntries(this.#sides.map((s) => [s.identity, s.recorder.frames])),
    });
  }

  #stop() {
    if (this.phase !== "done") this.#report(this.phase);
    this.phase = "done";
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  #broadcast() {
    const now = this.#clock();
    for (const side of this.#sides) {
      const other = this.#other(side);
      side.player.send({
        t: "state",
        phase: this.phase,
        now,
        countdownEndsAt: this.countdownEndsAt,
        startedAt: this.startedAt,
        you: { ...side.feed.read(now), ready: side.ready },
        them: other ? { ...other.feed.read(now), ready: other.ready } : null,
      });
    }
  }
}

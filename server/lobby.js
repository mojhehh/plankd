import { createHash } from "node:crypto";
import { newIdentity, newRoomName } from "./livekit.js";
import { Match } from "./match.js";

const NAME_RE = /^[A-Za-z0-9_ ]{2,16}$/;
const SECRET_RE = /^[a-f0-9]{64}$/;
const MAX_MESSAGES_PER_SECOND = 20;

export class Lobby {
  #board;
  #tokens;
  #judge;
  #livekitUrl;
  #online = new Map();
  #queue = [];

  constructor({ board, tokens, judge, livekitUrl }) {
    this.#board = board;
    this.#tokens = tokens;
    this.#judge = judge;
    this.#livekitUrl = livekitUrl;
  }

  connect(socket) {
    const player = {
      socket,
      id: null,
      name: null,
      match: null,
      pairing: false,
      window: { start: 0, count: 0 },
      send: (msg) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(msg)),
    };
    socket.on("message", (raw) => this.#onMessage(player, raw));
    socket.on("close", () => this.#onClose(player));
    socket.on("error", (err) => console.error("socket error:", err.message));
  }

  #flooding(player) {
    const now = Date.now();
    if (now - player.window.start >= 1000) player.window = { start: now, count: 0 };
    return ++player.window.count > MAX_MESSAGES_PER_SECOND;
  }

  #onMessage(player, raw) {
    if (this.#flooding(player)) {
      player.socket.close(1008, "too many messages");
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      player.send({ t: "error", message: "bad json" });
      return;
    }
    if (typeof msg !== "object" || msg === null) return player.send({ t: "error", message: "bad message" });
    if (msg.t === "board") return player.send({ t: "board", board: this.#board.top() });
    if (!player.id) {
      if (msg.t === "hello") return this.#hello(player, msg);
      return player.send({ t: "error", message: "say hello first" });
    }
    switch (msg.t) {
      case "queue":
        return this.#enqueue(player);
      case "leave":
        return this.#dequeue(player);
      case "quit":
        return player.match?.leave(player);
      case "ready": {
        const problem = player.match?.ready(player);
        if (problem) player.send({ t: "error", message: problem });
        return;
      }
      default:
        player.send({ t: "error", message: `unknown message ${String(msg.t).slice(0, 20)}` });
    }
  }

  #hello(player, { name, secret }) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!NAME_RE.test(trimmed)) return player.send({ t: "error", message: "name must be 2-16 letters, numbers, _ or spaces" });
    if (typeof secret !== "string" || !SECRET_RE.test(secret)) return player.send({ t: "error", message: "bad secret" });

    const id = createHash("sha256").update(secret).digest("hex").slice(0, 24);
    if (this.#online.has(id)) {
      player.send({ t: "error", message: "plankd is already open in another tab" });
      player.socket.close();
      return;
    }
    player.id = id;
    player.name = trimmed;
    this.#online.set(id, player);
    this.#board.register(id, trimmed);
    player.send({ t: "welcome", name: trimmed, board: this.#board.top() });
  }

  #enqueue(player) {
    if (player.match || player.pairing || this.#queue.includes(player)) return;
    if (!this.#judge.online) return player.send({ t: "error", message: "the judge is offline, try again in a minute" });
    const opponent = this.#queue.shift();
    if (!opponent) {
      this.#queue.push(player);
      player.send({ t: "queued" });
      return;
    }
    this.#pair(opponent, player).catch((err) => {
      console.error("pairing failed:", err);
      for (const p of [opponent, player]) {
        p.pairing = false;
        p.send({ t: "error", message: "couldn't start the match, try again" });
      }
    });
  }

  async #pair(a, b) {
    a.pairing = b.pairing = true;
    const room = newRoomName();
    const entries = await Promise.all(
      [a, b].map(async (player) => {
        const identity = newIdentity();
        return { player, identity, token: await this.#tokens.player(room, identity, player.name) };
      }),
    );
    a.pairing = b.pairing = false;
    const gone = [a, b].filter((p) => p.socket.readyState !== p.socket.OPEN);
    if (gone.length) {
      for (const p of [a, b]) if (!gone.includes(p)) this.#enqueue(p);
      return;
    }
    const match = new Match(entries, { room, livekitUrl: this.#livekitUrl, onEnd: (m, results) => this.#ended(m, results) });
    a.match = b.match = match;
    this.#judge.watch(room, match.identities, match);
  }

  #dequeue(player) {
    this.#queue = this.#queue.filter((p) => p !== player);
  }

  #ended(match, results) {
    this.#judge.unwatch(match.room);
    for (const p of this.#online.values()) if (p.match === match) p.match = null;
    for (const { player, outcome, holdMs } of results) this.#board.record(player.id, outcome, holdMs);
    if (results.length === 0) return;
    const board = this.#board.top();
    for (const p of this.#online.values()) p.send({ t: "board", board });
  }

  #onClose(player) {
    this.#dequeue(player);
    player.match?.leave(player);
    player.match = null;
    if (player.id && this.#online.get(player.id) === player) this.#online.delete(player.id);
  }
}

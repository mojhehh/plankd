export class JudgeLink {
  #socket = null;
  #rooms = new Map();
  #tokens;
  #url;

  constructor(tokens, livekitUrl) {
    this.#tokens = tokens;
    this.#url = livekitUrl;
  }

  get online() {
    return this.#socket !== null;
  }

  attach(socket) {
    if (this.#socket) this.#socket.close(4000, "replaced by a new judge");
    this.#socket = socket;
    console.log("judge connected");
    socket.on("message", (raw) => this.#onMessage(raw));
    socket.on("close", () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      console.error("judge disconnected");
      for (const { match } of [...this.#rooms.values()]) match.judgeFailed();
    });
    socket.on("error", (err) => console.error("judge socket error:", err.message));
  }

  watch(room, players, match) {
    this.#rooms.set(room, { players, match });
    this.#sendWatch(room, players);
  }

  unwatch(room) {
    if (!this.#rooms.delete(room)) return;
    this.#send({ t: "unwatch", room });
  }

  #sendWatch(room, players) {
    this.#tokens
      .judge(room)
      .then((token) => {
        if (this.#rooms.has(room)) this.#send({ t: "watch", room, url: this.#url, token, players });
      })
      .catch((err) => console.error(`judge token for ${room} failed:`, err));
  }

  #send(msg) {
    this.#socket?.send(JSON.stringify(msg));
  }

  #onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.error("judge sent invalid json");
      return;
    }
    const entry = this.#rooms.get(msg?.room);
    if (!entry) return;
    if (msg.t === "pose") entry.match.judgePose(msg.identity, msg.frame, msg.aspect, msg.world);
    else if (msg.t === "watch_failed") entry.match.judgeFailed();
    else console.error("unknown judge message:", String(msg.t).slice(0, 20));
  }
}

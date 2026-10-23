import { createLocalVideoTrack, Room, RoomEvent, Track, VideoPresets } from "./vendor/livekit-client-2.22.4.mjs";
import { SOCKET_URL } from "./config.js";
import { beep, keepAwake, releaseAwake, say, unlockAudio } from "./sound.js";

const $ = (id) => document.getElementById(id);
const ui = {
  home: $("home"),
  arena: $("arena"),
  form: $("play-form"),
  name: $("name"),
  play: $("play"),
  boardRows: $("board-rows"),
  theirVideo: $("their-video"),
  myVideo: $("my-video"),
  opponent: $("opponent"),
  theirStatus: $("their-status"),
  big: $("big"),
  sub: $("sub"),
  ready: $("ready"),
  yourStatus: $("your-status"),
  leave: $("leave"),
  result: $("result"),
  resultTitle: $("result-title"),
  resultTimes: $("result-times"),
  resultWhy: $("result-why"),
  again: $("again"),
  homeBtn: $("home-btn"),
  toast: $("toast"),
};

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch (err) {
      console.warn("storage unavailable:", err.message);
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (err) {
      console.warn("storage unavailable:", err.message);
    }
  },
};

function loadSecret() {
  const saved = storage.get("plankd.secret");
  if (saved && /^[a-f0-9]{64}$/.test(saved)) return saved;
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const secret = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  storage.set("plankd.secret", secret);
  return secret;
}

const secret = loadSecret();
let socket = null;
let greeted = false;
let wantQueue = false;
let camera = null;
let room = null;
let state = null;
let clockOffset = 0;
let lastSecond = null;
let wasHolding = null;

ui.name.value = storage.get("plankd.name") ?? "";

function send(msg) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

let toastTimer = 0;
function toast(text) {
  ui.toast.textContent = text;
  ui.toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 3500);
}

function connect() {
  socket = new WebSocket(SOCKET_URL);
  socket.addEventListener("open", () => {
    send({ t: "board" });
    if (wantQueue) sayHello();
  });
  socket.addEventListener("message", (event) => handle(JSON.parse(event.data)));
  socket.addEventListener("close", () => {
    greeted = false;
    if (ui.arena.classList.contains("active")) {
      leaveRoom();
      showHome();
      toast("Lost connection to the server");
    }
    setTimeout(connect, 2000);
  });
}

function sayHello() {
  send({ t: "hello", name: ui.name.value.trim(), secret });
}

function queue() {
  wantQueue = true;
  if (greeted) send({ t: "queue" });
  else sayHello();
}

function handle(msg) {
  switch (msg.t) {
    case "board":
      return renderBoard(msg.board);
    case "welcome":
      greeted = true;
      renderBoard(msg.board);
      if (wantQueue) send({ t: "queue" });
      return;
    case "queued":
      return showSolo("Finding an opponent...");
    case "matched":
      return joinMatch(msg);
    case "state":
      return onState(msg);
    case "result":
      return onResult(msg);
    case "cancelled":
      leaveRoom();
      if (!wantQueue) return;
      toast(msg.reason);
      return queue();
    case "error":
      toast(msg.message);
      ui.play.disabled = false;
      ui.play.textContent = "PLAY";
      return;
    default:
      console.warn("unknown message", msg.t);
  }
}

function renderBoard(rows) {
  ui.boardRows.replaceChildren();
  if (!rows?.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.className = "muted";
    td.textContent = "No planks yet. Be the first.";
    tr.append(td);
    ui.boardRows.append(tr);
    return;
  }
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    for (const value of [i + 1, row.name, formatTime(row.best), row.wins]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    ui.boardRows.append(tr);
  });
}

function formatTime(ms) {
  const total = Math.max(0, ms) / 1000;
  const minutes = Math.floor(total / 60);
  const seconds = (total % 60).toFixed(1).padStart(4, "0");
  return `${minutes}:${seconds}`;
}

function showHome() {
  ui.arena.classList.remove("active");
  ui.home.classList.add("active");
  ui.play.disabled = false;
  ui.play.textContent = "PLAY";
  wantQueue = false;
  state = null;
  camera?.stop();
  camera = null;
  releaseAwake();
}

function showSolo(text) {
  ui.home.classList.remove("active");
  ui.arena.classList.add("active", "solo");
  ui.result.classList.add("hidden");
  ui.ready.classList.add("hidden");
  ui.opponent.textContent = text;
  ui.theirStatus.textContent = "";
  ui.big.textContent = "";
  ui.sub.textContent = "";
  ui.yourStatus.textContent = "";
  state = null;
}

async function startCamera() {
  if (camera) return camera;
  camera = await createLocalVideoTrack({ facingMode: "user", resolution: VideoPresets.h540.resolution });
  camera.attach(ui.myVideo);
  return camera;
}

ui.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  unlockAudio();
  const name = ui.name.value.trim();
  storage.set("plankd.name", name);
  ui.play.disabled = true;
  ui.play.textContent = "STARTING CAMERA...";
  try {
    await startCamera();
  } catch (err) {
    ui.play.disabled = false;
    ui.play.textContent = "PLAY";
    toast(err.name === "NotAllowedError" ? "Camera blocked. Allow camera access and try again." : `Camera failed: ${err.message}`);
    return;
  }
  keepAwake();
  showSolo("Finding an opponent...");
  queue();
});

async function joinMatch(msg) {
  ui.opponent.textContent = `vs ${msg.opponent}`;
  ui.sub.textContent = "Connecting video...";
  wasHolding = null;
  lastSecond = null;
  room = new Room({ adaptiveStream: true, dynacast: true });
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind !== Track.Kind.Video) return;
    track.attach(ui.theirVideo);
    ui.arena.classList.remove("solo");
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach(ui.theirVideo));
  try {
    await room.connect(msg.livekitUrl, msg.token);
    await room.localParticipant.publishTrack(camera, { source: Track.Source.Camera });
  } catch (err) {
    console.error("video connection failed", err);
    toast(`Video connection failed: ${err.message}`);
  }
}

function leaveRoom() {
  if (!room) return;
  const leaving = room;
  room = null;
  leaving.disconnect(false);
  ui.theirVideo.srcObject = null;
  ui.arena.classList.add("solo");
}

function serverNow() {
  return Date.now() + clockOffset;
}

function onState(msg) {
  clockOffset = msg.now - Date.now();
  const previous = state?.phase;
  state = msg;
  ui.ready.classList.toggle("hidden", msg.phase !== "connecting" || msg.you.ready);
  ui.theirStatus.textContent = msg.them.ok ? "holding" : msg.them.reason;
  ui.theirStatus.className = `their-status ${msg.them.ok ? "ok" : "bad"}`;
  ui.yourStatus.textContent = msg.you.ok ? "holding" : msg.you.reason;
  ui.yourStatus.className = `your-status ${msg.you.ok ? "ok" : "bad"}`;

  if (msg.phase === "connecting") {
    ui.big.textContent = "";
    ui.sub.textContent = msg.you.ready ? "Waiting for your opponent to be ready" : "Get in frame, then tap ready";
  }
  if (msg.phase === "countdown") {
    ui.sub.textContent = "GET INTO POSITION";
    if (previous !== "countdown") say("Get into position");
  }
  if (msg.phase === "live") {
    ui.sub.textContent = "";
    if (previous !== "live") {
      beep(1100, 400);
      say("Go");
    }
    if (wasHolding && !msg.you.ok) {
      beep(220, 250, 0.35);
      say(msg.you.reason);
    }
    wasHolding = msg.you.ok;
  }
}

function onResult(msg) {
  state = null;
  leaveRoom();
  if (!ui.arena.classList.contains("active")) return;
  const titles = { win: "YOU WIN", loss: "YOU LOSE", draw: "DRAW" };
  ui.resultTitle.textContent = titles[msg.outcome];
  ui.resultTitle.className = `result-title ${msg.outcome}`;
  ui.resultTimes.textContent = `You ${formatTime(msg.yourMs)}  ·  Them ${formatTime(msg.theirMs)}`;
  const why = msg.outcome === "win" ? `They dropped: ${msg.theirReason}` : msg.yourReason ? `You dropped: ${msg.yourReason}` : "";
  ui.resultWhy.textContent = why;
  ui.result.classList.remove("hidden");
  ui.ready.classList.add("hidden");
  ui.yourStatus.textContent = "";
  ui.theirStatus.textContent = "";
  ui.big.textContent = "";
  ui.sub.textContent = "";
  if (msg.outcome === "win") [660, 880, 1320].forEach((f, i) => setTimeout(() => beep(f, 180), i * 160));
  else beep(180, 600, 0.3);
  say(titles[msg.outcome].toLowerCase(), 0);
}

function tick() {
  if (state?.phase === "live") ui.big.textContent = formatTime(serverNow() - state.startedAt);
  if (state?.phase === "countdown") {
    const left = Math.max(0, Math.ceil((state.countdownEndsAt - serverNow()) / 1000));
    ui.big.textContent = left;
    if (left !== lastSecond && left > 0 && left <= 5) beep(660, 120);
    lastSecond = left;
  }
  requestAnimationFrame(tick);
}

ui.ready.addEventListener("click", () => {
  unlockAudio();
  send({ t: "ready" });
});

ui.leave.addEventListener("click", () => {
  if (room || state) send({ t: "quit" });
  else send({ t: "leave" });
  leaveRoom();
  showHome();
});

ui.again.addEventListener("click", () => {
  showSolo("Finding an opponent...");
  queue();
});

ui.homeBtn.addEventListener("click", () => {
  send({ t: "leave" });
  showHome();
});

connect();
requestAnimationFrame(tick);

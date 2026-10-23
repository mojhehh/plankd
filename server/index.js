import express from "express";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { JudgeLink } from "./judge.js";
import { Leaderboard } from "./leaderboard.js";
import { Tokens } from "./livekit.js";
import { Lobby } from "./lobby.js";
import { isRtcPath, RtcProxy } from "./rtcproxy.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();

const tokens = new Tokens(config.livekit);
const judge = new JudgeLink(tokens, config.livekit.internalUrl);
const board = await Leaderboard.open(path.join(root, "data", "players.json"));
const lobby = new Lobby({ board, tokens, judge, livekitUrl: config.livekit.publicUrl });
const rtc = new RtcProxy(config.livekit.internalUrl);

const app = express();
app.disable("x-powered-by");
app.use("/rtc", (req, res) => rtc.handle(req, res));
app.use(express.static(path.join(root, "docs")));

function rejectUpgrade(socket, status) {
  socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function originAllowed(req) {
  if (config.allowedOrigins.length === 0) return true;
  return config.allowedOrigins.includes(req.headers.origin);
}

const players = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
players.on("connection", (socket) => lobby.connect(socket));

const publicServer = config.tls
  ? https.createServer({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }, app)
  : http.createServer(app);

publicServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (isRtcPath(pathname)) return rtc.upgrade(req, socket, head);
  if (pathname !== "/ws") return rejectUpgrade(socket, "404 Not Found");
  if (!originAllowed(req)) return rejectUpgrade(socket, "403 Forbidden");
  players.handleUpgrade(req, socket, head, (ws) => players.emit("connection", ws, req));
});

const judges = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
judges.on("connection", (socket) => judge.attach(socket));
const expectedAuth = Buffer.from(`Bearer ${config.judgeSecret}`);

const judgeServer = http.createServer((req, res) => res.writeHead(404).end());
judgeServer.on("upgrade", (req, socket, head) => {
  const auth = Buffer.from(req.headers.authorization ?? "");
  if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) return rejectUpgrade(socket, "401 Unauthorized");
  judges.handleUpgrade(req, socket, head, (ws) => judges.emit("connection", ws, req));
});

publicServer.listen(config.port, () => console.log(`plankd listening on ${config.tls ? "https" : "http"}://0.0.0.0:${config.port}`));
judgeServer.listen(config.judgePort, "127.0.0.1", () => console.log(`judge channel on 127.0.0.1:${config.judgePort}`));

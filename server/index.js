import express from "express";
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadConfig } from "./config.js";
import { JudgeLink } from "./judge.js";
import { Leaderboard } from "./leaderboard.js";
import { Tokens } from "./livekit.js";
import { Lobby } from "./lobby.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig();

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(root, "public")));
app.use("/shared", express.static(path.join(root, "shared")));

const tokens = new Tokens(config.livekit);
const judge = new JudgeLink(tokens, config.livekit.internalUrl);
const board = await Leaderboard.open(path.join(root, "data", "players.json"));
const lobby = new Lobby({ board, tokens, judge, livekitUrl: config.livekit.publicUrl });

const players = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
const judges = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
players.on("connection", (socket) => lobby.connect(socket));
judges.on("connection", (socket) => judge.attach(socket));

const expectedAuth = Buffer.from(`Bearer ${config.judgeSecret}`);

function judgeAllowed(req) {
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);
  const auth = Buffer.from(req.headers.authorization ?? "");
  return loopback && auth.length === expectedAuth.length && timingSafeEqual(auth, expectedAuth);
}

const server = createServer(app);
server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname === "/ws") {
    players.handleUpgrade(req, socket, head, (ws) => players.emit("connection", ws, req));
  } else if (pathname === "/judge" && judgeAllowed(req)) {
    judges.handleUpgrade(req, socket, head, (ws) => judges.emit("connection", ws, req));
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
  }
});

server.listen(config.port, () => console.log(`plankd running on http://localhost:${config.port}`));

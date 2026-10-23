import http from "node:http";
import net from "node:net";

export function isRtcPath(pathname) {
  return pathname === "/rtc" || pathname.startsWith("/rtc/");
}

export class RtcProxy {
  #host;
  #port;

  constructor(internalUrl) {
    const url = new URL(internalUrl);
    this.#host = url.hostname;
    this.#port = Number(url.port) || 80;
  }

  handle(req, res) {
    const upstream = http.request(
      { host: this.#host, port: this.#port, method: req.method, path: req.originalUrl ?? req.url, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      console.error("livekit proxy error:", err.message);
      if (!res.headersSent) res.writeHead(502).end();
      else res.destroy();
    });
    req.pipe(upstream);
  }

  upgrade(req, socket, head) {
    const upstream = net.connect(this.#port, this.#host, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on("error", (err) => {
      console.error("livekit proxy error:", err.message);
      socket.destroy();
    });
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
  }
}

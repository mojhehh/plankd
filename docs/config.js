const PRODUCTION_BACKEND = "https://plankd.duckdns.org:8843";

const local = ["localhost", "127.0.0.1"].includes(location.hostname);

export const BACKEND = local ? location.origin : PRODUCTION_BACKEND;
export const SOCKET_URL = `${BACKEND.replace(/^http/, "ws")}/ws`;

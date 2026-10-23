function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing environment variable ${name}`);
  return value;
}

function secret(name) {
  const value = required(name);
  if (value.length < 32) throw new Error(`${name} must be at least 32 characters`);
  return value;
}

function list(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const cert = process.env.TLS_CERT;
  const key = process.env.TLS_KEY;
  if (Boolean(cert) !== Boolean(key)) throw new Error("set both TLS_CERT and TLS_KEY, or neither");
  return {
    port: Number(process.env.PORT) || 7400,
    judgePort: Number(process.env.JUDGE_PORT) || 7401,
    tls: cert ? { cert, key } : null,
    allowedOrigins: list("ALLOWED_ORIGINS"),
    livekit: {
      publicUrl: required("LIVEKIT_URL"),
      internalUrl: required("LIVEKIT_INTERNAL_URL"),
      apiKey: required("LIVEKIT_API_KEY"),
      apiSecret: secret("LIVEKIT_API_SECRET"),
    },
    judgeSecret: secret("PLANKD_JUDGE_SECRET"),
  };
}

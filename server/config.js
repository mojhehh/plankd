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

export function loadConfig() {
  return {
    port: Number(process.env.PORT) || 7400,
    livekit: {
      publicUrl: required("LIVEKIT_URL"),
      internalUrl: process.env.LIVEKIT_INTERNAL_URL || required("LIVEKIT_URL"),
      apiKey: required("LIVEKIT_API_KEY"),
      apiSecret: secret("LIVEKIT_API_SECRET"),
    },
    judgeSecret: secret("PLANKD_JUDGE_SECRET"),
  };
}

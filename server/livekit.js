import { randomBytes } from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";

const TOKEN_TTL = "45m";

export function newRoomName() {
  return `m_${randomBytes(12).toString("base64url")}`;
}

export function newIdentity() {
  return `p_${randomBytes(12).toString("base64url")}`;
}

export class Tokens {
  #key;
  #secret;

  constructor({ apiKey, apiSecret }) {
    this.#key = apiKey;
    this.#secret = apiSecret;
  }

  player(room, identity, name) {
    const token = new AccessToken(this.#key, this.#secret, { identity, name, ttl: TOKEN_TTL });
    token.addGrant({
      roomJoin: true,
      room,
      canPublish: true,
      canPublishSources: [TrackSource.CAMERA],
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return token.toJwt();
  }

  judge(room) {
    const token = new AccessToken(this.#key, this.#secret, { identity: `judge_${room}`, ttl: TOKEN_TTL });
    token.addGrant({
      roomJoin: true,
      room,
      hidden: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
    });
    return token.toJwt();
  }
}

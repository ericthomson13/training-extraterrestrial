import { beforeEach, describe, expect, it } from "vitest";
import { resetJWKSCacheForTests, verifyAccessJWT } from "../functions/_lib/access.js";

const TEAM = "test-team.cloudflareaccess.com";
const AUD = "test-aud-tag";

function b64url(bytes) {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeKeyPair() {
  return crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, [
    "sign",
    "verify",
  ]);
}

async function makeToken({ privateKey, kid, payload }) {
  const headerB64 = b64urlJson({ alg: "RS256", kid, typ: "JWT" });
  const payloadB64 = b64urlJson(payload);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, data);
  return `${headerB64}.${payloadB64}.${b64url(new Uint8Array(sig))}`;
}

function jwksFetch(jwk) {
  return async () => ({ ok: true, json: async () => ({ keys: [jwk] }) });
}

describe("verifyAccessJWT", () => {
  beforeEach(() => resetJWKSCacheForTests());

  it("verifies a valid token and returns the email claim", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    jwk.kid = "kid-valid";
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ privateKey, kid: "kid-valid", payload: { email: "eric@example.com", aud: AUD, exp: now + 3600, iat: now } });

    const email = await verifyAccessJWT(token, { teamDomain: TEAM, aud: AUD, fetchImpl: jwksFetch(jwk) });
    expect(email).toBe("eric@example.com");
  });

  it("rejects an expired token", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    jwk.kid = "kid-expired";
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ privateKey, kid: "kid-expired", payload: { email: "eric@example.com", aud: AUD, exp: now - 10, iat: now - 100 } });

    await expect(verifyAccessJWT(token, { teamDomain: TEAM, aud: AUD, fetchImpl: jwksFetch(jwk) })).rejects.toThrow(/expired/);
  });

  it("rejects a token minted for a different Access application (wrong aud)", async () => {
    const { publicKey, privateKey } = await makeKeyPair();
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    jwk.kid = "kid-wrong-aud";
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ privateKey, kid: "kid-wrong-aud", payload: { email: "eric@example.com", aud: "someone-elses-app", exp: now + 3600, iat: now } });

    await expect(verifyAccessJWT(token, { teamDomain: TEAM, aud: AUD, fetchImpl: jwksFetch(jwk) })).rejects.toThrow(/aud/);
  });

  it("rejects a token signed by a key that isn't the one Access published (bad signature)", async () => {
    const { publicKey } = await makeKeyPair(); // the "real" published key
    const { privateKey: unrelatedKey } = await makeKeyPair(); // signs the token instead
    const jwk = await crypto.subtle.exportKey("jwk", publicKey);
    jwk.kid = "kid-forged";
    const now = Math.floor(Date.now() / 1000);
    const token = await makeToken({ privateKey: unrelatedKey, kid: "kid-forged", payload: { email: "eric@example.com", aud: AUD, exp: now + 3600, iat: now } });

    await expect(verifyAccessJWT(token, { teamDomain: TEAM, aud: AUD, fetchImpl: jwksFetch(jwk) })).rejects.toThrow(/signature/);
  });

  it("rejects a malformed token", async () => {
    await expect(verifyAccessJWT("not-a-jwt", { teamDomain: TEAM, aud: AUD, fetchImpl: jwksFetch({}) })).rejects.toThrow();
  });
});

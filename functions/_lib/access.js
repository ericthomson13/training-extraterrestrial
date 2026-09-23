// Verifies a Cloudflare Access JWT (the `Cf-Access-Jwt-Assertion` header) by
// hand: fetch Access's JWKS, check the RS256 signature with Web Crypto, check
// exp/aud, return the verified email. No JWT library — Pages Functions has no
// bundler-driven npm install step and this is the app's whole trust boundary,
// so it's worth keeping small and inspectable rather than trusting the
// convenience `Cf-Access-Authenticated-User-Email` header alone.

const JWKS_TTL_MS = 60 * 60 * 1000;
let jwksCache = null; // { teamDomain, keys, fetchedAt }

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64url.length / 4) * 4, "=");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlToJson(b64url) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(b64url)));
}

async function getJWKS(teamDomain, fetchImpl) {
  const now = Date.now();
  if (jwksCache && jwksCache.teamDomain === teamDomain && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const { keys } = await res.json();
  jwksCache = { teamDomain, keys, fetchedAt: now };
  return keys;
}

export async function verifyAccessJWT(token, { teamDomain, aud, fetchImpl = fetch, now = Date.now() }) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [headerB64, payloadB64, sigB64] = parts;
  const header = b64urlToJson(headerB64);
  const payload = b64urlToJson(payloadB64);
  if (header.alg !== "RS256") throw new Error("unsupported alg");

  const keys = await getJWKS(teamDomain, fetchImpl);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error("unknown key id");

  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, b64urlToBytes(sigB64), data);
  if (!valid) throw new Error("bad signature");

  const nowSec = Math.floor(now / 1000);
  if (typeof payload.exp === "number" && payload.exp < nowSec) throw new Error("expired");
  const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audList.includes(aud)) throw new Error("aud mismatch");
  if (!payload.email) throw new Error("missing email claim");
  return payload.email;
}

export function resetJWKSCacheForTests() {
  jwksCache = null;
}

// Session and token helpers shared by the edge gate (Deno) and the
// serverless functions (Node). Web Crypto only: no Node or Deno APIs.

export const COOKIE_NAME = "ftc_session";

const encoder = new TextEncoder();

export function env(name) {
  if (globalThis.Netlify?.env) {
    const value = globalThis.Netlify.env.get(name);
    if (value !== undefined) return value;
  }
  if (typeof process !== "undefined" && process.env) return process.env[name];
  return undefined;
}

function bytesToB64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToString(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** A random URL-safe token. 32 bytes = 256 bits, so it cannot be guessed. */
export function randomToken(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToB64url(bytes);
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return bytesToB64url(new Uint8Array(signature));
}

/** Compares two strings without leaking how many leading characters match. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Signs a session payload. `payload.exp` is a Unix time in seconds. */
export async function signSession(secret, payload) {
  const body = bytesToB64url(encoder.encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

/** Returns the payload when the signature is valid and not expired, else null. */
export async function verifySession(secret, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!secret || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1 || dot !== token.lastIndexOf(".")) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, await hmac(secret, body))) return null;
  try {
    const payload = JSON.parse(b64urlToString(body));
    if (typeof payload.exp !== "number" || payload.exp <= nowSeconds) return null;
    if (typeof payload.sid !== "string") return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(value, maxAgeSeconds) {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function clearedSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Portal members (Netlify Identity)
//
// Staff signed in to the command centre carry Netlify Identity's `nf_jwt`
// cookie. We never trust its contents directly: the token is sent to the
// site's own Identity endpoint (/.netlify/identity/user), which checks the
// signature and expiry and returns the user. This is the same check the
// @netlify/identity library performs server-side. Answers are cached briefly
// so a page load does not call Identity once per request.

export const IDENTITY_COOKIE = "nf_jwt";

const memberCache = new Map();

export function memberRole() {
  return env("FREIGHT_MEMBER_ROLE") || "member";
}

function identityApiUrl(requestUrl) {
  // IDENTITY_API_URL exists only for local testing against a stand-in server.
  const override = env("IDENTITY_API_URL");
  return (override || new URL("/.netlify/identity", requestUrl).href).replace(/\/$/, "");
}

export function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Returns { id, email, name } for a signed-in portal member, otherwise null. */
export async function verifyMember(requestUrl, token) {
  if (typeof token !== "string" || token.length > 8192 || token.split(".").length !== 3) return null;
  const key = await sha256Hex(token);
  const now = Date.now();
  const cached = memberCache.get(key);
  if (cached && cached.until > now) return cached.user;

  let user = null;
  try {
    const res = await fetch(`${identityApiUrl(requestUrl)}/user`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      const roles = Array.isArray(data?.app_metadata?.roles) ? data.app_metadata.roles : [];
      if (data?.id && roles.includes(memberRole())) {
        const meta = data.user_metadata || {};
        user = { id: String(data.id), email: String(data.email || ""), name: String(meta.full_name || meta.name || data.email || "Portal member") };
      }
    }
  } catch {
    return null; // Identity unreachable: deny, and do not cache the failure
  }
  if (memberCache.size > 1000) memberCache.clear();
  memberCache.set(key, { user, until: now + (user ? 60_000 : 15_000) });
  return user;
}

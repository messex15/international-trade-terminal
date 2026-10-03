// Connection to CN's APIs (developer portal: https://developer.app.cn.ca).
// CN uses OAuth client credentials: the key and secret of an app registered in
// CN's developer portal under the CN account, which CN then activates. They are
// Netlify environment variables, used only here on the server; they are never
// sent to the browser or stored with the site's data.
//   CN_API_KEY      the app's key (client id)
//   CN_API_SECRET   the app's secret
//   CN_API_BASE     optional, default https://api.cn.ca (local testing only)
import { HttpError } from "./http.mjs";
import { env } from "./session.mjs";

// From CN's API overview: POST with the key in x-apikey and key:secret as Basic auth.
const TOKEN_PATH = "/v1/oauth/jwt-token/accesstokenJWT?grant_type=client_credentials";

export function cnConfig() {
  const key = String(env("CN_API_KEY") || "").trim();
  const secret = String(env("CN_API_SECRET") || "").trim();
  const base = String(env("CN_API_BASE") || "https://api.cn.ca").trim().replace(/\/+$/, "");
  return { key, secret, base, configured: Boolean(key && secret) };
}

let cached = null; // { token, expiresAt, key } for this server instance

/** An access token from CN, reused until a minute before it runs out. */
export async function cnToken({ fresh = false } = {}) {
  const { key, secret, base, configured } = cnConfig();
  if (!configured) throw new HttpError(503, "The CN connection is not set up yet. Add CN_API_KEY and CN_API_SECRET in Netlify.");
  if (!fresh && cached && cached.key === key && cached.expiresAt > Date.now() + 60_000) return cached.token;

  let res;
  try {
    res = await fetch(base + TOKEN_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-apikey": key,
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new HttpError(502, "Could not reach CN. Try again in a moment.");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new HttpError(502, "CN did not accept the API key and secret. Check them, and that CN has activated the app.");
  }
  if (res.status === 429) throw new HttpError(502, "CN is limiting requests right now. Try again in a moment.");
  if (!res.ok) throw new HttpError(502, `CN returned an error (${res.status}). Try again later.`);
  const body = await res.json().catch(() => ({}));
  if (!body.access_token) throw new HttpError(502, "CN replied without an access token. Try again later.");
  const seconds = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
  cached = { token: body.access_token, expiresAt: Date.now() + seconds * 1000, key };
  return cached.token;
}
